import type {
    ChatMessage,
    CodetetherClient,
    JsChatResponse
} from '../codetetherClient';
import { isCodetetherCancellation } from '../codetetherChatProgress';
import type {
    CodetetherChatProgress
} from '../codetetherChatProgress';
import type {
    CodetetherSteeringSender
} from '../codetetherRealtimeTypes';
import type { CodetetherToolEvent } from '../codetetherToolEvents';
import { AgentPromptBuilder } from './agentPromptBuilder';
import { CHAT_SYSTEM_PROMPT } from './chatConstants';
import {
    normalizeFeature,
    normalizeMode,
    statusForMode
} from './chatModes';
import type {
    ChatHistory,
    ChatMode,
    CodetetherFeature,
    UserMessageRequest
} from './chatTypes';

/**
 * Describes one live assistant bubble owned by an active protocol request.
 */
export interface ChatRunSnapshot {
    id: string;
    content: string;
    thinking: string;
    phase: string;
    modelId: string;
    toolEvents: CodetetherToolEvent[];
    sessionId?: string;
    streaming: boolean;
    error: boolean;
    autoSpeak: boolean;
}

/**
 * Isolates webview effects from chat transport and steering state.
 */
export interface ChatRunSink {
    /** Publishes the latest immutable response snapshot. */
    progress(snapshot: ChatRunSnapshot): void;

    /** Handles side effects associated with one live model tool event. */
    tool(event: CodetetherToolEvent): void;

    /** Updates the user-facing run status and busy state. */
    status(message: string, busy: boolean): void;

    /** Starts mode-specific activity for a new response. */
    start(mode: ChatMode, feature: CodetetherFeature): void;

    /** Finalizes side effects for a completed or interrupted response. */
    finish(
        succeeded: boolean,
        toolEvents: CodetetherToolEvent[],
        interrupted: boolean
    ): void;
}

interface ActiveChatRun {
    controller: AbortController;
    snapshot: ChatRunSnapshot;
    priorContent: string;
    segment: number;
    interruptRequested: boolean;
    steer?: CodetetherSteeringSender;
}

/**
 * Runs one response at a time while turning new prompts into steering.
 */
export class ChatRunController {
    private history: ChatHistory = [];
    private active?: ActiveChatRun;
    private pendingSteering: UserMessageRequest[] = [];
    private interruptedContext = '';
    private sessionId = '';
    private nextResponseId = 0;
    private revision = 0;

    /**
     * Creates a run controller with explicit protocol and UI collaborators.
     */
    public constructor(
        private readonly client: CodetetherClient,
        private readonly sink: ChatRunSink,
        private readonly promptBuilder = new AgentPromptBuilder()
    ) {
        this.resetHistory();
    }

    /**
     * Starts a request or interrupts the active run with a steering update.
     */
    public async submit(request: UserMessageRequest): Promise<void> {
        if (!request.text.trim()) {
            return;
        }

        if (this.active) {
            if (await this.steerActiveRun(request)) {
                return;
            }
            this.pendingSteering.push(request);
            this.sink.status('Applying steering update...', true);
            this.active.controller.abort();
            return;
        }

        await this.run(request);
    }

    /**
     * Requests a hard stop and preserves visible evidence after termination.
     */
    public interrupt(): boolean {
        const active = this.active;
        if (!active || active.interruptRequested) {
            return false;
        }

        this.pendingSteering = [];
        active.interruptRequested = true;
        active.steer = undefined;
        this.sink.status('Interrupting...', true);
        active.controller.abort();
        return true;
    }

    /**
     * Cancels active work and restores the initial system-only history.
     */
    public clear(): void {
        this.revision += 1;
        this.pendingSteering = [];
        this.interruptedContext = '';
        this.sessionId = '';
        this.active?.controller.abort();
        this.resetHistory();
    }

