const streamingSpeechMaximum = 180;
const streamingSpeechMinimum = 32;

/**
 * Removes stable speech fragments while retaining an incomplete tail.
 *
 * @param {string} value - Unspoken raw Markdown received so far.
 * @param {boolean} final - Whether no more model text will arrive.
 * @returns {{chunks: string[], remainder: string}} Extracted speech input.
 */
function takeStreamingSpeechChunks(value, final) {
    const chunks = [];
    let remainder = String(value || '');
    while (remainder.trim()) {
        const boundary = streamingSpeechBoundary(remainder, final);
        if (!boundary) {
            break;
        }
        const chunk = remainder.slice(0, boundary).trim();
        remainder = remainder.slice(boundary);
        if (chunk) {
            chunks.push(chunk);
        }
    }
    return { chunks, remainder };
}

/**
 * Chooses the earliest sentence pause or a bounded whitespace fallback.
 *
 * @param {string} text - Current unspoken Markdown tail.
 * @param {boolean} final - Whether the tail may be flushed immediately.
 * @returns {number} Exclusive chunk boundary, or zero when more text helps.
 */
function streamingSpeechBoundary(text, final) {
    const limit = Math.min(text.length, streamingSpeechMaximum);
    for (let index = streamingSpeechMinimum; index < limit; index += 1) {
        if (isStreamingSpeechPause(text[index - 1])
                && /\s/u.test(text[index])) {
            return index;
        }
    }
    if (text.length > streamingSpeechMaximum) {
        const whitespace = text.lastIndexOf(
            ' ',
            streamingSpeechMaximum,
        );
        return whitespace >= streamingSpeechMinimum
            ? whitespace
            : streamingSpeechMaximum;
    }
    return final ? text.length : 0;
}

/**
 * Identifies punctuation that gives synthesized speech a natural pause.
 *
 * @param {string} character - Candidate final character.
 * @returns {boolean} True when a fragment can be dispatched now.
 */
function isStreamingSpeechPause(character) {
    return character === '.'
        || character === '!'
        || character === '?'
        || character === ';'
        || character === ':';
}
