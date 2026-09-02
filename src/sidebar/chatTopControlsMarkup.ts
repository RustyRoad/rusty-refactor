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
            '<div class="brand-mark" aria-hidden="true">CT</div>',
            '<div class="brand-copy">',
            '<div class="title">Codetether Chat</div>',
            '<div id="model-caption" class="subtitle">Loading models...</div>',
            '</div>',
            '</div>',
            '<div class="toolbar-row">',
            '<button id="new-chat-btn" class="icon-button"',
            ' title="Start new chat" aria-label="Start new chat">',
            '<span class="icon-glyph new-chat-glyph"',
            ' aria-hidden="true">+</span>',
            '</button>',
            '<button id="tui-btn" class="icon-button"',
            ' title="Open terminal UI" aria-label="Open terminal UI">',
            '<span class="icon-glyph" aria-hidden="true">&gt;_</span>',
            '</button>',
            '<button id="refresh-btn" class="icon-button" title="Refresh"',
            ' aria-label="Refresh models and sessions">',
            '<span class="icon-glyph" aria-hidden="true">&#8635;</span>',
            '</button>',
            '<button id="clear-btn" class="icon-button"',
            ' title="Clear current chat"',
            ' aria-label="Clear current chat">',
            '<span class="icon-glyph" aria-hidden="true">&#10005;</span>',
            '</button>',
            '</div>',
            '</div>',
            '<button id="popout-chat-btn"',
            ' class="chat-popout-button compact-button"',
            ' title="Open chat in new window"',
            ' aria-label="Open chat in new window">',
            '<span aria-hidden="true">&#8599;</span> Open in New Window',
            '</button>',
        ].join('\n');
    }

    /**
     * Returns model selection controls used by the chat sidebar.
     */
    private modelControls(): string {
        return [
            '<details class="model-panel">',
            '<summary class="section-toggle">',
            '<span class="section-title">Model</span>',
            '<span class="toggle-label">',
            '<span class="show-label">Show</span>',
            '<span class="hide-label">Hide</span>',
            '</span>',
            '</summary>',
            '<div class="model-stack">',
            '<label class="sr-only" for="model-search-input">',
            'Search models',
            '</label>',
            '<input id="model-search-input"',
            ' aria-label="Search models"',
            ' placeholder="Search models and providers...">',
            '<div class="model-row">',
            '<label class="sr-only" for="model-input">Model</label>',
            '<select id="model-input">',
            '<option value="">Default model</option>',
            '</select>',
            '<button id="use-model-btn" class="compact-button primary"',
            ' title="Use selected model" aria-label="Use selected model">',
            'Use',
            '</button>',
            '</div>',
            '<div id="model-runtime-options"',
            ' class="model-runtime-options" hidden>',
            '<div id="model-thinking-row" class="model-runtime-row">',
            '<label for="model-thinking-input">Thinking effort</label>',
            '<select id="model-thinking-input"></select>',
            '</div>',
            '<div id="model-service-tier-row"',
            ' class="model-runtime-row" hidden>',
            '<label for="model-service-tier-input">Service tier</label>',
            '<select id="model-service-tier-input"></select>',
            '</div>',
            '</div>',
            '<details class="custom-model-panel">',
            '<summary>Use a custom model</summary>',
            '<div class="model-actions">',
            '<input id="custom-model-input"',
            ' aria-label="Custom model"',
            ' placeholder="provider/model...">',
            '<button id="save-model-btn" class="compact-button"',
            ' title="Save custom model" aria-label="Save custom model">',
            'Save',
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