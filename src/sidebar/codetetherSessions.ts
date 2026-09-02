import * as fs from 'fs/promises';
import * as path from 'path';

import { CodetetherAgentSessionIndex } from
    './codetetherAgentSessionIndex';
import { CodetetherSessionDirectory } from './codetetherSessionDirectory';
import { CodetetherSessionHistoryRoot } from './codetetherSessionHistoryRoot';
import { CodetetherSessionPreview } from './codetetherSessionPreview';
import {
    CodetetherSessionSummary
} from './codetetherSessionTypes';

/**
 * Reads persisted Codetether session history from the active workspace.
 */
export class CodetetherSessionService {
    /**
     * Creates a session service from focused filesystem collaborators.
     */
    public constructor(
        private readonly root = new CodetetherSessionHistoryRoot(),
        private readonly directory = new CodetetherSessionDirectory(),
        private readonly preview = new CodetetherSessionPreview(),
        private readonly agentSessions = new CodetetherAgentSessionIndex()
    ) {}

    /**
     * Lists recent sessions across JSON agent state and Markdown history.
     */
    public async listRecentSessions(
        limit = 20
    ): Promise<CodetetherSessionSummary[]> {
        const [historySessions, agentSessions] = await Promise.all([
            this.listHistorySessions(limit),
            this.agentSessions.list(limit)
        ]);
        const sessionsById = new Map<string, CodetetherSessionSummary>();
        for (const session of [...historySessions, ...agentSessions]) {
            const existing = sessionsById.get(session.id);
            if (!existing || session.updatedAt > existing.updatedAt) {
                sessionsById.set(session.id, session);
            }
        }

        return [...sessionsById.values()]
            .sort((left, right) => right.updatedAt - left.updatedAt)
            .slice(0, limit);
    }

    /**
     * Lists sessions persisted in the older Markdown turn format.
     */
    private async listHistorySessions(
        limit: number
    ): Promise<CodetetherSessionSummary[]> {
        const historyRoot = this.root.path();
        if (!historyRoot) {
            return [];
        }

        const entries = await this.directory.safeReadDirectory(historyRoot);
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
     * Finds one known session by exact id or unique visible prefix.
     */
    public async findSessionById(
        sessionId: string
    ): Promise<CodetetherSessionSummary | undefined> {
        const needle = sessionId.trim();
        if (!needle) {
            return undefined;
        }

        const sessions = await this.listRecentSessions(200);
        return sessions.find(session => {
            return session.id === needle || session.id.startsWith(needle);
        });
    }

    /**
     * Builds display metadata for one session directory.
     */
    private async sessionSummary(
        historyRoot: string,
        sessionId: string
    ): Promise<CodetetherSessionSummary | undefined> {
        const sessionPath = path.join(historyRoot, sessionId);
        const turnFiles = await this.directory.turnFiles(sessionPath);
        if (turnFiles.length === 0) {
            return undefined;
        }

        const stats = await fs.stat(sessionPath);
        return {
            id: sessionId,
            path: sessionPath,
            turnCount: turnFiles.length,
            updatedAt: stats.mtimeMs,
            preview: await this.preview.fromFirstUserTurn(
                sessionPath,
                turnFiles
            ),
            format: 'history'
        };
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
