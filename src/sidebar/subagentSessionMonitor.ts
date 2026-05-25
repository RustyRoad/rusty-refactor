import * as fs from 'fs/promises';
import * as path from 'path';
import type { Stats } from 'fs';

import {
    CodetetherSubagentActivity
} from '../codetetherSubagentActivity';

const POLL_INTERVAL_MS = 1500;
const MAIN_AGENT_NAME = 'build';

interface SessionSummary {
    id?: unknown;
    agent?: unknown;
    title?: unknown;
    updated_at?: unknown;
    metadata?: {
        model?: unknown;
    };
    messages?: unknown;
}

/**
 * Receives the latest active sub-agent rows from the monitor.
 */
export type SubagentActivitySink = (
    activities: CodetetherSubagentActivity[]
) => void;

/**
 * Polls Codetether session files for sub-agents spawned during a request.
 */
export class SubagentSessionMonitor {
    private timer: NodeJS.Timeout | undefined;
    private readonly startedAt = Date.now();
    private lastSignature = '';

    /**
     * Creates a monitor scoped to one workspace session directory.
     */
    public constructor(
        private readonly workspacePath: string,
        private readonly sink: SubagentActivitySink
    ) {}

    /**
     * Starts polling and emits the first result immediately.
     */
    public start(): void {
        void this.poll();
        this.timer = setInterval(() => {
            void this.poll();
        }, POLL_INTERVAL_MS);
    }

    /**
     * Stops polling for this request.
     */
    public stop(): void {
        if (!this.timer) {
            return;
        }

        clearInterval(this.timer);
        this.timer = undefined;
    }

    /**
     * Reads current sub-agent sessions and emits changes to the sink.
     */
    private async poll(): Promise<void> {
        const activities = await this.readActivities();
        const signature = JSON.stringify(activities);

        if (signature === this.lastSignature) {
            return;
        }

        this.lastSignature = signature;
        this.sink(activities);
    }

    /**
     * Reads recent Codetether session files created by non-main agents.
     */
    private async readActivities(): Promise<CodetetherSubagentActivity[]> {
        const directory = this.sessionsDirectory();
        let entries: string[];

        try {
            entries = await fs.readdir(directory);
        } catch {
            return [];
        }

        const rows: CodetetherSubagentActivity[] = [];
        for (const entry of entries) {
            const row = await this.activityFromSessionFile(directory, entry);
            if (row) {
                rows.push(row);
            }
        }

        return rows.sort((left, right) => {
            return left.name.localeCompare(right.name);
        });
    }

    /**
     * Converts one session file to a sub-agent row when it is relevant.
     */
    private async activityFromSessionFile(
        directory: string,
        entry: string
    ): Promise<CodetetherSubagentActivity | undefined> {
        if (!entry.endsWith('.json') || entry.endsWith('.journal.json')) {
            return undefined;
        }

        const filePath = path.join(directory, entry);
        const stat = await this.safeStat(filePath);
        if (!stat || stat.mtimeMs < this.startedAt) {
            return undefined;
        }

        const session = await this.safeReadSession(filePath);
        const agent = this.sessionAgent(session);
        if (!agent || agent === MAIN_AGENT_NAME) {
            return undefined;
        }

        return {
            id: `session-${this.sessionId(session, entry)}`,
            name: agent,
            status: 'running',
            detail: this.sessionDetail(session),
            model: this.sessionModel(session) || undefined,
            sessionId: this.sessionId(session, entry),
            updatedAt: this.sessionUpdatedAt(session, stat.mtime)
        };
    }

    /**
     * Returns the Codetether session storage directory.
     */
    private sessionsDirectory(): string {
        return path.join(
            this.workspacePath,
            '.codetether-agent',
            'sessions'
        );
    }

    /**
     * Reads file stats without surfacing transient filesystem failures.
     */
    private async safeStat(
        filePath: string
    ): Promise<Stats | undefined> {
        try {
            return await fs.stat(filePath);
        } catch {
            return undefined;
        }
    }

    /**
     * Reads and parses one Codetether session file.
     */
    private async safeReadSession(
        filePath: string
    ): Promise<SessionSummary | undefined> {
        try {
            const raw = await fs.readFile(filePath, 'utf8');
            return JSON.parse(raw) as SessionSummary;
        } catch {
            return undefined;
        }
    }

    /**
     * Returns the agent name stored in a session.
     */
    private sessionAgent(session: SessionSummary | undefined): string {
        return typeof session?.agent === 'string'
            ? session.agent.trim()
            : '';
    }

    /**
     * Returns the stable session id for display and row identity.
     */
    private sessionId(
        session: SessionSummary | undefined,
        fileName: string
    ): string {
        if (typeof session?.id === 'string' && session.id.trim()) {
            return session.id.trim();
        }

        return fileName.replace(/\.json$/, '');
    }

    /**
     * Returns the model identifier associated with the session.
     */
    private sessionModel(session: SessionSummary | undefined): string {
        const model = session?.metadata?.model;
        return typeof model === 'string' ? model.trim() : '';
    }

    /**
     * Returns a concise task label for a sub-agent session.
     */
    private sessionDetail(session: SessionSummary | undefined): string {
        const title = typeof session?.title === 'string'
            ? session.title
            : '';
        const detail = title || this.firstMessageText(session);
        return this.summarize(detail || 'Sub-agent session started.');
    }

    /**
     * Reads the first textual message from a session payload.
     */
    private firstMessageText(session: SessionSummary | undefined): string {
        const messages = Array.isArray(session?.messages)
            ? session?.messages
            : [];
        const first = messages[0] as { content?: unknown } | undefined;
        const parts = Array.isArray(first?.content) ? first?.content : [];
        const textPart = parts.find(part => {
            return typeof (part as { text?: unknown }).text === 'string';
        }) as { text?: string } | undefined;

        return textPart?.text || '';
    }

    /**
     * Returns the session update time as an ISO string.
     */
    private sessionUpdatedAt(
        session: SessionSummary | undefined,
        fallback: Date
    ): string {
        if (typeof session?.updated_at === 'string') {
            return session.updated_at;
        }

        return fallback.toISOString();
    }

    /**
     * Trims long session text for compact sidebar display.
     */
    private summarize(value: string): string {
        const normalized = value.replace(/\s+/g, ' ').trim();
        const maxLength = 120;

        if (normalized.length <= maxLength) {
            return normalized;
        }

        return `${normalized.slice(0, maxLength - 3)}...`;
    }
}
