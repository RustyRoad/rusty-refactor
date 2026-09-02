/**
 * Builds compact controls for browsing Codetether transcript sessions.
 */
export class ChatSessionControlsMarkup {
    /**
     * Returns live-thread and saved-session browser controls.
     */
    public markup(): string {
        return [
            '<details class="sessions-panel"',
            ' aria-labelledby="sessions-title" open>',
            '<summary class="section-toggle">',
            '<span id="sessions-title" class="sessions-title">Chats</span>',
            '<span id="sessions-caption" class="sessions-caption">',
            'Loading chats...',
            '</span>',
            '<span class="toggle-label">',
            '<span class="show-label">Show</span>',
            '<span class="hide-label">Hide</span>',
            '</span>',
            '</summary>',
            '<div class="sessions-body">',
            '<div class="session-tabs" role="tablist"',
            ' aria-label="Chat session views">',
            '<button id="active-sessions-tab" class="session-tab active"',
            ' role="tab" aria-selected="true"',
            ' aria-controls="active-sessions-view">',
            'Active <span id="active-sessions-count">0</span>',
            '</button>',
            '<button id="previous-sessions-tab" class="session-tab"',
            ' role="tab" aria-selected="false"',
            ' aria-controls="previous-sessions-view">',
            'Previous <span id="previous-sessions-count">0</span>',
            '</button>',
            '</div>',
            '<div id="active-sessions-view" class="session-view"',
            ' role="tabpanel">',
            '<div id="active-sessions-list" class="sessions-list">',
            '<span class="subtitle">Loading active chats...</span>',
            '</div>',
            '</div>',
            '<div id="previous-sessions-view" class="session-view"',
            ' role="tabpanel" hidden>',
            '<div class="sessions-header-actions">',
            this.sessionIdControls(),
            '<button id="refresh-sessions-btn" class="icon-button"',
            ' title="Refresh previous chats"',
            ' aria-label="Refresh previous chats">',
            '<span class="icon-glyph" aria-hidden="true">&#8635;</span>',
            '</button>',
            '</div>',
            '<div id="sessions-list" class="sessions-list">',
            '<span class="subtitle">Loading previous chats...</span>',
            '</div>',
            '</div>',
            '</div>',
            '</details>',
        ].join('\n');
    }

    /**
     * Returns a compact by-id opener for less common session lookups.
     */
    private sessionIdControls(): string {
        return [
            '<details class="session-id-panel">',
            '<summary title="Open session by ID"',
            ' aria-label="Open session by ID">Open ID</summary>',
            '<div class="session-id-form">',
            '<input id="session-id-input" aria-label="Session ID"',
            ' placeholder="Session ID from TUI...">',
            '<button id="open-session-id-btn"',
            ' title="Open session by ID">Open</button>',
            '</div>',
            '</details>',
        ].join('\n');
    }
}