    /**
     * Replaces local history when the user opens a persisted session.
     */
    public replaceHistory(
        history: ChatHistory,
        sessionId = ''
    ): void {
        this.revision += 1;
        this.pendingSteering = [];
        this.interruptedContext = '';
        this.sessionId = sessionId;
        this.active?.controller.abort();
        this.history = [...history];
    }

    /**
     * Builds and executes one request, then drains queued steering updates.
     */
    private async run(request: UserMessageRequest): Promise<void> {
        const revision = this.revision;
        const mode = normalizeMode(request.mode);
        const feature = normalizeFeature(request.feature);
        const prompt = await this.promptBuilder.buildAgentPrompt(
            request.text.trim(),
            mode,
            feature,
            request.includeContext,
            request.model || ''
        );
        this.history.push({
            role: 'user',
            content: this.withInterruptedContext(prompt)
        });

        const active = this.createActiveRun(request);
        this.active = active;
        this.sink.status(statusForMode(mode), true);
        this.sink.start(mode, feature);
        this.sink.progress(active.snapshot);

        try {
            const response = await this.client.chatCompletion(
                this.history,
                {
                    model: request.model || undefined,
                    modelOptions: request.modelOptions,
                    signal: active.controller.signal,
                    sessionId: this.sessionId || undefined,
                    onProgress: progress => {
                        this.applyProgress(active, progress);
                    },
                    onSteeringReady: sender => {
                        if (this.active === active) {
                            active.steer = sender;
                        }
                    },
                    sessionTitle: request.text.trim()
                }
            );
            if (active.interruptRequested) {
                if (revision === this.revision) {
                    this.hardInterruptRun(active);
                }
                return;
            }
            this.completeRun(active, response);
        } catch (error) {
            if (active.interruptRequested) {
                if (revision === this.revision) {
                    this.hardInterruptRun(active);
                }
                return;
            }
            if (isCodetetherCancellation(error)) {
                if (revision === this.revision) {
                    this.interruptRun(active);
                }
            } else {
                this.failRun(active, error);
            }
        } finally {
            if (this.active === active) {
                this.active = undefined;
            }
            if (revision === this.revision) {
                await this.runPendingSteering();
            }
        }
    }

    /**
     * Creates the initial thinking snapshot and cancellation controller.
     */
    private createActiveRun(request: UserMessageRequest): ActiveChatRun {
        return {
            controller: new AbortController(),
            snapshot: this.createResponseSnapshot(request),
            priorContent: '',
            segment: 0,
            interruptRequested: false
        };
    }

    /**
     * Creates one assistant bubble for an initial or steered response segment.
     */
    private createResponseSnapshot(
        request: UserMessageRequest
    ): ChatRunSnapshot {
        this.nextResponseId += 1;
        return {
            id: `response-${this.nextResponseId}`,
            content: '',
            thinking: '',
            phase: 'thinking',
            modelId: request.model || '',
            toolEvents: [],
            sessionId: this.sessionId || undefined,
            streaming: true,
            error: false,
            autoSpeak: Boolean(request.autoSpeak)
        };
    }

    /**
     * Applies one transport update to the live assistant snapshot.
     */
    private applyProgress(
        active: ActiveChatRun,
        progress: CodetetherChatProgress
    ): void {
        if (this.active !== active || active.interruptRequested) {
            return;
        }

        active.snapshot.phase = progress.phase;
        active.snapshot.content += progress.textDelta || '';
        active.snapshot.thinking += progress.thinkingDelta || '';
        active.snapshot.sessionId = progress.sessionId
            || active.snapshot.sessionId;
        this.sessionId = progress.sessionId || this.sessionId;
        if (progress.toolEvent) {
            active.snapshot.toolEvents = this.mergeToolEvent(
                active.snapshot.toolEvents,
                progress.toolEvent
            );
            this.sink.tool(progress.toolEvent);
        }
        this.sink.status(progress.message, true);
        this.sink.progress(this.snapshotCopy(active.snapshot));
    }

