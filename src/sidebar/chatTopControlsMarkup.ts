/**
 * Builds header, toolbar, model, and speech controls for chat.
 */
export class ChatTopControlsMarkup {
    /**
     * Returns header, model, and voice controls.
     */
    public markup(): string {
        return [
            this.brandControls(),
            this.modelControls(),
            this.voiceControls(),
            this.voiceInputControls(),
        ].join('\n');
    }

    /**
     * Returns title and toolbar controls.
     */
    private brandControls(): string {
        return [
            '<div class="brand-row">',
            '<div class="brand">',
            '<div class="title">Codetether Chat</div>',
            '<div id="model-caption" class="subtitle">Loading models…</div>',
            '</div>',
            '<div class="toolbar-row">',
            '<button id="tui-btn" title="Open terminal UI"',
            ' aria-label="Open terminal UI">TUI</button>',
            '<button id="refresh-btn" class="icon" title="Refresh"',
            ' aria-label="Refresh models and sessions">↻</button>',
            '<button id="clear-btn" title="Clear chat"',
            ' aria-label="Clear chat">Clear</button>',
            '</div>',
            '</div>',
        ].join('\n');
    }

    /**
     * Returns model selection controls used by the chat sidebar.
     */
    private modelControls(): string {
        return [
            '<div class="model-stack">',
            '<div class="model-row">',
            '<label class="sr-only" for="model-input">Model</label>',
            '<select id="model-input">',
            '<option value="">Default model</option>',
            '</select>',
            '</div>',
            '<div class="provider-strip" id="provider-strip"></div>',
            '<div class="model-actions">',
            '<input id="custom-model-input"',
            ' aria-label="Custom model"',
            ' placeholder="provider/model…">',
            '<button id="use-model-btn" title="Use custom model">Use</button>',
            '<button id="save-model-btn" title="Save custom model">',
            'Save</button>',
            '</div>',
            '<div id="model-meta" class="model-meta">',
            'Default/manual model remains usable while discovery loads.',
            '</div>',
            '</div>',
        ].join('\n');
    }

    /**
     * Returns voice selection controls for assistant read-aloud playback.
     */
    private voiceControls(): string {
        return [
            '<div class="voice-row">',
            '<label for="voice-input">Voice</label>',
            '<select id="voice-input" aria-label="Read aloud voice">',
            '<option value="">Automatic voice</option>',
            '</select>',
            '</div>',
        ].join('\n');
    }

    /**
     * Returns microphone input controls for speech-to-text capture.
     */
    private voiceInputControls(): string {
        return [
            '<div class="voice-row">',
            '<label for="voice-source-input">Input</label>',
            '<select id="voice-source-input"',
            ' aria-label="Voice input source">',
            '<option value="windows-default">',
            'Default Windows microphone',
            '</option>',
            '</select>',
            '</div>',
        ].join('\n');
    }
}
