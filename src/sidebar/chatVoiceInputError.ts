const privacyError =
    'Enable Windows speech privacy before using voice input.';

/**
 * Returns whether a voice-input failure represents an intentional stop.
 *
 * Windows and the local audio companion use different spellings, so the
 * comparison normalizes punctuation before checking known cancellation text.
 */
export function isVoiceInputCancellation(error: unknown): boolean {
    const normalized = rawErrorText(error)
        .toLowerCase()
        .replace(/[^a-z]+/gu, ' ')
        .trim();
    return normalized.includes('user canceled')
        || normalized.includes('user cancelled')
        || normalized.includes('voice input was canceled')
        || normalized.includes('voice input was cancelled');
}

/**
 * Converts native speech diagnostics into one concise status message.
 */
export function compactVoiceInputError(error: unknown): string {
    const raw = rawErrorText(error);
    if (raw.toLowerCase().includes('speech privacy policy')) {
        return privacyError;
    }

    const message = raw
        .split(/\r?\n/u)
        .map(line => line.trim())
        .filter(line => line && !isBacktraceLine(line))
        .slice(0, 4)
        .join(' ')
        .replace(/^error:\s*/iu, '');
    return message || 'Voice input failed.';
}

/**
 * Extracts message text without exposing an Error object's runtime stack.
 */
function rawErrorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Identifies native backtrace rows that should never reach the sidebar.
 */
function isBacktraceLine(line: string): boolean {
    return line === 'Stack backtrace:' || /^\d+:/u.test(line);
}