    /**
     * Records the final response and marks the live bubble complete.
     */
    private completeRun(
        active: ActiveChatRun,
        response: JsChatResponse
    ): void {
        active.snapshot.content = active.snapshot.content
            || this.responseSegmentText(response.text, active.priorContent)
            || '*(No response text returned.)*';
        active.snapshot.sessionId = response.session_id
            || active.snapshot.sessionId;
        this.sessionId = response.session_id || this.sessionId;
        active.snapshot.modelId = response.model_id
            || active.snapshot.modelId;
        active.snapshot.toolEvents = active.segment > 0
            ? active.snapshot.toolEvents
            : this.responseToolEvents(
                response,
                active.snapshot.toolEvents
            );
        active.snapshot.phase = 'complete';
        active.snapshot.streaming = false;
        this.history.push(this.toAssistantMessage(
            response,
            active.snapshot.content
        ));
        this.sink.progress(this.snapshotCopy(active.snapshot));
        this.sink.finish(true, active.snapshot.toolEvents, false);
        this.sink.status('Ready', false);
    }

    /**
     * Preserves partial visible work as context before the next steer runs.
     */
    private interruptRun(active: ActiveChatRun): void {
        this.finalizeInterruptedRun(
            active,
            'steered',
            'Interrupted by steering.'
        );
        if (this.pendingSteering.length === 0) {
            this.sink.status('Ready', false);
        }
    }

    /**
     * Finalizes a user-requested stop without clearing the chat transcript.
     */
    private hardInterruptRun(active: ActiveChatRun): void {
        this.finalizeInterruptedRun(
            active,
            'interrupted',
            'Hard interrupted by user.'
        );
        this.sink.status('Interrupted', false);
    }

    /**
     * Preserves partial output and closes one interrupted response snapshot.
     */
    private finalizeInterruptedRun(
        active: ActiveChatRun,
        phase: string,
        note: string
    ): void {
        this.interruptedContext = this.describeInterruptedRun(
            active.snapshot
        );
        active.snapshot.phase = phase;
        active.snapshot.streaming = false;
        active.snapshot.autoSpeak = false;
        active.snapshot.content = active.snapshot.content
            ? `${active.snapshot.content}\n\n*(${note})*`
            : `*(${note})*`;
        this.sink.progress(this.snapshotCopy(active.snapshot));
        this.sink.finish(false, active.snapshot.toolEvents, true);
    }

    /**
     * Sends new user text into the current model turn when it is steerable.
     */
    private async steerActiveRun(
        request: UserMessageRequest
    ): Promise<boolean> {
        const active = this.active;
        if (!active?.steer) {
            return false;
        }
        this.sink.status('Sending steering update...', true);
        const accepted = await active.steer(request.text.trim());
        if (!accepted || this.active !== active) {
            return false;
        }
        this.startSteeringSegment(active, request);
        this.history.push({
            role: 'user',
            content: request.text.trim()
        });
        this.sink.status('Steering accepted by the active turn.', true);
        return true;
    }

    /**
     * Closes the current bubble and starts a new one for post-steer output.
     */
    private startSteeringSegment(
        active: ActiveChatRun,
        request: UserMessageRequest
    ): void {
        const previous = active.snapshot;
        previous.phase = 'steered';
        previous.streaming = false;
        previous.autoSpeak = false;
        active.priorContent += previous.content;
        if (previous.content.trim()) {
            this.history.push({
                role: 'assistant',
                content: previous.content
            });
        }
        this.sink.progress(this.snapshotCopy(previous));
        active.segment += 1;
        active.snapshot = this.createResponseSnapshot(request);
        this.sink.progress(this.snapshotCopy(active.snapshot));
    }

    /**
     * Removes already-rendered text when a terminal result is cumulative.
     */
    private responseSegmentText(
        responseText: string | undefined,
        priorContent: string
    ): string {
        const text = responseText || '';
        return priorContent && text.startsWith(priorContent)
            ? text.slice(priorContent.length).trimStart()
            : text;
    }

