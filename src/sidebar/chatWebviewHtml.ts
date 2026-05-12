import * as vscode from 'vscode';

/**
 * Builds the complete HTML document for the Codetether chat webview.
 */
export class ChatWebviewHtml {
    /**
     * Creates the webview document with a nonce-bound script tag.
     */
    public render(webview: vscode.Webview): string {
        const nonce = getNonce();

        return [
            '<!DOCTYPE html>',
            '<html lang="en">',
            '<head>',
            '<meta charset="UTF-8">',
            this.viewportMeta(),
            this.cspMeta(webview, nonce),
            '<title>Codetether Chat</title>',
            '<style>',
            this.styles(),
            '</style>',
            '</head>',
            '<body>',
            this.bodyMarkup(),
            `<script nonce="${nonce}">`,
            this.script(),
            '</script>',
            '</body>',
            '</html>'
        ].join('\n');
    }

    /**
     * Returns viewport metadata as a short source line.
     */
    private viewportMeta(): string {
        return [
            '<meta name="viewport"',
            ' content="width=device-width, initial-scale=1.0">'
        ].join('');
    }

    /**
     * Builds the content security policy meta tag for this webview.
     */
    private cspMeta(webview: vscode.Webview, nonce: string): string {
        const policy = [
            "default-src 'none';",
            `img-src ${webview.cspSource} https: data:;`,
            `style-src 'unsafe-inline' ${webview.cspSource};`,
            `script-src 'nonce-${nonce}';`
        ].join(' ');

        return [
            '<meta http-equiv="Content-Security-Policy"',
            ` content="${policy}">`
        ].join('');
    }

