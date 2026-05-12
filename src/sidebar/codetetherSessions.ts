import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Describes one persisted Codetether session for sidebar display.
 */
export interface CodetetherSessionSummary {
    id: string;
    path: string;
    turnCount: number;
    updatedAt: number;
    preview: string;
}

/**
 * Reads persisted Codetether session history from the active workspace.
 */
export class CodetetherSessionService {
    /**
     * Lists recent Codetether sessions stored under the workspace history.
     */
    public async listRecentSessions(
        limit = 20
    ): Promise<CodetetherSessionSummary[]> {
        const historyRoot = this.historyRoot();
        if (!historyRoot) {
            return [];
        }

        const entries = await this.safeReadDirectory(historyRoot);
        const summaries = await Promise.all(
            entries
                .filter(entry => entry.isDirectory())
                .map(entry => this.sessionSummary(historyRoot, entry.name))
        );

        return summaries
            .filter(this.isSessionSummary)
            .sort((left, right) => right.updatedAt - left.updatedAt)
            .slice(0, limit);
    }

    /**
     * Resolves the workspace-local directory that stores session history.
     */
    private historyRoot(): string | undefined {
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

    /**
     * Reads a directory and returns an empty list when it is absent.
     */
    private async safeReadDirectory(
        directory: string
    ): Promise<fsSync.Dirent[]> {
        try {
            return await fs.readdir(directory, { withFileTypes: true });
        } catch {
            return [];
        }
    }

    /**
     * Builds display metadata for one session directory.
     */
    private async sessionSummary(
        historyRoot: string,
        sessionId: string
    ): Promise<CodetetherSessionSummary | undefined> {
        const sessionPath = path.join(historyRoot, sessionId);
        const turnFiles = await this.turnFiles(sessionPath);
        if (turnFiles.length === 0) {
            return undefined;
        }

        const stats = await fs.stat(sessionPath);
        const preview = await this.previewFromFirstUserTurn(
            sessionPath,
            turnFiles
        );

        return {
            id: sessionId,
            path: sessionPath,
            turnCount: turnFiles.length,
            updatedAt: stats.mtimeMs,
            preview
        };
    }

    /**
     * Returns sorted turn file names for a session directory.
     */
    private async turnFiles(sessionPath: string): Promise<string[]> {
        const entries = await this.safeReadDirectory(sessionPath);

        return entries
            .filter(entry => entry.isFile())
            .map(entry => entry.name)
            .filter(name => /^turn-\d{4}-.+\.md$/.test(name))
            .sort();
    }

    /**
     * Extracts a short preview from the first user-authored turn.
     */
    private async previewFromFirstUserTurn(
        sessionPath: string,
        turnFiles: string[]
    ): Promise<string> {
        const userTurn = turnFiles.find(name => name.endsWith('-user.md'));
        if (!userTurn) {
            return 'Codetether session';
        }

        const userTurnPath = path.join(sessionPath, userTurn);
        const content = await this.safeReadFile(userTurnPath);
        const normalized = content.replace(/\s+/g, ' ').trim();
        if (!normalized) {
            return 'Codetether session';
        }

        return normalized.length > 120
            ? `${normalized.slice(0, 117)}...`
            : normalized;
    }

    /**
     * Reads a text file and hides file-system errors from the sidebar.
     */
    private async safeReadFile(filePath: string): Promise<string> {
        try {
            return await fs.readFile(filePath, 'utf8');
        } catch {
            return '';
        }
    }

    /**
     * Narrows optional summaries after failed directory reads are skipped.
     */
    private isSessionSummary(
        summary: CodetetherSessionSummary | undefined
    ): summary is CodetetherSessionSummary {
        return Boolean(summary);
    }
}
