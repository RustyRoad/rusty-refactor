import type { CodetetherChatProgress } from './codetetherChatProgress';
import { realtimeString } from './codetetherRealtimeFields';
import type {
    CodetetherThreadEvent
} from './codetetherRealtimeTypes';
import type { CodetetherToolEvent } from './codetetherToolEvents';

/**
 * Builds stable UI tool records from fragmented realtime events.
 */
export class CodetetherRealtimeTools {
    private readonly events: CodetetherToolEvent[] = [];
    private readonly output = new Map<string, string>();

    /**
     * Applies one supported tool event and returns its UI progress update.
     */
    public apply(
        event: CodetetherThreadEvent
    ): CodetetherChatProgress | undefined {
        if (event.kind === 'tool.started') {
            return this.started(event);
        }
        if (event.kind === 'tool.output_chunk') {
            return this.outputChunk(event);
        }
        if (event.kind === 'tool.completed') {
            return this.completed(event);
        }
        return undefined;
    }

    /**
     * Returns a copy of all tool calls and results observed so far.
     */
    public list(): CodetetherToolEvent[] {
        return this.events.map(event => ({ ...event }));
    }

    /**
     * Records the start of one tool invocation.
     */
    private started(event: CodetetherThreadEvent): CodetetherChatProgress {
        const id = realtimeString(event.payload, 'tool_call_id');
        const name = realtimeString(event.payload, 'name');
        const toolEvent: CodetetherToolEvent = {
            kind: 'call',
            id,
            name,
            arguments: realtimeString(event.payload, 'arguments')
        };
        this.upsert(toolEvent);
        return {
            phase: 'tool',
            message: `Running ${name}...`,
            toolEvent
        };
    }

    /**
     * Accumulates stdout or stderr emitted while a tool is running.
     */
    private outputChunk(
        event: CodetetherThreadEvent
    ): CodetetherChatProgress {
        const id = realtimeString(event.payload, 'tool_call_id');
        const name = realtimeString(event.payload, 'name');
        const content = (this.output.get(id) || '')
            + realtimeString(event.payload, 'chunk');
        this.output.set(id, content);
        const toolEvent: CodetetherToolEvent = {
            kind: 'result',
            id,
            name,
            content
        };
        this.upsert(toolEvent);
        return {
            phase: 'tool',
            message: `Streaming ${name} output...`,
            toolEvent
        };
    }

    /**
     * Replaces partial output with the authoritative terminal result.
     */
    private completed(
        event: CodetetherThreadEvent
    ): CodetetherChatProgress {
        const id = realtimeString(event.payload, 'tool_call_id');
        const name = realtimeString(event.payload, 'name');
        const toolEvent: CodetetherToolEvent = {
            kind: 'result',
            id,
            name,
            content: realtimeString(event.payload, 'output')
        };
        this.upsert(toolEvent);
        return {
            phase: 'tool',
            message: `${name} completed.`,
            toolEvent
        };
    }

    /**
     * Updates one tool phase without duplicating fragmented records.
     */
    private upsert(event: CodetetherToolEvent): void {
        const index = this.events.findIndex(candidate => {
            return candidate.id === event.id
                && candidate.kind === event.kind;
        });
        if (index >= 0) {
            this.events[index] = event;
        } else {
            this.events.push(event);
        }
    }
}
