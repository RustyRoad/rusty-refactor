let voiceInputAutoSend = false;

/**
 * Initializes microphone state before the host reports true support.
 *
 * @returns {void}
 */
function initializeVoiceInputState() {
    dispatchChatState('setVoiceInputSupported', { supported: false });
    renderVoiceInputSources();
    updateVoiceInputButton();
}

/**
 * Starts or cancels one native speech-to-text capture.
 *
 * @returns {void}
 */
function toggleVoiceInput() {
    if (getChatState().voiceInputActive) {
        vscode.postMessage({ type: 'stopVoiceInput' });
        return;
    }

    startVoiceInputCapture('manual');
}

/**
 * Starts one speech-to-text capture when the UI is ready for input.
 *
 * @param {string} reason - Why capture was started.
 * @returns {void}
 */
function startVoiceInputCapture(reason) {
    const state = getChatState();
    if (!state.voiceInputSupported || state.busy || state.voiceInputActive) {
        return;
    }

    voiceInputAutoSend = shouldAutoSendVoiceInput(reason);
    dispatchChatState('setVoiceInputActive', { active: true });
    updateVoiceInputButton();
    statusBar.classList.add('listening');
    statusText.textContent = 'Listening...';
    logUiAction('startVoiceInput', 'reason=' + String(reason || 'manual'));
    vscode.postMessage({ type: 'startVoiceInput' });
}

/**
 * Returns whether one recognition result should continue voice chat.
 *
 * Manual dictation stays editable because speech recognition can be wrong.
 * Automatic restarts after read-aloud keep the hands-free conversation loop.
 *
 * @param {string} reason - Capture start reason.
 * @returns {boolean} True when recognition should send immediately.
 */
function shouldAutoSendVoiceInput(reason) {
    return reason === 'after-tts';
}

/**
 * Applies host microphone state to the local UI.
 *
 * @param {object} message - Microphone state message from the host.
 * @returns {void}
 */
function handleVoiceInputStateMessage(message) {
    dispatchChatState('setVoiceInputSources', {
        sources: message.sources,
        selectedInputId: message.selectedInputId || '',
    });
    dispatchChatState('setVoiceInputSupported', {
        supported: message.supported !== false,
    });
    dispatchChatState('setVoiceInputActive', {
        active: Boolean(message.listening),
    });
    renderVoiceInputSources();
    updateVoiceInputButton();
    updateVoiceInputStatus(message);
    if (message.error) {
        statusText.textContent = 'Voice input unavailable: '
            + message.error;
    }
}

/**
 * Reflects microphone capture state in the shared status spinner.
 *
 * @param {object} message - Microphone state message from the host.
 * @returns {void}
 */
function updateVoiceInputStatus(message) {
    statusBar.classList.toggle('listening', Boolean(message.listening));
    if (message.listening) {
        statusText.textContent = 'Listening...';
        return;
    }
    if (!message.error
            && !getChatState().busy
            && !getChatState().speakingMessageId) {
        statusText.textContent = 'Ready';
    }
}

/**
 * Persists the selected microphone input source through the host.
 *
 * @returns {void}
 */
function handleVoiceInputSourceChange() {
    dispatchChatState('setVoiceInputSource', {
        sourceId: voiceSourceInput.value,
    });
    logUiAction(
        'voiceInputSourceChanged',
        'source=' + String(voiceSourceInput.value),
    );
    vscode.postMessage({
        type: 'setVoiceInputSource',
        value: { sourceId: voiceSourceInput.value },
    });
}

/**
 * Renders host-supported microphone sources into the input selector.
 *
 * @returns {void}
 */
function renderVoiceInputSources() {
    const sources = effectiveVoiceInputSources();
    voiceSourceInput.innerHTML = '';
    sources.forEach(appendVoiceInputSourceOption);
    voiceSourceInput.value = getChatState().selectedVoiceInputSource
        || 'windows-default';
    voiceSourceInput.disabled = !getChatState().voiceInputSupported
        || getChatState().voiceInputActive;
}

/**
 * Returns host-provided input sources or the default Windows microphone.
 *
 * @returns {object[]} Voice input source records.
 */
function effectiveVoiceInputSources() {
    const sources = getChatState().voiceInputSources;
    if (Array.isArray(sources) && sources.length > 0) {
        return sources;
    }

    return [{
        id: 'windows-default',
        label: 'Default Windows microphone',
    }];
}

/**
 * Appends one microphone source option to the selector.
 *
 * @param {object} source - Input source record from the host.
 * @returns {void}
 */
function appendVoiceInputSourceOption(source) {
    const option = document.createElement('option');
    option.value = String(source.id || '');
    option.textContent = String(source.label || source.id || '');
    voiceSourceInput.appendChild(option);
}

/**
 * Applies recognized speech to the prompt and optionally sends it.
 *
 * Manual dictation is draft-only so the user can correct bad recognition.
 * Auto-restarted dictation after TTS preserves the voice conversation loop.
 *
 * @param {object} message - Recognition result message from the host.
 * @returns {void}
 */
function handleVoiceInputResultMessage(message) {
    const text = String(message.text || '').trim();
    if (!text) {
        return;
    }

    promptInput.value = text;
    dispatchChatState('setDraft', { text });
    resizePromptInput();
    logUiAction(
        'voiceInputResult',
        'chars=' + String(text.length)
            + ' confidence=' + String(message.confidence || '')
            + ' autoSend=' + String(voiceInputAutoSend),
    );
    if (voiceInputAutoSend) {
        sendMessage({ fromVoice: true });
        return;
    }

    voiceInputAutoSend = false;
    statusText.textContent = 'Dictation ready. Edit or send when ready.';
    promptInput.focus();
}

/**
 * Updates microphone button affordance from current state.
 *
 * @returns {void}
 */
function updateVoiceInputButton() {
    const state = getChatState();
    const disabled = !state.voiceInputSupported || state.busy;
    voiceButton.disabled = disabled;
    voiceButton.textContent = state.voiceInputActive ? 'Stop' : 'Mic';
    voiceButton.classList.toggle('listening', state.voiceInputActive);
    voiceButton.title = voiceInputButtonTitle(state, disabled);
}

/**
 * Returns the microphone button tooltip for the current voice input state.
 *
 * @param {object} state - Current chat state snapshot.
 * @param {boolean} disabled - Whether the button is currently disabled.
 * @returns {string} Human-readable tooltip for the microphone button.
 */
function voiceInputButtonTitle(state, disabled) {
    if (state.voiceInputActive) {
        return 'Stop dictation';
    }
    if (!state.voiceInputSupported) {
        return 'Voice input unavailable';
    }
    if (disabled) {
        return 'Voice input is available when Codetether is ready';
    }
    return 'Dictate prompt';
}
