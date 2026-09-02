const maximumChunkCharacters = 180;
const minimumPreferredCharacters = 60;

/**
 * Splits normalized speech text into bounded chunks that can begin playback
 * without waiting for the complete assistant response to synthesize.
 */
export function splitSpeechText(text: string): string[] {
    const chunks: string[] = [];
    let remaining = text.replace(/\s+/g, ' ').trim();
    while (remaining.length > maximumChunkCharacters) {
        const boundary = chunkBoundary(remaining);
        chunks.push(remaining.slice(0, boundary).trim());
        remaining = remaining.slice(boundary).trim();
    }
    if (remaining) {
        chunks.push(remaining);
    }
    return chunks;
}

/**
 * Chooses a sentence boundary first, then whitespace, before a hard limit.
 */
function chunkBoundary(text: string): number {
    for (
        let index = maximumChunkCharacters;
        index >= minimumPreferredCharacters;
        index -= 1
    ) {
        if (text[index] === ' '
                && isSentenceEnding(text[index - 1])) {
            return index;
        }
    }

    const whitespace = text.lastIndexOf(
        ' ',
        maximumChunkCharacters
    );
    return whitespace >= minimumPreferredCharacters
        ? whitespace
        : maximumChunkCharacters;
}

/**
 * Returns whether a character provides a natural speech pause.
 */
function isSentenceEnding(character: string): boolean {
    return character === '.'
        || character === '!'
        || character === '?'
        || character === ';'
        || character === ':';
}
