import * as assert from 'assert';
import { unlink, writeFile } from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

import {
    WorkspaceFileChangeService
} from '../../workspaceFileChangeService';

/**
 * Removes the explicit test file while tolerating an earlier cleanup.
 */
async function removeTestFile(filePath: string): Promise<void> {
    try {
        await unlink(filePath);
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') {
            throw error;
        }
    }
}

/**
 * Verifies VS Code reports a file written outside its workspace API.
 */
async function observesExternalWorkspaceWrite(): Promise<void> {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspace, 'The integration test requires a workspace.');
    const fileName = `.codetether-watch-${process.pid}.tmp`;
    const filePath = path.join(workspace.uri.fsPath, fileName);
    const service = new WorkspaceFileChangeService();

    try {
        const marker = service.mark();
        await writeFile(filePath, 'external tool change', 'utf8');
        const summary = await service.observeAfterToolActivity(
            marker,
            'integration test'
        );
        assert.ok(summary.changes.some(change => {
            return change.path.endsWith(fileName);
        }));
    } finally {
        service.dispose();
        await removeTestFile(filePath);
    }
}

/**
 * Registers the VS Code workspace-watcher integration test.
 */
function defineWorkspaceFileChangeServiceTests(): void {
    test(
        'observes an external workspace write',
        observesExternalWorkspaceWrite
    );
}

suite(
    'Workspace file change service',
    defineWorkspaceFileChangeServiceTests
);
