/**
 * Builds the compact header and model controls for chat.
 */
export class ChatTopControlsMarkup {
    /**
     * Returns title, toolbar, and model controls.
     */
    public markup(): string {
        return [
            this.brandControls(),
            this.modelControls(),
        ].join('\n');
    }

    /**
     * Returns the title and high-priority toolbar commands.
     */
    private brandControls(): string {
        return [
            '<div class="brand-row">',
            '<div class="brand">',
            '<div class="title">Codetether Chat</div>',
            '<div id="model-caption" class="subtitle">Loading models...</div>',
            '</div>',
            '<div class="toolbar-row">',
            '<button id="tui-btn" class="icon-button"',
            ' title="Open terminal UI" aria-label="Open terminal UI">',
            '<span class="icon-glyph" aria-hidden="true">&gt;_</span>',
            '</button>',
            '<button id="refresh-btn" class="icon-button" title="Refresh"',
            ' aria-label="Refresh models and sessions">',
            '<span class="icon-glyph" aria-hidden="true">&#8635;</span>',
            '</button>',
            '<button id="clear-btn" class="icon-button" title="Clear chat"',
            ' aria-label="Clear chat">',
            '<span class="icon-glyph" aria-hidden="true">&#10005;</span>',
            '</button>',
            '</div>',
            '</div>',
        ].join('\n');
    }

    /**
     * Returns model selection controls used by the chat sidebar.
     */
    private modelControls(): string {
        return [
            '<details class="model-panel">',
            '<summary class="section-toggle">',
            '<span class="section-title">Models</span>',
            '<span class="toggle-label">',
            '<span class="show-label">Show</span>',
            '<span class="hide-label">Hide</span>',
            '</span>',
            '</summary>',
            '<div class="model-stack">',
            '<div class="model-row">',
            '<label class="sr-only" for="model-input">Model</label>',
            '<select id="model-input">',
            '<option value="">Default model</option>',
            '</select>',
            '<button id="use-model-btn" class="icon-button"',
            ' title="Use selected model" aria-label="Use selected model">',
            '<span class="icon-glyph" aria-hidden="true">&#10003;</span>',
            '</button>',
            '</div>',
            '<details class="custom-model-panel">',
            '<summary>Custom</summary>',
            '<div class="model-actions">',
            '<input id="custom-model-input"',
            ' aria-label="Custom model"',
            ' placeholder="provider/model...">',
            '<button id="save-model-btn" class="icon-button"',
            ' title="Save custom model" aria-label="Save custom model">',
            '<span class="icon-glyph" aria-hidden="true">&#128190;</span>',
            '</button>',
            '</div>',
            '</details>',
            '<div class="provider-strip" id="provider-strip"></div>',
            '<div id="model-meta" class="model-meta">',
            'Using automatic model.',
            '</div>',
            '</div>',
            '</details>',
        ].join('\n');
    }
}
