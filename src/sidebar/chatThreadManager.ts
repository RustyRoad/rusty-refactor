import type { CodetetherClient } from '../codetetherClient';
import type { CodetetherToolEvent } from '../codetetherToolEvents';
import {
    ChatRunController,
    ChatRunSink,
    ChatRunSnapshot
} from './chatRunController';
import type {
    ChatHistory,
    ChatMode,
    CodetetherFeature,
    UserMessageRequest
} from './chatTypes';

/**
 * Describes one live chat thread shown in the sidebar session browser.
 */
export interface ChatThreadSummary {
    id: string;
    title: string;
    busy: boolean;
    statusText: string;
    updatedAt: string;
    sessionId: string;
}

/**
 * Receives thread-scoped transport and lifecycle effects.
 */
export interface ChatThreadSink {
    /** Publishes one assistant response for a specific chat thread. */
    progress(threadId: string, snapshot: ChatRunSnapshot): void;

    /** Handles a tool event without losing its owning thread. */
    tool(threadId: string, event: CodetetherToolEvent): void;

    /** Updates status for one thread and the visible composer when active. */
    status(threadId: string, message: string, busy: boolean): void;

    /** Starts thread-scoped activity associated with one response. */
    start(
        threadId: string,
        mode: ChatMode,
        feature: CodetetherFeature
    ): void;

    /** Finalizes thread-scoped activity associated with one response. */
    finish(
        threadId: string,
        succeeded: boolean,
        toolEvents: CodetetherToolEvent[],
        interrupted: boolean
    ): void;

    /** Publishes the complete thread index and current selection. */
    threadsChanged(
        threads: ChatThreadSummary[],
        activeThreadId: string
    ): void;
}

interface ChatThreadRecord extends ChatThreadSummary {
    run: ChatRunController;
    hasUserPrompt: boolean;
}

/**
 * Owns independent chat controllers so background sessions can keep running.
 */
export class ChatThreadManager {
    private readonly threads = new Map<string, ChatThreadRecord>();
    private activeId = '';
    private nextThreadId = 0;

    /**
     * Creates the initial blank thread for the sidebar composer.
     */
    public constructor(
        private readonly client: CodetetherClient,
        private readonly sink: ChatThreadSink
    ) {
        this.createThread();
    }

    /**
     * Creates and selects a blank thread without interrupting existing work.
     */
    public createThread(): ChatThreadSummary {
        return this.addThread('New chat');
    }

    /**
     * Creates a selected thread from persisted conversation history.
     */
    public openThread(
        title: string,
        history: ChatHistory,
        sessionId: string
    ): ChatThreadSummary {
        const summary = this.addThread(title || 'Previous chat');
        const thread = this.threads.get(summary.id)!;
        thread.hasUserPrompt = true;
        thread.sessionId = sessionId;
        thread.run.replaceHistory(history, sessionId);
        this.publishThreads();
        return this.toSummary(thread);
    }

    /**
     * Selects a known thread while leaving every transport run untouched.
     */
    public selectThread(threadId: string): boolean {
        if (!this.threads.has(threadId)) {
            return false;
        }

        this.activeId = threadId;
        this.publishThreads();
        return true;
    }

    /**
     * Routes a prompt to its owning thread or the current selection.
     */
    public async submit(
        threadId: string,
        request: UserMessageRequest
    ): Promise<void> {
        const thread = this.threadForRequest(threadId);
        if (!thread || !request.text.trim()) {
            return;
        }

        this.setTitleFromRequest(thread, request.text);
        thread.updatedAt = new Date().toISOString();
        this.publishThreads();
        await thread.run.submit(request);
    }

    /**
     * Clears one thread's history and cancels only that thread's active run.
     */
    public clearThread(threadId = this.activeId): boolean {
        const thread = this.threads.get(threadId);
        if (!thread) {
            return false;
        }

        thread.run.clear();
        thread.title = 'New chat';
        thread.busy = false;
        thread.statusText = 'Ready';
        thread.sessionId = '';
        thread.hasUserPrompt = false;
        thread.updatedAt = new Date().toISOString();
        this.publishThreads();
        return true;
    }

    /**
     * Hard-stops one thread without clearing history or sibling transports.
     */
    public interruptThread(threadId = this.activeId): boolean {
        const thread = this.threads.get(threadId);
        if (!thread) {
            return false;
        }

        return thread.run.interrupt();
    }

