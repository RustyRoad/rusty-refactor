/**
 * Converts markdown-ish assistant text to speech-friendly plain text.
 *
 * Code fences are summarized instead of spoken literally so long snippets do
 * not overwhelm the listener. Inline emphasis and markdown punctuation are
 * removed while preserving the natural language around them.
 *
 * @param {string} content - Raw assistant message content.
 * @returns {string} Text suitable for speech synthesis.
 */
function speechText(content) {
    const tick = String.fromCharCode(96);
    const fence = new RegExp(
        tick + tick + tick + '[\\s\\S]*?' + tick + tick + tick,
        'g',
    );
    return String(content || '')
        .replace(fence, ' code block omitted. ')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/[#>*_\[\]()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
