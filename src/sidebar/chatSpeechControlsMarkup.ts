/**
 * Builds the always-visible assistant speech controls.
 */
export class ChatSpeechControlsMarkup {
    /**
     * Returns a labeled selector for the active Read voice.
     */
    public markup(): string {
        return [
            '<div class="read-voice-controls">',
            '<label for="voice-input">Read voice</label>',
            '<select id="voice-input" aria-label="Read aloud voice">',
            '<option value="">Automatic voice</option>',
            '</select>',
            '</div>',
        ].join('\n');
    }
}
