import type {
    CodetetherChatProgressSink
} from './codetetherChatProgress';
import { realtimeString } from './codetetherRealtimeFields';
import { CodetetherRealtimeText } from './codetetherRealtimeText';
import { CodetetherRealtimeTools } from './codetetherRealtimeTools';
import type {
    CodetetherThreadEvent
} from './codetetherRealtimeTypes';
import type { CodetetherToolEvent } from './codetetherToolEvents';

/**
 * Routes ordered thread events into the existing sidebar progress contract.
 */
export class CodetetherRealtimeEvents {
    private readonly text = new CodetetherRealtimeText();
    private readonly tools = new CodetetherRealtimeTools();
    private pendingText = '';
    private pendingItemId = '';
    private pendingSessionId = '';
    private emittedThinking = false;

    /**
     * Creates an event router for an optional progress consumer.
     */
    public constructor(
        private readonly sink?: CodetetherChatProgressSink
    ) {}

    /**
     * Applies one event while preserving its server-defined order.
     */
    public apply(event: CodetetherThreadEvent): void {
        if (event.kind === 'item.delta') {
            this.beginTextItem(event);
            this.text.apply(event);
            return;
        }
        if (event.kind === 'item.completed') {
            this.retainCompletedText(event);
            return;
        }
        if (event.kind === 'turn.done') {
            this.finishTurn();
            return;
        }
        if (this.supersedesPendingText(event.kind)) {
            this.emitPendingThinking();
        }
        const toolProgress = this.tools.apply(event);
        if (toolProgress) {
            this.sink?.(toolProgress);
            return;
        }
        if (event.kind === 'approval.requested') {
            const tool = realtimeString(event.payload, 'tool');
            this.sink?.({
                phase: 'tool',
                message: `Approval required for ${tool}.`
            });
        }
    }

    /**
     * Returns all tool activity assembled from the event stream.
     */
    public toolEvents(): CodetetherToolEvent[] {
        return this.tools.list();
    }

    /**
     * Returns a terminal failure embedded in one thread event.
     */
    public failure(event: CodetetherThreadEvent): string {
        return event.kind === 'turn.failed'
            ? realtimeString(event.payload, 'error')
            : '';
    }

    /**
     * Retains a complete assistant item until subsequent activity classifies
     * it as progress or the turn boundary classifies it as the final answer.
     */
    private retainCompletedText(event: CodetetherThreadEvent): void {
        this.beginTextItem(event);
        const text = this.text.complete(event);
        if (!text) {
            return;
        }
        this.pendingText = text;
        this.pendingItemId = realtimeString(event.payload, 'item_id');
        this.pendingSessionId = event.session_id;
    }

    /**
     * Moves an earlier completed item aside when a distinct text item starts.
     */
    private beginTextItem(event: CodetetherThreadEvent): void {
        const itemId = realtimeString(event.payload, 'item_id');
        if (this.pendingText && itemId !== this.pendingItemId) {
            this.emitPendingThinking();
        }
    }

    /**
     * Identifies runtime activity proving a completed text item was progress.
     */
    private supersedesPendingText(kind: string): boolean {
        return kind === 'item.started'
            || kind.startsWith('tool.')
            || kind === 'approval.requested';
    }

    /**
     * Moves a superseded assistant item into the reasoning presentation.
     */
    private emitPendingThinking(): void {
        if (!this.pendingText) {
            return;
        }
        const separator = this.emittedThinking ? '\n\n' : '';
        this.sink?.({
            phase: 'thinking',
            message: 'CodeTether is reasoning...',
            thinkingDelta: separator + this.pendingText,
            sessionId: this.pendingSessionId || undefined
        });
        this.pendingText = '';
        this.pendingItemId = '';
        this.pendingSessionId = '';
        this.emittedThinking = true;
    }

    /**
     * Emits the last assistant item as the visible response at turn completion.
     */
    private emitPendingAnswer(): void {
        if (!this.pendingText) {
            return;
        }
        this.sink?.({
            phase: 'answer',
            message: 'CodeTether is responding...',
            textDelta: this.pendingText,
            sessionId: this.pendingSessionId || undefined
        });
        this.pendingText = '';
        this.pendingItemId = '';
        this.pendingSessionId = '';
    }

    /**
     * Publishes the terminal answer before the protocol completion marker.
     */
    private finishTurn(): void {
        this.emitPendingAnswer();
        this.sink?.({
            phase: 'complete',
            message: 'CodeTether turn completed.'
        });
    }
}