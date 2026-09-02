import type { CodetetherToolEvent } from './codetetherToolEvents';

/**
 * Names the live stage of one CodeTether response.
 */
export type CodetetherChatPhase =
    | 'thinking'
    | 'answer'
    | 'tool'
    | 'complete';

/**
 * Carries one incremental protocol update without owning UI state.
 */
export interface CodetetherChatProgress {
    phase: CodetetherChatPhase;
    message: string;
    textDelta?: string;
    thinkingDelta?: string;
    toolEvent?: CodetetherToolEvent;
    sessionId?: string;
}

/**
 * Receives live CodeTether updates in transport order.
 */
export type CodetetherChatProgressSink = (
    progress: CodetetherChatProgress
) => void;

/**
 * Creates the consistent cancellation error used by both transports.
 */
export function codetetherCancelledError(): Error {
    const error = new Error('CodeTether request cancelled.');
    error.name = 'AbortError';
    return error;
}

/**
 * Identifies cancellation without depending on a platform-specific class.
 */
export function isCodetetherCancellation(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}
