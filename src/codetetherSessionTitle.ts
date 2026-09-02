const MAX_SESSION_TITLE_LENGTH = 56;
const SESSION_TITLE_FALLBACK = 'VS Code chat';

/**
 * Derives a concise persisted-session title from the first user prompt.
 *
 * Whitespace is collapsed so multi-line requests remain readable in compact
 * session lists. Long titles preserve the same 56-character limit used by
 * live sidebar thread labels.
 */
export function codetetherSessionTitle(prompt: string): string {
    const normalized = prompt.replace(/\s+/gu, ' ').trim();
    if (!normalized) {
        return SESSION_TITLE_FALLBACK;
    }
    if (normalized.length <= MAX_SESSION_TITLE_LENGTH) {
        return normalized;
    }
    return `${normalized.slice(0, MAX_SESSION_TITLE_LENGTH - 3)}...`;
}