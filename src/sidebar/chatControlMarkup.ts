import { ChatModeControlsMarkup } from './chatModeControlsMarkup';
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
        private readonly modeControls = new ChatModeControlsMarkup()
    ) {}

    /**
     * Returns header, model, mode, voice, and session controls.
     */
    public controls(): string {
        return [
            '<div class="header">',
            this.topControls.markup(),
            this.modeControls.markup(),
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
            ' placeholder="Ask Codetether…"></textarea>',
            '<button id="voice-btn" title="Dictate prompt"',
            ' aria-label="Dictate prompt">Mic</button>',
            '<button id="send-btn" class="primary"',
            ' aria-label="Send prompt">Send</button>',
            '<div class="hint">',
            'Enter sends • Shift+Enter adds a line • Ctrl/Cmd+K clears',
            '</div>',
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
