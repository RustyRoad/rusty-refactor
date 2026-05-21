import * as vscode from 'vscode';

/**
 * Builds the complete HTML document for the Codetether chat webview.
 */
export class ChatWebviewHtml {
    /**
     * Creates the webview document with external script and style assets.
     */
    public render(
        webview: vscode.Webview,
        extensionUri: vscode.Uri,
    ): string {
        const styleUri = this.assetUri(
            webview,
            extensionUri,
            'chat-sidebar.css',
        );
        const scriptUri = this.assetUri(
            webview,
            extensionUri,
            'chat-sidebar.js',
        );

        return [
            '<!DOCTYPE html>',
            '<html lang="en">',
            '<head>',
            '<meta charset="UTF-8">',
            this.viewportMeta(),
            this.cspMeta(webview),
            '<title>Codetether Chat</title>',
            `<link rel="stylesheet" href="${styleUri}">`,
            '</head>',
            '<body>',
            this.bodyMarkup(),
            `<script src="${scriptUri}"></script>`,
            '</body>',
            '</html>',
        ].join('\n');
    }

    /**
     * Returns the webview URI for a static sidebar asset.
     */
    private assetUri(
        webview: vscode.Webview,
        extensionUri: vscode.Uri,
        fileName: string,
    ): vscode.Uri {
        return webview.asWebviewUri(vscode.Uri.joinPath(
            extensionUri,
            'media',
            fileName,
        ));
    }

    /**
     * Returns viewport metadata as a short source line.
     */
    private viewportMeta(): string {
        return [
            '<meta name="viewport"',
            ' content="width=device-width, initial-scale=1.0">',
        ].join('');
    }

    /**
     * Builds the content security policy meta tag for this webview.
     */
    private cspMeta(webview: vscode.Webview): string {
        const policy = [
            "default-src 'none';",
            `img-src ${webview.cspSource} https: data:;`,
            `style-src ${webview.cspSource};`,
            `script-src ${webview.cspSource};`,
        ].join(' ');

        return [
            '<meta http-equiv="Content-Security-Policy"',
            ` content="${policy}">`,
        ].join('');
    }

    /**
     * Returns static chat controls and message containers.
     */
    private bodyMarkup(): string {
        return [
            '<div class="header">',
            '<div class="brand-row">',
            '<div class="brand">',
            '<div class="title">Codetether Chat</div>',
            '<div id="model-caption" class="subtitle">Loading models…</div>',
            '</div>',
            '<div class="toolbar-row">',
            '<button id="tui-btn">TUI</button>',
            '<button id="refresh-btn" class="icon">↻</button>',
            '<button id="clear-btn">Clear</button>',
            '</div>',
            '</div>',
            this.modelControls(),
            this.modeControls(),
            this.sessionControls(),
            '</div>',
            `<div id="chat-container">${this.emptyState()}</div>`,
            '<div id="status-bar">',
            '<span class="spinner"></span><span id="status">Ready</span>',
            '</div>',
            '<div id="input-container">',
            '<textarea id="prompt-input"',
            ' placeholder="Ask Codetether…"></textarea>',
            '<button id="send-btn" class="primary">Send</button>',
            '<div class="hint">',
            'Enter sends • Shift+Enter adds a line • Ctrl/Cmd+K clears',
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
            '<select id="model-input">',
            '<option value="">Default model</option>',
            '</select>',
            '</div>',
            '<div class="provider-strip" id="provider-strip"></div>',
            '<div class="model-actions">',
            '<input id="custom-model-input"',
            ' placeholder="Custom provider/model…">',
            '<button id="use-model-btn">Use</button>',
            '<button id="save-model-btn">Save</button>',
            '</div>',
            '<div id="model-meta" class="model-meta">',
            'Default/manual model remains usable while discovery loads.',
            '</div>',
            '</div>',
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
            '<option value="chat">',
            'Chat: answer + tools as needed',
            '</option>',
            '<option value="agent">',
            'Agent: inspect/edit/validate',
            '</option>',
            '<option value="plan">Plan: inspect then plan</option>',
            '<option value="review">',
            'Review: git/files/risks',
            '</option>',
            '</select></div>',
            '<div class="field"><label for="feature-input">Feature</label>',
            '<select id="feature-input">',
            '<option value="auto">Auto tools</option>',
            '<option value="code">Code edit</option>',
            '<option value="debug">Debug</option>',
            '<option value="refactor">Refactor</option>',
            '<option value="search">Repo search</option>',
            '<option value="test">Tests/build</option>',
            '<option value="git">Git review</option>',
            '<option value="browser">Browser</option>',
            '<option value="swarm">Swarm/subagents</option>',
            '<option value="prd">PRD/Ralph/go</option>',
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
            '<div class="sessions-panel">',
            '<div class="sessions-header">',
            '<span class="sessions-title">Codetether Sessions</span>',
            '<button id="refresh-sessions-btn">Refresh</button>',
            '</div>',
            '<div id="sessions-list" class="sessions-list">',
            '<span class="subtitle">Loading sessions…</span>',
            '</div>',
            '</div>',
        ].join('\n');
    }

    /**
     * Returns the empty-state markup shown before any messages exist.
     */
    private emptyState(): string {
        return [
            '<div class="empty-state" id="empty-state">',
            '<div class="empty-title">',
            'Ask Codetether about your workspace.',
            '</div>',
            'Pick a provider/model, choose a mode, then send.',
            '<div class="quick-grid">',
            this.suggestion('Explain current module', this.explainPrompt()),
            this.suggestion(
                'Agent fix',
                this.agentFixPrompt(),
                'agent',
                'code',
            ),
            this.suggestion(
                'Review changes',
                this.reviewPrompt(),
                'review',
                'git',
            ),
            this.suggestion('Find code', this.findPrompt(), 'agent', 'search'),
            '</div>',
            '</div>',
        ].join('\n');
    }

    /**
     * Creates a quick-prompt button with optional mode and feature values.
     */
    private suggestion(
        label: string,
        prompt: string,
        mode = '',
        feature = '',
    ): string {
        const modeAttr = mode ? ` data-mode="${mode}"` : '';
        const featureAttr = feature ? ` data-feature="${feature}"` : '';

        return [
            `<button class="suggestion"${modeAttr}${featureAttr}`,
            ` data-prompt="${prompt}">${label}</button>`,
        ].join('');
    }

    /**
     * Provides the quick prompt for explaining the active module.
     */
    private explainPrompt(): string {
        return [
            'Explain the active Rust module and suggest cleanup',
            'opportunities.',
        ].join(' ');
    }

    /**
     * Provides the quick prompt for an agentic code fix.
     */
    private agentFixPrompt(): string {
        return [
            'Use Codetether tools to inspect this repository and implement',
            'the smallest safe fix for the current issue. Validate with',
            'the relevant build or test command.',
        ].join(' ');
    }

    /**
     * Provides the quick prompt for reviewing current changes.
     */
    private reviewPrompt(): string {
        return [
            'Review the current changes with git diff and file inspection.',
            'Focus on correctness, regressions, and missing validation.',
        ].join(' ');
    }

    /**
     * Provides the quick prompt for finding implementation points.
     */
    private findPrompt(): string {
        return [
            'Search this repository for relevant implementation points and',
            'summarize the exact files/functions involved.',
        ].join(' ');
    }
}
