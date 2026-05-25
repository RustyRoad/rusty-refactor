import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Resolves the workspace-local directory that stores Codetether sessions.
 */
export class CodetetherSessionHistoryRoot {
    /**
     * Returns the history directory for the first workspace folder.
     */
    public path(): string | undefined {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
            return undefined;
        }

        return path.join(
            folder.uri.fsPath,
            '.codetether-agent',
            'history'
        );
    }
}
