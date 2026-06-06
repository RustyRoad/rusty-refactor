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

interface TaskRecord {
    kind?: unknown;
    at?: unknown;
    objective?: unknown;
    success_criteria?: unknown;
    id?: unknown;
    status?: unknown;
    note?: unknown;
}

interface LedgerFile {
    session_id?: unknown;
    items?: unknown;
    evidence?: unknown;
}

interface LedgerItem {
    deliverable?: unknown;
    status?: unknown;
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
     * Reads one activity snapshot without changing the polling lifecycle.
     */
    public snapshot(): Promise<CodetetherSubagentActivity[]> {
        return this.readActivities();
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

        rows.push(...await this.taskActivities(directory, entries));
        rows.push(...await this.ledgerActivities());
        rows.push(...await this.memoryActivities());

        return rows.sort((left, right) => {
            return right.updatedAt.localeCompare(left.updatedAt)
                || left.name.localeCompare(right.name);
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
            source: 'session',
            model: this.sessionModel(session) || undefined,
            sessionId: this.sessionId(session, entry),
            updatedAt: this.sessionUpdatedAt(session, stat.mtime)
        };
    }

    /**
     * Converts task journals into goal and status activity rows.
     */
    private async taskActivities(
        directory: string,
        entries: string[]
    ): Promise<CodetetherSubagentActivity[]> {
        const rows: CodetetherSubagentActivity[] = [];
        for (const entry of entries) {
            if (!entry.endsWith('.tasks.jsonl')) {
                continue;
            }

            const row = await this.taskActivity(directory, entry);
            if (row) {
                rows.push(row);
            }
        }

        return rows;
    }

    /**
     * Converts one task journal into a compact activity row.
     */
    private async taskActivity(
        directory: string,
        entry: string
    ): Promise<CodetetherSubagentActivity | undefined> {
        const filePath = path.join(directory, entry);
        const stat = await this.safeStat(filePath);
        if (!stat || stat.mtimeMs < this.lookbackStart()) {
            return undefined;
        }

        const records = await this.safeReadJsonLines<TaskRecord>(filePath);
        if (records.length === 0) {
            return undefined;
        }

        const sessionId = entry.replace(/\.tasks\.jsonl$/, '');
        const latest = records[records.length - 1];
        const objective = this.taskObjective(records);
        return {
            id: `tasks-${sessionId}`,
            name: 'Task journal',
            status: this.taskStatus(latest),
            detail: objective || this.stringValue(latest.note),
            source: 'tasks',
            taskCount: records.length,
            doneCount: this.doneTaskCount(records),
            sessionId,
            updatedAt: this.timeValue(latest.at, stat.mtime)
        };
    }

    /**
     * Converts local Codetether ledgers into activity rows.
     */
    private async ledgerActivities(): Promise<CodetetherSubagentActivity[]> {
        const directory = path.join(
            this.workspacePath,
            '.codetether',
            'session-ledgers'
        );
        const entries = await this.safeReadDirectory(directory);
        const rows: CodetetherSubagentActivity[] = [];

        for (const entry of entries) {
            const row = await this.ledgerActivity(directory, entry);
            if (row) {
                rows.push(row);
            }
        }

        return rows;
    }

    /**
     * Converts one ledger file into a deliverable summary row.
     */
    private async ledgerActivity(
        directory: string,
        entry: string
    ): Promise<CodetetherSubagentActivity | undefined> {
        if (!entry.endsWith('.json')) {
            return undefined;
        }

        const filePath = path.join(directory, entry);
        const stat = await this.safeStat(filePath);
        if (!stat || stat.mtimeMs < this.lookbackStart()) {
            return undefined;
        }

        const ledger = await this.safeReadJson<LedgerFile>(filePath);
        const items = Array.isArray(ledger?.items) ? ledger.items : [];
        const blocked = items.filter(item => {
            return this.itemStatus(item) === 'blocked';
        }).length;
        const done = items.filter(item => {
            return this.itemStatus(item) === 'done';
        }).length;
        const first = items[0] as LedgerItem | undefined;
        const sessionId = this.stringValue(ledger?.session_id)
            || entry.replace(/\.json$/, '');

        return {
            id: `ledger-${sessionId}`,
            name: 'Session ledger',
            status: blocked > 0 ? 'failed' : 'running',
            detail: this.summarize(
                this.stringValue(first?.deliverable)
                    || 'Codetether deliverable ledger updated.'
            ),
            source: 'ledger',
            taskCount: items.length,
            doneCount: done,
            blockedCount: blocked,
            evidenceCount: this.evidenceCount(ledger),
            sessionId,
            updatedAt: stat.mtime.toISOString()
        };
    }

    /**
     * Converts memory writeback files into evidence activity rows.
     */
    private async memoryActivities(): Promise<CodetetherSubagentActivity[]> {
        const directory = path.join(
            this.workspacePath,
            '.codetether',
            'memory-writeback'
        );
        const entries = await this.safeReadDirectory(directory);
        const rows: CodetetherSubagentActivity[] = [];

        for (const entry of entries) {
            const row = await this.memoryActivity(directory, entry);
            if (row) {
                rows.push(row);
            }
        }

        return rows;
    }

    /**
     * Converts one memory file into an evidence summary row.
     */
    private async memoryActivity(
        directory: string,
        entry: string
    ): Promise<CodetetherSubagentActivity | undefined> {
        if (!entry.endsWith('.json')) {
            return undefined;
        }

        const filePath = path.join(directory, entry);
        const stat = await this.safeStat(filePath);
        if (!stat || stat.mtimeMs < this.lookbackStart()) {
            return undefined;
        }

        const evidence = await this.safeReadJson<unknown[]>(filePath);
        const sessionId = entry.replace(/\.json$/, '');
        return {
            id: `memory-${sessionId}`,
            name: 'Memory writeback',
            status: 'completed',
            detail: 'Local Codetether memory evidence was persisted.',
            source: 'memory',
            evidenceCount: Array.isArray(evidence) ? evidence.length : 0,
            sessionId,
            updatedAt: stat.mtime.toISOString()
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
     * Reads directory names and hides missing local Codetether folders.
     */
    private async safeReadDirectory(directory: string): Promise<string[]> {
        try {
            return await fs.readdir(directory);
        } catch {
            return [];
        }
    }

    /**
     * Reads JSON and returns undefined when a file is unavailable.
     */
    private async safeReadJson<T>(filePath: string): Promise<T | undefined> {
        try {
            const raw = await fs.readFile(filePath, 'utf8');
            return JSON.parse(raw) as T;
        } catch {
            return undefined;
        }
    }

    /**
     * Reads newline-delimited JSON records from a local file.
     */
    private async safeReadJsonLines<T>(filePath: string): Promise<T[]> {
        try {
            const raw = await fs.readFile(filePath, 'utf8');
            return raw
                .split(/\r?\n/)
                .map(line => line.trim())
                .filter(Boolean)
                .map(line => JSON.parse(line) as T);
        } catch {
            return [];
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
     * Returns a permissive local activity lookback window.
     */
    private lookbackStart(): number {
        return this.startedAt - (60 * 60 * 1000);
    }

    /**
     * Returns a task journal's latest explicit status.
     */
    private taskStatus(record: TaskRecord): CodetetherSubagentActivity[
        'status'
    ] {
        const status = this.stringValue(record.status).toLowerCase();
        if (status === 'done' || status === 'completed') {
            return 'completed';
        }
        if (status === 'failed' || status === 'blocked') {
            return 'failed';
        }

        return 'running';
    }

    /**
     * Returns the latest objective recorded in a task journal.
     */
    private taskObjective(records: TaskRecord[]): string {
        for (let index = records.length - 1; index >= 0; index--) {
            const objective = this.stringValue(records[index].objective);
            if (objective) {
                return this.summarize(objective);
            }
        }

        return '';
    }

    /**
     * Counts completed status records in a task journal.
     */
    private doneTaskCount(records: TaskRecord[]): number {
        return records.filter(record => {
            const status = this.stringValue(record.status).toLowerCase();
            return status === 'done' || status === 'completed';
        }).length;
    }

    /**
     * Returns the status string from an arbitrary ledger item.
     */
    private itemStatus(item: unknown): string {
        const value = item as LedgerItem;
        return this.stringValue(value.status).toLowerCase();
    }

    /**
     * Counts evidence entries attached to a ledger file.
     */
    private evidenceCount(ledger: LedgerFile | undefined): number {
        return Array.isArray(ledger?.evidence) ? ledger.evidence.length : 0;
    }

    /**
     * Converts unknown values to strings for local activity display.
     */
    private stringValue(value: unknown): string {
        return typeof value === 'string' ? value.trim() : '';
    }

    /**
     * Returns a timestamp from a record field or filesystem fallback.
     */
    private timeValue(value: unknown, fallback: Date): string {
        return typeof value === 'string' ? value : fallback.toISOString();
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
