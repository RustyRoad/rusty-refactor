/**
 * Sends the current prompt and model settings to the extension host.
 *
 * Empty prompts and concurrent sends are blocked locally. Successful sends add
 * the user message immediately, clear the input, and mark the view busy until
 * the host reports status.
 *
 * @param {object} options - Send options supplied by click or voice input.
 * @returns {void}
 */
function sendMessage(options) {
    const fromVoice = Boolean(options && options.fromVoice);
    const text = promptInput.value.trim();
    const model = getSelectedModel();
    const blockedReason = chatStateApi.sendBlockedReason(
        getChatState(),
        text,
    );

    if (blockedReason) {
        logUiAction('sendMessage blocked', 'reason=' + blockedReason);
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
            'source=' + (fromVoice ? 'voice' : 'keyboard'),
        ].join(' '),
    );
    postSendMessageTelemetry(text, model, fromVoice);
    appendMessage('user', text, false);
    vscode.postMessage({
        type: 'sendMessage',
        value: {
            text,
            model: model || undefined,
            mode: modeInput.value,
            feature: featureInput.value,
            includeContext: Boolean(contextToggle && contextToggle.checked),
            autoSpeak: fromVoice,
        },
    });
    promptInput.value = '';
    dispatchChatState('setDraft', { text: '' });
    resizePromptInput();
    setBusy(true, 'Sending...');
}

/**
 * Emits telemetry for a send request using the current state snapshot.
 *
 * @param {string} text - Prompt text being sent.
 * @param {string} model - Explicit model selected for this request.
 * @param {boolean} fromVoice - Whether microphone input triggered sending.
 * @returns {void}
 */
function postSendMessageTelemetry(text, model, fromVoice) {
    const state = getChatState();
    postTelemetry('sendMessage', {
        textLength: text.length,
        source: fromVoice ? 'voice' : 'keyboard',
        model: model || 'default',
        provider: getProvider(model || state.configuredDefaultModel || ''),
        mode: modeInput.value,
        feature: featureInput.value,
        includeContext: Boolean(contextToggle && contextToggle.checked),
    });
}

/**
 * Requests that the extension host clear the chat transcript.
 *
 * @returns {void}
 */
function clearChat() {
    logUiAction('clearChat', 'button=clear-btn');
    vscode.postMessage({ type: 'clearChat' });
}

/**
 * Requests that the extension host open the terminal TUI.
 *
 * @returns {void}
 */
function openTui() {
    logUiAction('openTui', 'button=tui-btn');
    vscode.postMessage({ type: 'openTui' });
}

/**
 * Requests a fresh model list from the extension host.
 *
 * @returns {void}
 */
function refreshModels() {
    logUiAction('refreshModels', 'button=refresh-btn');
    postTelemetry('refreshModels', {
        source: 'toolbar',
        activeProvider: getChatState().activeProvider || 'all',
    });
    vscode.postMessage({ type: 'refreshModels' });
}

/**
 * Requests a fresh session list from the extension host.
 *
 * @returns {void}
 */
function refreshSessions() {
    logUiAction('refreshSessions', 'button=refresh-sessions-btn');
    postTelemetry('refreshSessions', { source: 'sessions-panel' });
    vscode.postMessage({ type: 'refreshSessions' });
}

/**
 * Saves the selected model as the extension default.
 *
 * @returns {void}
 */
function saveSelectedModel() {
    const selectedModel = getSelectedModel();
    const configuredModel = getChatState().configuredDefaultModel;
    logUiAction(
        'setModel',
        'button=save-model-btn model=' + String(selectedModel || 'default'),
    );
    postTelemetry('setModel', {
        source: 'save-button',
        model: selectedModel || 'default',
        provider: getProvider(selectedModel || configuredModel || ''),
    });
    vscode.postMessage({
        type: 'setModel',
        value: { model: selectedModel },
    });
}

/**
 * Applies the selected model to the current sidebar state.
 *
 * @returns {void}
 */
function useSelectedModel() {
    logUiAction(
        'useModel',
        'button=use-model-btn model='
            + String(getSelectedModel() || 'default'),
    );
    updateModelMeta();
}

/**
 * Handles changes to the model dropdown.
 *
 * @returns {void}
 */
