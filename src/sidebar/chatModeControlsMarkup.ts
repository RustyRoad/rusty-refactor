/**
 * Builds mode, feature, context, and session controls for chat.
 */
export class ChatModeControlsMarkup {
    /**
     * Returns mode, feature, context, and session controls.
     */
    public markup(): string {
        return [
            this.modeControls(),
            this.sessionControls(),
        ].join('\n');
    }

    /**
     * Returns mode, feature, and context controls for prompt shaping.
     */
    private modeControls(): string {
        return [
            '<div class="control-grid">',
            '<div class="field"><label for="mode-input">Mode</label>',
            '<select id="mode-input">',
            '<option value="orchestrate" selected>',
            'Orchestrate: lead sub-agents</option>',
            '<option value="chat">Chat: answer + tools as needed</option>',
            '<option value="agent">Agent: inspect/edit/validate</option>',
            '<option value="plan">Plan: inspect then plan</option>',
            '<option value="review">Review: git/files/risks</option>',
            '</select></div>',
            '<div class="field"><label for="feature-input">Feature</label>',
            '<select id="feature-input">',
            '<option value="swarm" selected>Sub-agents / swarm</option>',
            '<option value="auto">Auto tools</option>',
            '<option value="code">Code edit</option>',
            '<option value="debug">Debug</option>',
            '<option value="refactor">Refactor</option>',
            '<option value="search">Repo search</option>',
            '<option value="test">Tests/build</option>',
            '<option value="git">Git review</option>',
            '<option value="browser">Browser</option>',
            '<option value="prd">Autonomous plan</option>',
            '</select></div>',
            '</div>',
            '<label class="context-row">',
            '<input id="context-toggle" type="checkbox" checked>',
            'Include active editor context',
            '</label>',
        ].join('\n');
    }

    /**
     * Returns controls for browsing persisted Codetether sessions.
     */
    private sessionControls(): string {
        return [
            '<details class="sessions-panel">',
            '<summary class="sessions-summary">',
            '<span class="sessions-title">Sessions</span>',
            '<span class="sessions-caption">Open recent chats</span>',
            '</summary>',
            '<div class="sessions-actions">',
            '<input id="session-id-input" aria-label="Session ID"',
            ' placeholder="Session ID from TUI…">',
            '<button id="open-session-id-btn"',
            ' title="Open session by ID">Open ID</button>',
            '<button id="refresh-sessions-btn" title="Refresh sessions">',
            'Refresh</button>',
            '</div>',
            '<div id="sessions-list" class="sessions-list">',
            '<span class="subtitle">Loading sessions…</span>',
            '</div>',
            '</details>',
        ].join('\n');
    }
}