    /**
     * Returns the currently selected thread identifier.
     */
    public activeThreadId(): string {
        return this.activeId;
    }

    /**
     * Returns whether a thread is the current visible selection.
     */
    public isActive(threadId: string): boolean {
        return threadId === this.activeId;
    }

    /**
     * Returns immutable display summaries ordered by recent activity.
     */
    public summaries(): ChatThreadSummary[] {
        return [...this.threads.values()]
            .sort((left, right) => {
                return right.updatedAt.localeCompare(left.updatedAt);
            })
            .map(thread => this.toSummary(thread));
    }

    /**
     * Cancels every thread when the owning webview is disposed.
     */
    public dispose(): void {
        for (const thread of this.threads.values()) {
            thread.run.clear();
        }
    }

    /**
     * Creates one controller and selects its new thread record.
     */
    private addThread(title: string): ChatThreadSummary {
        this.nextThreadId += 1;
        const id = `chat-${this.nextThreadId}`;
        const thread: ChatThreadRecord = {
            id,
            title,
            busy: false,
            statusText: 'Ready',
            updatedAt: new Date().toISOString(),
            sessionId: '',
            run: new ChatRunController(
                this.client,
                this.createRunSink(id),
                undefined,
                id
            ),
            hasUserPrompt: false
        };
        this.threads.set(id, thread);
        this.activeId = id;
        this.publishThreads();
        return this.toSummary(thread);
    }

    /**
     * Connects one controller to thread-aware manager effects.
     */
    private createRunSink(threadId: string): ChatRunSink {
        return {
            progress: snapshot => {
                this.handleProgress(threadId, snapshot);
            },
            tool: event => {
                this.sink.tool(threadId, event);
            },
            status: (message, busy) => {
                this.handleStatus(threadId, message, busy);
            },
            start: (mode, feature) => {
                this.sink.start(threadId, mode, feature);
            },
            finish: (succeeded, toolEvents, interrupted) => {
                this.sink.finish(
                    threadId,
                    succeeded,
                    toolEvents,
                    interrupted
                );
            }
        };
    }

    /**
     * Publishes progress with a globally unique browser message identifier.
     */
    private handleProgress(
        threadId: string,
        snapshot: ChatRunSnapshot
    ): void {
        const thread = this.threads.get(threadId);
        if (!thread) {
            return;
        }

        const nextSessionId = snapshot.sessionId || thread.sessionId;
        const sessionChanged = nextSessionId !== thread.sessionId;
        thread.sessionId = nextSessionId;
        thread.updatedAt = new Date().toISOString();
        this.sink.progress(threadId, {
            ...snapshot,
            id: `${threadId}-${snapshot.id}`
        });
        if (sessionChanged) {
            this.publishThreads();
        }
    }

    /**
     * Stores one thread's latest busy state before publishing it.
     */
    private handleStatus(
        threadId: string,
        message: string,
        busy: boolean
    ): void {
        const thread = this.threads.get(threadId);
        if (!thread) {
            return;
        }

        thread.busy = busy;
        thread.statusText = message || (busy ? 'Working...' : 'Ready');
        thread.updatedAt = new Date().toISOString();
        this.sink.status(threadId, thread.statusText, busy);
        this.publishThreads();
    }

    /**
     * Resolves a requested thread without silently creating extra chats.
     */
    private threadForRequest(
        threadId: string
    ): ChatThreadRecord | undefined {
        const requested = threadId || this.activeId;
        return this.threads.get(requested);
    }

    /**
     * Derives a compact thread title from its first accepted user prompt.
     */
    private setTitleFromRequest(
        thread: ChatThreadRecord,
        text: string
    ): void {
        if (thread.hasUserPrompt) {
            return;
        }

        const normalized = text.replace(/\s+/gu, ' ').trim();
        thread.title = normalized.length > 56
            ? `${normalized.slice(0, 53)}...`
            : normalized;
        thread.hasUserPrompt = true;
    }

    /**
     * Sends a detached thread index to the provider and webview.
     */
    private publishThreads(): void {
        this.sink.threadsChanged(this.summaries(), this.activeId);
    }

    /**
     * Removes controller internals from a browser-facing thread summary.
     */
    private toSummary(thread: ChatThreadRecord): ChatThreadSummary {
        return {
            id: thread.id,
            title: thread.title,
            busy: thread.busy,
            statusText: thread.statusText,
            updatedAt: thread.updatedAt,
            sessionId: thread.sessionId
        };
    }
}