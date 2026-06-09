import { ChatRunSettingsMarkup } from './chatRunSettingsMarkup';
import { ChatSessionControlsMarkup } from './chatSessionControlsMarkup';
import { ChatTopControlsMarkup } from './chatTopControlsMarkup';

/**
 * Builds static control markup for the Codetether chat sidebar.
 */
export class ChatControlMarkup {
    /**
     * Creates control markup from focused section renderers.
     */
    public constructor(
        private readonly topControls = new ChatTopControlsMarkup(),
        private readonly runSettings = new ChatRunSettingsMarkup(),
        private readonly sessions = new ChatSessionControlsMarkup()
    ) {}

    /**
     * Returns the compact header and expandable configuration controls.
     */
    public controls(): string {
        return [
            '<div class="header">',
            this.topControls.markup(),
            this.runSettings.markup(),
            this.sessions.markup(),
            '</div>',
        ].join('\n');
    }

    /**
     * Returns prompt input and send controls.
     */
    public inputControls(): string {
        return [
            '<div id="input-container">',
            '<textarea id="prompt-input" rows="1"',
            ' aria-label="Chat prompt"',
            ' placeholder="Ask Codetether..."></textarea>',
            '<button id="voice-btn" class="icon-button" title="Dictate prompt"',
            ' aria-label="Dictate prompt">',
            '<span class="icon-glyph" aria-hidden="true">&#127908;</span>',
            '</button>',
            '<button id="send-btn" class="primary"',
            ' aria-label="Send prompt">Send</button>',
            '</div>',
        ].join('\n');
    }

    /**
     * Returns the activity panel used for coordinated sub-agent work.
     */
    public subagentPanel(): string {
        return [
            '<section id="subagent-panel" class="subagent-panel"',
            ' aria-label="Sub-agent activity" aria-live="polite">',
            '<div class="subagent-panel-header">',
            '<span class="subagent-panel-title">Sub-agents</span>',
            '<div class="subagent-panel-actions">',
            '<span id="subagent-summary" class="subagent-summary"></span>',
            '<button id="refresh-subagents-btn"',
            ' title="Refresh sub-agent activity">Refresh</button>',
            '</div>',
            '</div>',
            '<div id="subagent-counters" class="subagent-counters"></div>',
            '<div id="subagent-list" class="subagent-list"></div>',
            '</section>',
        ].join('\n');
    }

    /**
     * Returns the busy/ready status bar markup.
     */
    public statusBar(): string {
        return [
            '<div id="status-bar">',
            '<span class="spinner"></span>',
            '<span id="status" role="status" aria-live="polite">Ready</span>',
            '</div>',
        ].join('\n');
    }
}
