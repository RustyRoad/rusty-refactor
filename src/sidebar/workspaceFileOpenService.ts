import * as vscode from 'vscode';

import {
    normalizeWorkspaceFileReference,
    WorkspaceFileReference
} from './workspaceFileReference';
import { WorkspaceFileResolver } from './workspaceFileResolver';

/**
 * Opens a resolved assistant file reference in the VS Code editor.
 */
export class WorkspaceFileOpenService {
    /**
     * Creates an editor opener with a workspace-contained path resolver.
     */
    public constructor(
        private readonly resolver = new WorkspaceFileResolver()
    ) {}

    /**
     * Opens a trusted workspace match at its optional one-based source point.
     *
     * Paths outside every open workspace folder are rejected. Leading slashes
     * are also tried relative to each workspace root because agents commonly
     * describe repository paths as `/api/src/file.ts`.
     */
    public async open(value: unknown): Promise<boolean> {
        const reference = normalizeWorkspaceFileReference(value);
        if (!reference) {
            void vscode.window.showWarningMessage(
                'The response did not contain a valid workspace file path.'
            );
            return false;
        }

        const uri = await this.resolver.resolve(reference.path);
        if (!uri) {
            void vscode.window.showWarningMessage(
                `Workspace file not found: ${reference.path}`
            );
            return false;
        }

        const document = await vscode.workspace.openTextDocument(uri);
        const selection = this.sourceSelection(document, reference);
        await vscode.window.showTextDocument(document, {
            preview: false,
            selection
        });
        return true;
    }

    /**
     * Converts a one-based response location into a valid editor selection.
     */
    private sourceSelection(
        document: vscode.TextDocument,
        reference: WorkspaceFileReference
    ): vscode.Range {
        const requestedLine = (reference.line || 1) - 1;
        const line = Math.min(requestedLine, document.lineCount - 1);
        const requestedColumn = (reference.column || 1) - 1;
        const column = Math.min(
            requestedColumn,
            document.lineAt(line).text.length
        );
        const position = new vscode.Position(line, column);
        return new vscode.Range(position, position);
    }
}