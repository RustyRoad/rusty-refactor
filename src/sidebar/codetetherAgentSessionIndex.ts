import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { Stats } from 'fs';

import { CodetetherAgentSessionRoot } from
    './codetetherAgentSessionRoot';
import type {
    CodetetherSessionSummary
} from './codetetherSessionTypes';

interface AgentSessionFile {
    id?: unknown;
    title?: unknown;
    updated_at?: unknown;
    created_at?: unknown;
    agent?: unknown;
    metadata?: {
        model?: unknown;
    };
    messages?: unknown;
}

interface AgentSessionMessage {
    role?: unknown;
    content?: unknown;
}

interface AgentSessionPart {
    text?: unknown;
}

interface AgentSessionEntry {
    name: string;
    filePath: string;
    stats: Stats;
}

/**
 * Reads display summaries from Codetether's durable JSON session store.
 */
export class CodetetherAgentSessionIndex {
    /**
     * Creates an index with an explicit workspace-root collaborator.
     */
    public constructor(
        private readonly root = new CodetetherAgentSessionRoot()
    ) {}

    /**
     * Lists the most recently modified valid agent session files.
     */
    public async list(
        limit = 20
    ): Promise<CodetetherSessionSummary[]> {
        const sessionRoot = this.root.path();
        if (!sessionRoot) {
            return [];
        }

        const entries = await this.sessionEntries(sessionRoot);
        const recent = entries
            .sort((left, right) => {
                return right.stats.mtimeMs - left.stats.mtimeMs;
            })
            .slice(0, limit);
        const summaries = await Promise.all(
            recent.map(entry => this.summary(entry))
        );
        return summaries.filter(this.isSummary);
    }

    /**
     * Reads candidate JSON files and their modification timestamps.
     */
    private async sessionEntries(
        sessionRoot: string
    ): Promise<AgentSessionEntry[]> {
        const directoryEntries = await this.readDirectory(sessionRoot);
        const candidates = directoryEntries.filter(entry => {
            return entry.isFile()
                && entry.name.endsWith('.json')
                && !entry.name.startsWith('.')
                && !entry.name.endsWith('.journal.json');
        });
        const entries = await Promise.all(candidates.map(async entry => {
            const filePath = path.join(sessionRoot, entry.name);
            const stats = await this.readStats(filePath);
            return stats ? { name: entry.name, filePath, stats } : undefined;
        }));
        return entries.filter(this.isEntry);
    }

    /**
     * Converts one valid session document into compact browser metadata.
     */
    private async summary(
        entry: AgentSessionEntry
    ): Promise<CodetetherSessionSummary | undefined> {
        const session = await this.readSession(entry.filePath);
        const id = this.stringValue(session?.id)
            || entry.name.replace(/\.json$/u, '');
        if (!session || !id) {
            return undefined;
        }

        const messages = Array.isArray(session.messages)
            ? session.messages
            : [];
        return {
            id,
            path: entry.filePath,
            turnCount: messages.length,
            updatedAt: this.updatedAt(session, entry.stats),
            preview: this.preview(session, messages),
            format: 'agent',
            agent: this.stringValue(session.agent),
            model: this.stringValue(session.metadata?.model)
        };
    }

    /**
     * Returns a stable update time from metadata or filesystem state.
     */
    private updatedAt(session: AgentSessionFile, stats: Stats): number {
        const value = this.stringValue(session.updated_at)
            || this.stringValue(session.created_at);
        const timestamp = Date.parse(value);
        return Number.isFinite(timestamp) ? timestamp : stats.mtimeMs;
    }

    /**
     * Returns the stored title or a compact first-user-message fallback.
     */
    private preview(
        session: AgentSessionFile,
        messages: unknown[]
    ): string {
        const title = this.stringValue(session.title);
        if (title) {
            return this.truncate(title);
        }

        const user = messages.find(message => {
            return (message as AgentSessionMessage).role === 'user';
        }) as AgentSessionMessage | undefined;
        return this.truncate(
            this.messageText(user) || 'Codetether session'
        );
    }

    /**
     * Extracts textual content from one stored session message.
     */
    private messageText(
        message: AgentSessionMessage | undefined
    ): string {
        const parts = Array.isArray(message?.content) ? message.content : [];
        return parts.map(part => {
            return this.stringValue((part as AgentSessionPart).text);
        }).filter(Boolean).join(' ');
    }

    /**
     * Normalizes and limits text for a dense session row.
     */
    private truncate(value: string): string {
        const normalized = value.replace(/\s+/gu, ' ').trim();
        return normalized.length > 120
            ? `${normalized.slice(0, 117)}...`
            : normalized;
    }

    /**
     * Reads directory entries while treating missing storage as empty.
     */
    private async readDirectory(
        directory: string
    ): Promise<fsSync.Dirent[]> {
        try {
            return await fs.readdir(directory, { withFileTypes: true });
        } catch {
            return [];
        }
    }

    /**
     * Reads file metadata while tolerating concurrent session cleanup.
     */
    private async readStats(filePath: string): Promise<Stats | undefined> {
        try {
            return await fs.stat(filePath);
        } catch {
            return undefined;
        }
    }

    /**
     * Parses one session while hiding incomplete concurrent writes.
     */
    private async readSession(
        filePath: string
    ): Promise<AgentSessionFile | undefined> {
        try {
            const raw = await fs.readFile(filePath, 'utf8');
            return JSON.parse(raw) as AgentSessionFile;
        } catch {
            return undefined;
        }
    }

    /**
     * Converts a scalar metadata value into display text.
     */
    private stringValue(value: unknown): string {
        return typeof value === 'string' ? value.trim() : '';
    }

    /**
     * Narrows optional indexed entries after transient stat failures.
     */
    private isEntry(
        entry: AgentSessionEntry | undefined
    ): entry is AgentSessionEntry {
        return Boolean(entry);
    }

    /**
     * Narrows optional summaries after invalid JSON files are skipped.
     */
    private isSummary(
        summary: CodetetherSessionSummary | undefined
    ): summary is CodetetherSessionSummary {
        return Boolean(summary);
    }
}
