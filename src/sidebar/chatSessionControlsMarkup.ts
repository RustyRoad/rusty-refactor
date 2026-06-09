/**
 * Builds compact controls for browsing Codetether transcript sessions.
 */
export class ChatSessionControlsMarkup {
    /**
     * Returns visible session controls and the recent-session list.
     */
    public markup(): string {
        return [
            '<details class="sessions-panel" aria-labelledby="sessions-title">',
            '<summary class="section-toggle">',
            '<span id="sessions-title" class="sessions-title">Sessions</span>',
            '<span id="sessions-caption" class="sessions-caption">',
            'Loading sessions...',
            '</span>',
            '<span class="toggle-label">',
            '<span class="show-label">Show</span>',
            '<span class="hide-label">Hide</span>',
            '</span>',
            '</summary>',
            '<div class="sessions-body">',
            '<div class="sessions-header-actions">',
            this.sessionIdControls(),
            '<button id="refresh-sessions-btn" class="icon-button"',
            ' title="Refresh sessions" aria-label="Refresh sessions">',
            '<span class="icon-glyph" aria-hidden="true">&#8635;</span>',
            '</button>',
            '</div>',
            '</div>',
            '<div id="sessions-list" class="sessions-list">',
            '<span class="subtitle">Loading sessions...</span>',
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
