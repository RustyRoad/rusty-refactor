import type {
    CodetetherChatProgressSink
} from './codetetherChatProgress';
import type { CodetetherToolEvent } from './codetetherToolEvents';

/**
 * Describes one durable event streamed from a live CodeTether turn.
 */
export interface CodetetherThreadEvent {
    event_id: string;
    session_id: string;
    turn_id: string;
    kind: string;
    payload: Record<string, unknown>;
}

/**
 * Contains the server-owned terminal response for one prompt.
 */
export interface CodetetherRealtimeSessionResult {
    text: string;
    session_id: string;
}

/**
 * Names every frame accepted from the realtime server.
 */
export type CodetetherRealtimeServerFrame =
    | { type: 'ready'; session_id: string }
    | { type: 'event'; event: CodetetherThreadEvent }
    | {
        type: 'steering';
        request_id: string;
        accepted: boolean;
    }
    | { type: 'result'; result: CodetetherRealtimeSessionResult }
    | { type: 'error'; message: string };

/**
 * Result assembled from terminal text and ordered tool events.
 */
export interface CodetetherRealtimeResult {
    text: string;
    sessionId: string;
    toolEvents: CodetetherToolEvent[];
}

/**
 * Sends a steering message into the currently active model turn.
 */
export type CodetetherSteeringSender = (
    message: string
) => Promise<boolean>;

/**
 * Supplies cancellation, progress, and session continuity to one turn.
 */
export interface CodetetherRealtimeOptions {
    sessionId?: string;
    sessionTitle?: string;
    signal?: AbortSignal;
    sink?: CodetetherChatProgressSink;
    onSteeringReady?: (
        sender: CodetetherSteeringSender
    ) => void;
}