    /**
     * Converts a transport failure into the active bubble's error state.
     */
    private failRun(active: ActiveChatRun, error: unknown): void {
        const message = error instanceof Error
            ? error.message
            : 'Unknown error occurred';
        active.snapshot.phase = 'error';
        active.snapshot.streaming = false;
        active.snapshot.error = true;
        active.snapshot.autoSpeak = false;
        active.snapshot.content = `**Codetether error:** ${message}`;
        this.sink.progress(this.snapshotCopy(active.snapshot));
        this.sink.finish(false, active.snapshot.toolEvents, false);
        this.sink.status('Ready', false);
    }

    /**
     * Combines rapid steering messages and starts their replacement request.
     */
    private async runPendingSteering(): Promise<void> {
        if (this.active || this.pendingSteering.length === 0) {
            return;
        }

        const queued = this.pendingSteering.splice(0);
        const latest = queued[queued.length - 1];
        const combined = queued.map(item => item.text.trim())
            .filter(Boolean)
            .join('\n\nAdditional steering:\n');
        await this.run({
            ...latest,
            text: combined
        });
    }

    /**
     * Adds interrupted runtime evidence to the next user direction once.
     */
    private withInterruptedContext(prompt: string): string {
        if (!this.interruptedContext) {
            return prompt;
        }

        const context = this.interruptedContext;
        this.interruptedContext = '';
        return [
            prompt,
            'Runtime context from the interrupted request:',
            context,
            'Inspect current workspace state before continuing.'
        ].join('\n\n');
    }

    /**
     * Summarizes observable partial output without replaying hidden reasoning.
     */
    private describeInterruptedRun(snapshot: ChatRunSnapshot): string {
        const visible = snapshot.content
            .slice(0, 4_000);
        const tools = snapshot.toolEvents
            .map(event => event.name || event.id)
            .filter(Boolean)
            .join(', ');
        return [
            visible ? `Partial assistant output:\n${visible}` : '',
            tools ? `Observed tool activity: ${tools}` : ''
        ].filter(Boolean).join('\n\n')
            || 'The prior request was interrupted before visible output.';
    }

    /**
     * Upserts one tool event so fragmented protocol updates do not duplicate.
     */
    private mergeToolEvent(
        events: CodetetherToolEvent[],
        event: CodetetherToolEvent
    ): CodetetherToolEvent[] {
        const next = [...events];
        const index = next.findIndex(item => {
            return item.id === event.id && item.kind === event.kind;
        });
        if (index >= 0) {
            next[index] = event;
        } else {
            next.push(event);
        }
        return next;
    }

    /**
     * Prefers completed session events while retaining live-only activity.
     */
    private responseToolEvents(
        response: JsChatResponse,
        liveEvents: CodetetherToolEvent[]
    ): CodetetherToolEvent[] {
        let events = [...liveEvents];
        const completed = response.tool_events
            || (response.tool_calls || []).map(toolCall => ({
                kind: 'call' as const,
                id: toolCall.id,
                name: toolCall.name,
                arguments: toolCall.arguments
            }));

        for (const event of completed) {
            events = this.mergeToolEvent(events, event);
        }
        return events;
    }

    /**
     * Converts a completed response into provider conversation history.
     */
    private toAssistantMessage(
        response: JsChatResponse,
        content = response.text
    ): ChatMessage {
        const message: ChatMessage = { role: 'assistant' };
        if (content) {
            message.content = content;
        }
        if (response.tool_calls) {
            message.tool_calls = response.tool_calls;
        }
        return message;
    }

    /**
     * Clones mutable arrays before handing a snapshot to the webview sink.
     */
    private snapshotCopy(snapshot: ChatRunSnapshot): ChatRunSnapshot {
        return {
            ...snapshot,
            toolEvents: [...snapshot.toolEvents]
        };
    }

    /**
     * Restores the invariant that every conversation starts with identity.
     */
    private resetHistory(): void {
        this.history = [{
            role: 'system',
            content: CHAT_SYSTEM_PROMPT
        }];
    }
}