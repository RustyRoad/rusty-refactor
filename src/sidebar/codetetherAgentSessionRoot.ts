import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Resolves the workspace-local directory containing agent session JSON.
 */
export class CodetetherAgentSessionRoot {
    /**
     * Returns the agent session directory for the first workspace folder.
     */
    public path(): string | undefined {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
            return undefined;
        }

        return path.join(
            folder.uri.fsPath,
            '.codetether-agent',
            'sessions'
        );
    }
}