function handleModelInputChange() {
    customModelInput.value = '';
    dispatchChatState('setCustomModel', { model: '' });
    dispatchChatState('setSelectedModel', { model: modelInput.value });
    logUiAction(
        'modelSelectChanged',
        'selected=' + String(modelInput.value || 'default'),
    );
    postTelemetry('modelSelectChanged', {
        selectedModel: modelInput.value || 'default',
        provider: selectedModelProvider(),
    });
    updateModelMeta();
}

/**
 * Returns the provider for the current dropdown selection.
 *
 * @returns {string} Provider id for telemetry.
 */
function selectedModelProvider() {
    const state = getChatState();
    return getProvider(modelInput.value || state.configuredDefaultModel || '');
}

/**
 * Handles edits to the custom model id field.
 *
 * @returns {void}
 */
function handleCustomModelInput() {
    dispatchChatState('setCustomModel', {
        model: customModelInput.value.trim(),
    });
    logUiAction(
        'customModelInput',
        'chars=' + String(customModelInput.value.length),
    );
    postTelemetry('customModelInput', {
        textLength: customModelInput.value.length,
        previewProvider: getProvider(customModelInput.value || ''),
    });
    updateModelMeta();
}

/**
 * Emits telemetry when the conversation mode selection changes.
 *
 * @returns {void}
 */
function handleModeChange() {
    dispatchChatState('setMode', { mode: modeInput.value });
    logUiAction('modeChanged', 'mode=' + String(modeInput.value));
    postTelemetry('modeChanged', { mode: modeInput.value });
}

/**
 * Emits telemetry when the feature preset selection changes.
 *
 * @returns {void}
 */
function handleFeatureChange() {
    dispatchChatState('setFeature', { feature: featureInput.value });
    logUiAction('featureChanged', 'feature=' + String(featureInput.value));
    postTelemetry('featureChanged', { feature: featureInput.value });
}

/**
 * Emits telemetry when active editor context inclusion changes.
 *
 * @returns {void}
 */
function handleContextToggleChange() {
    dispatchChatState('setIncludeContext', {
        includeContext: Boolean(contextToggle.checked),
    });
    logUiAction(
        'contextToggled',
        'enabled=' + String(Boolean(contextToggle.checked)),
    );
    postTelemetry('contextToggled', {
        enabled: Boolean(contextToggle.checked),
    });
}

/**
 * Applies a suggestion button's mode, feature, and prompt to the form.
 *
 * @param {HTMLElement} button - Suggestion button that was clicked.
 * @returns {void}
 */
function applySuggestion(button) {
    const mode = button.getAttribute('data-mode');
    const feature = button.getAttribute('data-feature');
    logUiAction(
        'suggestionClicked',
        'label=' + String(button.textContent || '').trim(),
    );
    if (mode) {
        modeInput.value = mode;
        dispatchChatState('setMode', { mode });
    }
    if (feature) {
        featureInput.value = feature;
        dispatchChatState('setFeature', { feature });
    }
    promptInput.value = button.getAttribute('data-prompt') || '';
    dispatchChatState('setDraft', { text: promptInput.value });
    resizePromptInput();
    promptInput.focus();
}

/**
 * Mirrors prompt draft edits into state and keeps the composer height useful.
 *
 * @returns {void}
 */
function handlePromptInput() {
    dispatchChatState('setDraft', { text: promptInput.value });
    resizePromptInput();
}

/**
 * Fits the prompt composer to its content within CSS min/max bounds.
 *
 * The textarea keeps a compact default height for short prompts while avoiding
 * hidden lines during longer dictated or pasted requests.
 *
 * @returns {void}
 */
function resizePromptInput() {
    promptInput.style.height = 'auto';
    promptInput.style.height = promptInput.scrollHeight + 'px';
}

/**
 * Registers a click listener on one suggestion button.
 *
 * @param {HTMLElement} button - Suggestion button to wire.
 * @returns {void}
 */
function bindSuggestion(button) {
    button.addEventListener('click', applySuggestion.bind(null, button));
}

/**
 * Handles prompt keyboard shortcuts for clearing and sending chat.
 *
 * @param {KeyboardEvent} event - Keyboard event from the prompt textarea.
 * @returns {void}
 */
function handlePromptKeydown(event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        logUiAction('clearChat', 'shortcut=ctrl-or-cmd-k');
        vscode.postMessage({ type: 'clearChat' });
        return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        logUiAction('sendMessage', 'shortcut=enter');
        sendMessage({ fromVoice: false });
    }
}
