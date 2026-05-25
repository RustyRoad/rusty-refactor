/**
 * Shared shape for Codetether tool activity shown in the chat UI.
 */

/**
 * Describes one assistant tool call or the matching tool result.
 */
export interface CodetetherToolEvent {
    kind: 'call' | 'result';
    id: string;
    name?: string;
    arguments?: string;
    content?: string;
    truncated?: boolean;
}
