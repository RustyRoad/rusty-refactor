const vscode = acquireVsCodeApi();
const byId = (id) => document.getElementById(id);
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
            detail,
        },
    });
}

function logUiAction(action, detail) {
    const details = detail ? ' | ' + detail : '';
    vscode.postMessage({
        type: 'log',
        message: '[UI] ' + action + details,
    });
}

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
        'g',
    );
    const inlineCode = new RegExp(tick + '([^' + tick + ']+)' + tick, 'g');
    text = text.replace(fence, (_, code) => {
        return '<pre><code>' + code.trim() + '</code></pre>';
    });
    text = text.replace(inlineCode, '<code>$1</code>');
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\n{2,}/g, '</p><p>');
    text = text.replace(/\n/g, '<br>');
    return '<p>' + text + '</p>';
}

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
}

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
    Object.keys(counts).sort().forEach((provider) => {
        const chip = document.createElement('button');
        chip.className = 'provider-chip'
            + (activeProvider === provider ? ' active' : '');
        chip.textContent = provider + ' ' + counts[provider];
        chip.onclick = () => {
            activeProvider = activeProvider === provider ? '' : provider;
            postTelemetry('providerFilterToggled', {
                provider,
                activeProvider: activeProvider || 'all',
                modelsForProvider: counts[provider] || 0,
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
        ? allModels.filter((model) => getProvider(model) === activeProvider)
        : allModels;
    visible.forEach((model) => {
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
        status: status || '',
    });

    renderModelOptions();
    modelCaption.textContent = status || allModels.length + ' models available';
}

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
    items.forEach((session) => {
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
                value: { path: session.path },
            });
        };
        sessionsList.appendChild(button);
    });
}

function sendMessage() {
    const text = promptInput.value.trim();
    const model = getSelectedModel();
    if (!text || busy) {
        logUiAction(
            'sendMessage blocked',
            !text ? 'reason=empty-input' : 'reason=busy',
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
            'context=' + String(Boolean(contextToggle?.checked)),
        ].join(' '),
    );
    postTelemetry('sendMessage', {
        textLength: text.length,
        model: model || 'default',
        provider: getProvider(model || configuredDefaultModel || ''),
        mode: modeInput.value,
        feature: featureInput.value,
        includeContext: Boolean(contextToggle && contextToggle.checked),
    });
    appendMessage('user', text, false);
    vscode.postMessage({
        type: 'sendMessage',
        value: {
            text,
            model: model || undefined,
            mode: modeInput.value,
            feature: featureInput.value,
            includeContext: Boolean(contextToggle && contextToggle.checked),
        },
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
        activeProvider: activeProvider || 'all',
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
        'button=save-model-btn model=' + String(selectedModel || 'default'),
    );
    postTelemetry('setModel', {
        source: 'save-button',
        model: selectedModel || 'default',
        provider: getProvider(selectedModel || configuredDefaultModel || ''),
    });
    vscode.postMessage({
        type: 'setModel',
        value: { model: selectedModel },
    });
};
byId('use-model-btn').onclick = () => {
    logUiAction(
        'useModel',
        'button=use-model-btn model=' + String(getSelectedModel() || 'default'),
    );
    updateModelMeta();
};
modelInput.onchange = () => {
    customModelInput.value = '';
    logUiAction(
        'modelSelectChanged',
        'selected=' + String(modelInput.value || 'default'),
    );
    postTelemetry('modelSelectChanged', {
        selectedModel: modelInput.value || 'default',
        provider: getProvider(modelInput.value || configuredDefaultModel || ''),
    });
    updateModelMeta();
};
customModelInput.oninput = () => {
    logUiAction(
        'customModelInput',
        'chars=' + String(customModelInput.value.length),
    );
    postTelemetry('customModelInput', {
        textLength: customModelInput.value.length,
        previewProvider: getProvider(customModelInput.value || ''),
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
        'enabled=' + String(Boolean(contextToggle.checked)),
    );
    postTelemetry('contextToggled', {
        enabled: Boolean(contextToggle.checked),
    });
};
document.querySelectorAll('.suggestion').forEach((button) => {
    button.addEventListener('click', () => {
        const mode = button.getAttribute('data-mode');
        const feature = button.getAttribute('data-feature');
        logUiAction(
            'suggestionClicked',
            'label=' + String(button.textContent || '').trim(),
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
promptInput.addEventListener('keydown', (event) => {
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
window.addEventListener('message', (event) => {
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
                message.status,
            );
            break;
        case 'sessionsListed':
            renderSessions(message.sessions);
            break;
    }
});
logUiAction('webviewReady', 'posting-ready-event');
vscode.postMessage({ type: 'webviewReady' });
promptInput.focus();