    /**
     * Returns CSS scoped to the chat sidebar view.
     */
    private styles(): string {
        return [
            ':root{color-scheme:dark light}',
            '*{box-sizing:border-box}',
            'body{font-family:var(--vscode-font-family);',
            'color:var(--vscode-editor-foreground);',
            'background:var(--vscode-editor-background);',
            'display:flex;flex-direction:column;height:100vh;margin:0;',
            'overflow:hidden}',
            '.header{padding:8px 10px;flex:0 0 auto;max-height:38vh;',
            'overflow-y:auto;',
            'border-bottom:1px solid var(--vscode-panel-border);',
            'background:var(--vscode-sideBar-background)}',
            '.brand-row,.toolbar-row,.model-row{display:flex;',
            'align-items:center;gap:8px}',
            '.brand-row{justify-content:space-between;margin-bottom:8px}',
            '.brand{display:flex;flex-direction:column;min-width:0}',
            '.title{font-weight:700}',
            '.subtitle,.model-meta,.hint,.context-row,.meta{',
            'color:var(--vscode-descriptionForeground);font-size:11px}',
            '.toolbar-row{justify-content:flex-end}',
            '.model-stack{display:flex;flex-direction:column;',
            'gap:6px;margin-top:8px}',
            '.model-actions{display:grid;',
            'grid-template-columns:1fr auto auto;gap:6px}',
            '.provider-strip{display:flex;flex-wrap:wrap;',
            'gap:5px;min-height:18px}',
            '.provider-chip{border:1px solid var(--vscode-badge-background);',
            'border-radius:999px;padding:1px 6px;font-size:10px;',
            'cursor:pointer}',
            '.provider-chip.active{',
            'background:var(--vscode-toolbar-hoverBackground)}',
            '.control-grid{display:grid;grid-template-columns:1fr 1fr;',
            'gap:6px;margin-top:8px}',
            '.field{display:flex;flex-direction:column;gap:3px;min-width:0}',
            '.field label{color:var(--vscode-descriptionForeground);',
            'font-size:10px}',
            '.context-row{display:flex;align-items:center;',
            'gap:6px;margin-top:8px}',
            '.sessions-panel{margin-top:8px;',
            'border-top:1px solid var(--vscode-panel-border);',
            'padding-top:8px}',
            '.sessions-header{display:flex;justify-content:space-between;',
            'align-items:center;margin-bottom:6px}',
            '.sessions-title{font-size:11px;font-weight:700}',
            '.sessions-list{display:flex;flex-direction:column;gap:5px;',
            'max-height:120px;overflow-y:auto}',
            '.session-item{text-align:left;white-space:normal}',
            '.session-meta{display:block;',
            'color:var(--vscode-descriptionForeground);font-size:10px}',
            'select,button,textarea,input{font:inherit}',
            'select,input{width:100%;',
            'background:var(--vscode-input-background);',
            'color:var(--vscode-input-foreground);',
            'border:1px solid var(--vscode-input-border);',
            'padding:5px 7px;border-radius:4px}',
            'button{background:var(--vscode-button-secondaryBackground);',
            'color:var(--vscode-button-secondaryForeground);',
            'border:1px solid transparent;',
            'padding:5px 9px;cursor:pointer;border-radius:4px;',
            'white-space:nowrap}',
            'button.primary{background:var(--vscode-button-background);',
            'color:var(--vscode-button-foreground)}',
            'button:disabled{opacity:.55;cursor:not-allowed}',
            '#chat-container{flex:1;overflow-y:auto;padding:12px;display:flex;',
            'flex-direction:column;gap:12px}',
            '.empty-state{border:1px solid var(--vscode-widget-border);',
            'background:var(--vscode-editorWidget-background);',
            'border-radius:10px;',
            'padding:14px;color:var(--vscode-descriptionForeground);',
            'line-height:1.45}',
            '.empty-title{color:var(--vscode-editor-foreground);',
            'font-weight:700}',
            '.quick-grid{display:grid;grid-template-columns:1fr 1fr;',
            'gap:6px;margin-top:10px}',
            '.message-wrap{display:flex;flex-direction:column;',
            'gap:4px;max-width:94%}',
            '.message-wrap.user{align-self:flex-end;align-items:flex-end}',
            '.message-wrap.assistant{align-self:flex-start;',
            'align-items:flex-start}',
            '.message{padding:10px;border-radius:10px;line-height:1.45;',
            'word-wrap:break-word;overflow-wrap:anywhere}',
            '.message.user{background:var(--vscode-button-background);',
            'color:var(--vscode-button-foreground)}',
            '.message.assistant{',
            'background:var(--vscode-editorWidget-background);',
            'border:1px solid var(--vscode-widget-border)}',
            '.message.error{border-color:var(--vscode-errorForeground)}',
            '.message pre{background:var(--vscode-textCodeBlock-background);',
            'border:1px solid var(--vscode-widget-border);padding:10px;',
            'border-radius:6px;overflow-x:auto}',
            '.message-actions{display:flex;gap:5px;opacity:.72}',
            '.copy-btn,.insert-btn{align-self:flex-start;',
            'padding:2px 6px;font-size:11px}',
            '#status-bar{min-height:25px;',
            'border-top:1px solid var(--vscode-panel-border);',
            'display:flex;align-items:center;gap:8px;',
            'padding:4px 10px;font-size:12px}',
            '.spinner{width:10px;height:10px;border:2px solid currentColor;',
            'border-top-color:transparent;border-radius:50%;display:none;',
            'animation:spin .8s linear infinite}',
            '.busy .spinner{display:inline-block}',
            '@keyframes spin{to{transform:rotate(360deg)}}',
            '#input-container{padding:10px;',
            'border-top:1px solid var(--vscode-panel-border);',
            'display:grid;grid-template-columns:1fr auto;gap:8px;',
            'background:var(--vscode-sideBar-background)}',
            'textarea{width:100%;background:var(--vscode-input-background);',
            'color:var(--vscode-input-foreground);',
            'border:1px solid var(--vscode-input-border);',
            'padding:9px;border-radius:6px;resize:none;',
            'min-height:42px;max-height:160px}',
            '.hint{grid-column:1/-1}'
        ].join('\n');
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
            '</div>'
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
            '</div>'
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
            '</label>'
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
            '</div>'
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
                'code'
            ),
            this.suggestion(
                'Review changes',
                this.reviewPrompt(),
                'review',
                'git'
            ),
            this.suggestion('Find code', this.findPrompt(), 'agent', 'search'),
            '</div>',
            '</div>'
        ].join('\n');
    }

    /**
     * Creates a quick-prompt button with optional mode and feature values.
     */
    private suggestion(
        label: string,
        prompt: string,
        mode = '',
        feature = ''
    ): string {
        const modeAttr = mode ? ` data-mode="${mode}"` : '';
        const featureAttr = feature ? ` data-feature="${feature}"` : '';

        return [
            `<button class="suggestion"${modeAttr}${featureAttr}`,
            ` data-prompt="${prompt}">${label}</button>`
        ].join('');
    }

    /**
     * Provides the quick prompt for explaining the active module.
     */
    private explainPrompt(): string {
        return [
            'Explain the active Rust module and suggest cleanup',
            'opportunities.'
        ].join(' ');
    }

    /**
     * Provides the quick prompt for an agentic code fix.
     */
    private agentFixPrompt(): string {
        return [
            'Use Codetether tools to inspect this repository and implement',
            'the smallest safe fix for the current issue. Validate with',
            'the relevant build or test command.'
        ].join(' ');
    }

    /**
     * Provides the quick prompt for reviewing current changes.
     */
    private reviewPrompt(): string {
        return [
            'Review the current changes with git diff and file inspection.',
            'Focus on correctness, regressions, and missing validation.'
        ].join(' ');
    }

    /**
     * Provides the quick prompt for finding implementation points.
     */
    private findPrompt(): string {
        return [
            'Search this repository for relevant implementation points and',
            'summarize the exact files/functions involved.'
        ].join(' ');
    }

    /**
     * Returns browser-side behavior for chat rendering and message posting.
     */
    private script(): string {
        return [
            this.scriptState(),
            this.scriptHtmlHelpers(),
            this.scriptMessageRendering(),
            this.scriptModelHandling(),
            this.scriptSessionHandling(),
            this.scriptActions()
        ].join('\n');
    }

    /**
     * Returns script state bindings for the webview DOM.
     */
    private scriptState(): string {
        return String.raw`
const vscode = acquireVsCodeApi();
const byId = id => document.getElementById(id);
const chatContainer = byId('chat-container');
const promptInput = byId('prompt-input');
const modelInput = byId('model-input');
const customModelInput = byId('custom-model-input');
const providerStrip = byId('provider-strip');
const modelMeta = byId('model-meta');
const statusBar = byId('status-bar');
const statusText = byId('status');
const modelCaption = byId('model-caption');
const contextToggle = byId('context-toggle');
const modeInput = byId('mode-input');
const featureInput = byId('feature-input');
const sessionsList = byId('sessions-list');
let busy = false;
let allModels = [];
let configuredDefaultModel = '';
let activeProvider = '';

function postTelemetry(event, payload) {
    const detail = payload && typeof payload === 'object' ? payload : {};
    vscode.postMessage({
        type: 'uiTelemetry',
        value: {
            event,
            detail
        }
    });
}

function logUiAction(action, detail) {
    const details = detail ? ' | ' + detail : '';
    vscode.postMessage({
        type: 'log',
        message: '[UI] ' + action + details
    });
}`;
    }

    /**
     * Returns script helpers for escaping and markdown rendering.
     */
    private scriptHtmlHelpers(): string {
        return String.raw`
function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
function renderMarkdown(source) {
    let text = escapeHtml(source || '');
    const tick = String.fromCharCode(96);
    const fence = new RegExp(
        tick + tick + tick + '([\s\S]*?)' + tick + tick + tick,
        'g'
    );
    const inlineCode = new RegExp(tick + '([^' + tick + ']+)' + tick, 'g');
    text = text.replace(fence, function(_, code) {
        return '<pre><code>' + code.trim() + '</code></pre>';
    });
    text = text.replace(inlineCode, '<code>$1</code>');
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\n{2,}/g, '</p><p>');
    text = text.replace(/\n/g, '<br>');
    return '<p>' + text + '</p>';
}`;
    }

    /**
     * Returns script functions that append chat messages to the DOM.
     */
    private scriptMessageRendering(): string {
        return String.raw`
function appendMessage(role, content, isError) {
    const emptyState = byId('empty-state');
    if (emptyState) {
        emptyState.remove();
    }
    const wrap = document.createElement('div');
    wrap.className = 'message-wrap ' + role;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = (role === 'user' ? 'You' : 'Codetether') + ' · now';
    const message = document.createElement('div');
    message.className = 'message ' + role + (isError ? ' error' : '');
    message.innerHTML = role === 'assistant'
        ? renderMarkdown(content)
        : '<p>' + escapeHtml(content).replace(/\n/g, '<br>') + '</p>';
    const actions = document.createElement('div');
    actions.className = 'message-actions';
    const copy = document.createElement('button');
    copy.className = 'copy-btn';
    copy.textContent = 'Copy';
    copy.onclick = () => navigator.clipboard.writeText(content || '');
    actions.appendChild(copy);
    wrap.appendChild(meta);
    wrap.appendChild(message);
    wrap.appendChild(actions);
    chatContainer.appendChild(wrap);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}
function setBusy(nextBusy, message) {
    busy = nextBusy;
    byId('send-btn').disabled = busy;
    promptInput.disabled = busy;
    statusBar.classList.toggle('busy', busy);
    statusText.textContent = message || (busy ? 'Working…' : 'Ready');
}`;
    }

    /**
     * Returns script functions for model grouping and selection state.
     */
    private scriptModelHandling(): string {
        return String.raw`
function getProvider(model) {
    const slash = String(model || '').indexOf('/');
    return slash > 0 ? String(model).slice(0, slash) : 'other';
}
function getSelectedModel() {
    return customModelInput.value.trim() || modelInput.value.trim();
}
function providerCounts(models) {
    return models.reduce((acc, model) => {
        const provider = getProvider(model);
        acc[provider] = (acc[provider] || 0) + 1;
        return acc;
    }, {});
}
function renderProviderStrip(models) {
    providerStrip.innerHTML = '';
    const counts = providerCounts(models);
    Object.keys(counts).sort().forEach(provider => {
        const chip = document.createElement('button');
        chip.className = 'provider-chip'
            + (activeProvider === provider ? ' active' : '');
        chip.textContent = provider + ' ' + counts[provider];
        chip.onclick = () => {
            activeProvider = activeProvider === provider ? '' : provider;
            postTelemetry('providerFilterToggled', {
                provider,
                activeProvider: activeProvider || 'all',
                modelsForProvider: counts[provider] || 0
            });
            renderModelOptions();
        };
        providerStrip.appendChild(chip);
    });
}
function renderModelOptions() {
    const previous = modelInput.value;
    modelInput.innerHTML = '';
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = configuredDefaultModel
        ? 'Default: ' + configuredDefaultModel
        : 'Default / automatic';
    modelInput.appendChild(defaultOption);
    const visible = activeProvider
        ? allModels.filter(model => getProvider(model) === activeProvider)
        : allModels;
    visible.forEach(model => {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = model;
        modelInput.appendChild(option);
    });
    modelInput.value = visible.includes(previous) ? previous : '';
    renderProviderStrip(allModels);
    updateModelMeta();
}
function updateModelMeta() {
    const selected = getSelectedModel()
        || configuredDefaultModel
        || 'automatic';
    modelMeta.textContent = 'Using ' + selected;
}
function populateModels(models, configuredModel, status) {
    allModels = Array.isArray(models) ? models.slice().sort() : [];
    configuredDefaultModel = configuredModel || '';
    if (configuredDefaultModel && !allModels.includes(configuredDefaultModel)) {
        allModels.unshift(configuredDefaultModel);
    }

    const counts = providerCounts(allModels);
    const providers = Object.keys(counts).sort();
    postTelemetry('modelsListed', {
        totalModels: allModels.length,
        configuredDefaultModel: configuredDefaultModel || 'automatic',
        providerCount: providers.length,
        providers,
        providerModelCounts: counts,
        status: status || ''
    });

    renderModelOptions();
    modelCaption.textContent = status || allModels.length + ' models available';
}`;
    }

    /**
     * Returns script functions for rendering Codetether sessions.
     */
    private scriptSessionHandling(): string {
        return String.raw`
function formatSessionTime(value) {
    if (!value) {
        return 'unknown time';
    }
    return new Date(value).toLocaleString();
}
function renderSessions(sessions) {
    const items = Array.isArray(sessions) ? sessions : [];
    sessionsList.innerHTML = '';
    if (items.length === 0) {
        const empty = document.createElement('span');
        empty.className = 'subtitle';
        empty.textContent = 'No Codetether sessions found.';
        sessionsList.appendChild(empty);
        return;
    }
    items.forEach(session => {
        const button = document.createElement('button');
        button.className = 'session-item';
        button.title = session.path || '';
        button.textContent = session.preview || session.id;
        const meta = document.createElement('span');
        meta.className = 'session-meta';
        meta.textContent = String(session.turnCount || 0)
            + ' turns · ' + formatSessionTime(session.updatedAt);
        button.appendChild(meta);
        button.onclick = () => {
            postTelemetry('openSession', { id: session.id });
            vscode.postMessage({
                type: 'openSession',
                value: { path: session.path }
            });
        };
        sessionsList.appendChild(button);
    });
}`;
    }

    /**
     * Returns script event handlers for user actions and host messages.
     */
    private scriptActions(): string {
        return String.raw`
function sendMessage() {
    const text = promptInput.value.trim();
    const model = getSelectedModel();
    if (!text || busy) {
        logUiAction(
            'sendMessage blocked',
            !text ? 'reason=empty-input' : 'reason=busy'
        );
        return;
    }
    logUiAction(
        'sendMessage',
        [
            'chars=' + String(text.length),
            'model=' + String(model || 'default'),
            'mode=' + String(modeInput.value),
            'feature=' + String(featureInput.value),
            'context=' + String(Boolean(contextToggle?.checked))
        ].join(' ')
    );
    postTelemetry('sendMessage', {
        textLength: text.length,
        model: model || 'default',
        provider: getProvider(model || configuredDefaultModel || ''),
        mode: modeInput.value,
        feature: featureInput.value,
        includeContext: Boolean(contextToggle && contextToggle.checked)
    });
    appendMessage('user', text, false);
    vscode.postMessage({
        type: 'sendMessage',
        value: {
            text,
            model: model || undefined,
            mode: modeInput.value,
            feature: featureInput.value,
            includeContext: Boolean(contextToggle && contextToggle.checked)
        }
    });
    promptInput.value = '';
    setBusy(true, 'Sending…');
}
byId('send-btn').onclick = sendMessage;
byId('clear-btn').onclick = () => {
    logUiAction('clearChat', 'button=clear-btn');
    vscode.postMessage({ type: 'clearChat' });
};
byId('tui-btn').onclick = () => {
    logUiAction('openTui', 'button=tui-btn');
    vscode.postMessage({ type: 'openTui' });
};
byId('refresh-btn').onclick = () => {
    logUiAction('refreshModels', 'button=refresh-btn');
    postTelemetry('refreshModels', {
        source: 'toolbar',
        activeProvider: activeProvider || 'all'
    });
    vscode.postMessage({ type: 'refreshModels' });
};
byId('refresh-sessions-btn').onclick = () => {
    logUiAction('refreshSessions', 'button=refresh-sessions-btn');
    postTelemetry('refreshSessions', { source: 'sessions-panel' });
    vscode.postMessage({ type: 'refreshSessions' });
};
byId('save-model-btn').onclick = () => {
    const selectedModel = getSelectedModel();
    logUiAction(
        'setModel',
        'button=save-model-btn model=' + String(selectedModel || 'default')
    );
    postTelemetry('setModel', {
        source: 'save-button',
        model: selectedModel || 'default',
        provider: getProvider(selectedModel || configuredDefaultModel || '')
    });
    vscode.postMessage({
        type: 'setModel',
        value: { model: selectedModel }
    });
};
byId('use-model-btn').onclick = () => {
    logUiAction(
        'useModel',
        'button=use-model-btn model=' + String(getSelectedModel() || 'default')
    );
    updateModelMeta();
};
modelInput.onchange = () => {
    customModelInput.value = '';
    logUiAction(
        'modelSelectChanged',
        'selected=' + String(modelInput.value || 'default')
    );
    postTelemetry('modelSelectChanged', {
        selectedModel: modelInput.value || 'default',
        provider: getProvider(modelInput.value || configuredDefaultModel || '')
    });
    updateModelMeta();
};
customModelInput.oninput = () => {
    logUiAction(
        'customModelInput',
        'chars=' + String(customModelInput.value.length)
    );
    postTelemetry('customModelInput', {
        textLength: customModelInput.value.length,
        previewProvider: getProvider(customModelInput.value || '')
    });
    updateModelMeta();
};
modeInput.onchange = () => {
    logUiAction('modeChanged', 'mode=' + String(modeInput.value));
    postTelemetry('modeChanged', { mode: modeInput.value });
};
featureInput.onchange = () => {
    logUiAction('featureChanged', 'feature=' + String(featureInput.value));
    postTelemetry('featureChanged', { feature: featureInput.value });
};
contextToggle.onchange = () => {
    logUiAction(
        'contextToggled',
        'enabled=' + String(Boolean(contextToggle.checked))
    );
    postTelemetry('contextToggled', {
        enabled: Boolean(contextToggle.checked)
    });
};
document.querySelectorAll('.suggestion').forEach(button => {
    button.addEventListener('click', () => {
        const mode = button.getAttribute('data-mode');
        const feature = button.getAttribute('data-feature');
        logUiAction(
            'suggestionClicked',
            'label=' + String(button.textContent || '').trim()
        );
        if (mode) {
            modeInput.value = mode;
        }
        if (feature) {
            featureInput.value = feature;
        }
        promptInput.value = button.getAttribute('data-prompt') || '';
        promptInput.focus();
    });
});
promptInput.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        logUiAction('clearChat', 'shortcut=ctrl-or-cmd-k');
        vscode.postMessage({ type: 'clearChat' });
        return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        logUiAction('sendMessage', 'shortcut=enter');
        sendMessage();
    }
});
window.addEventListener('message', event => {
    const message = event.data;
    logUiAction('hostMessageReceived', 'type=' + String(message?.type || ''));
    switch (message.type) {
        case 'receiveMessage':
            if (message.role !== 'user') {
                appendMessage(message.role, message.content, message.error);
            }
            break;
        case 'status':
            setBusy(Boolean(message.busy), message.message);
            break;
        case 'toast':
            statusText.textContent = message.message;
            break;
        case 'modelStatus':
            modelCaption.textContent = message.status || 'Loading models…';
            break;
        case 'cleared':
            chatContainer.innerHTML = '<div class="empty-state"'
                + ' id="empty-state">Chat cleared.</div>';
            setBusy(false, 'Ready');
            break;
        case 'modelsListed':
            populateModels(
                message.models,
                message.configuredModel,
                message.status
            );
            break;
        case 'sessionsListed':
            renderSessions(message.sessions);
            break;
    }
});
logUiAction('webviewReady', 'posting-ready-event');
vscode.postMessage({ type: 'webviewReady' });
promptInput.focus();`;
    }
}

/**
 * Generates a nonce for the webview script content security policy.
 */
function getNonce(): string {
    const chars = [
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        'abcdefghijklmnopqrstuvwxyz',
        '0123456789'
    ].join('');
    let nonce = '';

    for (let i = 0; i < 32; i++) {
        nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return nonce;
}