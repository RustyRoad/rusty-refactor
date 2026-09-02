import * as assert from 'assert';
import * as vscode from 'vscode';

import {
    normalizeWorkspaceFileReference
} from '../../sidebar/workspaceFileReference';
import {
    WorkspaceFileResolver
} from '../../sidebar/workspaceFileResolver';

/**
 * Returns the extension-test workspace folder required by resolver coverage.
 */
function testWorkspaceFolder(): vscode.WorkspaceFolder {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'The extension test must run with a workspace folder.');
    return folder;
}

/**
 * Verifies repository-root notation resolves inside the current workspace.
 */
async function resolvesWorkspaceRelativePath(): Promise<void> {
    const folder = testWorkspaceFolder();
    const resolver = new WorkspaceFileResolver();
    const uri = await resolver.resolve('/package.json');

    assert.ok(uri);
    assert.strictEqual(
        uri.fsPath,
        vscode.Uri.joinPath(folder.uri, 'package.json').fsPath
    );
}

/**
 * Verifies traversal cannot resolve a file outside the test workspace.
 */
async function rejectsWorkspaceEscape(): Promise<void> {
    const resolver = new WorkspaceFileResolver();
    const uri = await resolver.resolve(
        '/../../outside-workspace/file.ts'
    );

    assert.strictEqual(uri, undefined);
}

/**
 * Verifies untrusted browser locations are normalized to positive integers.
 */
function normalizesWorkspaceReference(): void {
    assert.deepStrictEqual(
        normalizeWorkspaceFileReference({
            path: ' /api/src/dm.ts ',
            line: 42,
            column: 7
        }),
        {
            path: '/api/src/dm.ts',
            line: 42,
            column: 7
        }
    );
}

/**
 * Registers reference normalization and workspace containment coverage.
 */
function registerWorkspaceFileResolverTests(): void {
    test(
        'resolves repository-root notation inside the workspace',
        resolvesWorkspaceRelativePath
    );
    test(
        'rejects paths outside the workspace',
        rejectsWorkspaceEscape
    );
    test(
        'normalizes a browser file reference',
        normalizesWorkspaceReference
    );
}

suite('Workspace file resolver', registerWorkspaceFileResolverTests);