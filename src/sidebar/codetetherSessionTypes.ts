/**
 * Describes one persisted Codetether session for sidebar display.
 */
export interface CodetetherSessionSummary {
    id: string;
    path: string;
    turnCount: number;
    updatedAt: number;
    preview: string;
    format: 'agent' | 'history';
    agent?: string;
    model?: string;
}
