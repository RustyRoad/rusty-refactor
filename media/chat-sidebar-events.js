/**
 * Sends the current prompt and model settings to the extension host.
 *
 * Empty prompts are blocked locally. Sending while busy becomes a steering
 * update: the host interrupts the active request and continues with the new
 * direction. Every accepted prompt is rendered optimistically.
 *
 * @param {object} options - Send options supplied by click or voice input.
 * @returns {void}
 */
function sendMessage(options) {
    const fromVoice = Boolean(options && options.fromVoice);
    const text = promptInput.value.trim();
    const model = getRequestModel();
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
            threadId: getChatState().activeThreadId,
            text,
            model: model || undefined,
            modelOptions: modelRuntimeOptionsForRequest(),
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
    vscode.postMessage({
        type: 'clearChat',
        value: { threadId: getChatState().activeThreadId },
    });
}

/**
 * Requests a separate Rusty Refactor chat window from the extension host.
 *
 * @returns {void}
 */
function openChatWindow() {
    logUiAction('openChatWindow', 'button=popout-chat-btn');
    vscode.postMessage({ type: 'openChatWindow' });
}

/**
 * Requests a hard stop for only the selected active chat response.
 *
 * @returns {void}
 */
function interruptChat() {
    const state = getChatState();
    const thread = chatStateApi.activeThread(state);
    if (!thread || !thread.busy) {
        return;
    }

    logUiAction('interruptChat', 'thread=' + String(thread.id));
    postTelemetry('interruptChat', { threadId: thread.id });
    interruptButton.disabled = true;
    statusText.textContent = 'Interrupting...';
    vscode.postMessage({
        type: 'interruptChat',
        value: { threadId: thread.id },
    });
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
 * Sends one model revalidation request to the extension host.
 *
 * @param {string} source - UI surface that requested current models.
 * @returns {void}
 */
function requestModelRefresh(source) {
    logUiAction('refreshModels', 'source=' + source);
    postTelemetry('refreshModels', {
        source,
        activeProvider: getChatState().activeProvider || 'all',
    });
    vscode.postMessage({ type: 'refreshModels' });
}

/**
 * Requests a fresh model list from the toolbar refresh button.
 *
 * @returns {void}
 */
function refreshModels() {
    requestModelRefresh('toolbar');
}

/**
 * Revalidates cached selector choices when the user opens the control.
 *
 * Cached options remain usable while the host checks the current Codetether
 * endpoint. Pointer and focus events can accompany the same interaction, so
 * a short guard coalesces them into one request.
 *
 * @returns {void}
 */
function refreshModelsForSelector() {
    const now = Date.now();
    const elapsed = now - refreshModelsForSelector.lastRequestAt;
    if (elapsed < 500) {
        return;
    }

    refreshModelsForSelector.lastRequestAt = now;
    requestModelRefresh('selector');
}

refreshModelsForSelector.lastRequestAt = 0;

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
    renderModelRuntimeOptions();
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
    renderModelRuntimeOptions();
}

/**
 * Emits telemetry when the conversation mode selection changes.
 *
 * @returns {void}
 */
function handleModeChange() {
    dispatchChatState('setMode', { mode: modeInput.value });
    updateRunSettingSummary();
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
    updateRunSettingSummary();
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
    updateRunSettingSummary();
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
    updateRunSettingSummary();
    promptInput.value = button.getAttribute('data-prompt') || '';
    dispatchChatState('setDraft', { text: promptInput.value });
    resizePromptInput();
    promptInput.focus();
}

/**
 * Updates compact chips shown when run settings are collapsed.
 *
 * The full controls remain the source of truth. Chips only mirror the current
 * select and checkbox values so the collapsed header stays informative.
 *
 * @returns {void}
 */
function updateRunSettingSummary() {
    setChipText(modeChip, compactSelectLabel(modeInput));
    setChipText(featureChip, compactSelectLabel(featureInput));
    setChipText(contextChip, contextChipLabel());
}

/**
 * Writes chip text when the target element exists in the current markup.
 *
 * @param {HTMLElement|null} chip - Optional summary chip element.
 * @param {string} text - Text to show inside the chip.
 * @returns {void}
 */
function setChipText(chip, text) {
    if (chip) {
        chip.textContent = text;
    }
}

/**
 * Extracts compact text from a select control's active option.
 *
 * Mode option labels use a colon to separate the short and long forms. Feature
 * labels can use slash-separated wording, so the first segment is enough for
 * the collapsed summary.
 *
 * @param {HTMLSelectElement|null} input - Select control to summarize.
 * @returns {string} Compact selected-option label.
 */
function compactSelectLabel(input) {
    if (!input || input.selectedIndex < 0) {
        return '';
    }

    const label = input.options[input.selectedIndex].textContent || '';
    const colon = label.indexOf(':');
    const slash = label.indexOf('/');
    const boundary = colon >= 0 ? colon : slash;

    return (boundary >= 0 ? label.slice(0, boundary) : label).trim();
}

/**
 * Returns compact context text for the collapsed run settings summary.
 *
 * @returns {string} Context enabled or disabled label.
 */
function contextChipLabel() {
    return Boolean(contextToggle && contextToggle.checked)
        ? 'Context on'
        : 'Context off';
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
        vscode.postMessage({
            type: 'clearChat',
            value: { threadId: getChatState().activeThreadId },
        });
        return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        logUiAction('sendMessage', 'shortcut=enter');
        sendMessage({ fromVoice: false });
    }
}