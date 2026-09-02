/**
 * Builds expandable prompt and context controls for chat.
 */
export class ChatRunSettingsMarkup {
    /**
     * Returns a collapsed summary with detailed controls behind it.
     */
    public markup(): string {
        return [
            '<details class="run-settings">',
            this.summary(),
            '<div class="run-settings-body">',
            this.modeControls(),
            this.voiceInputControls(),
            '</div>',
            '</details>',
        ].join('\n');
    }

    /**
     * Returns the compact visible summary for current run settings.
     */
    private summary(): string {
        return [
            '<summary class="section-toggle run-summary">',
            '<span class="run-title">Run</span>',
            '<span class="run-chip" id="mode-chip">Chat</span>',
            '<span class="run-chip" id="feature-chip">Auto tools</span>',
            '<span class="run-chip" id="context-chip">Context on</span>',
            '</summary>',
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
            '<option value="chat" selected>',
            'Chat: answer + tools as needed</option>',
            '<option value="agent">Agent: inspect/edit/validate</option>',
            '<option value="orchestrate">',
            'Orchestrate: lead sub-agents</option>',
            '<option value="plan">Plan: inspect then plan</option>',
            '<option value="review">Review: git/files/risks</option>',
            '</select></div>',
            '<div class="field"><label for="feature-input">Feature</label>',
            '<select id="feature-input">',
            '<option value="auto" selected>Auto tools</option>',
            '<option value="code">Code edit</option>',
            '<option value="debug">Debug</option>',
            '<option value="refactor">Refactor</option>',
            '<option value="search">Repo search</option>',
            '<option value="test">Tests/build</option>',
            '<option value="git">Git review</option>',
            '<option value="browser">Browser</option>',
            '<option value="swarm">Sub-agents / swarm</option>',
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
