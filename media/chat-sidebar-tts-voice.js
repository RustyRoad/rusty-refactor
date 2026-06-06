let voiceRestartMessageId = '';
let voiceRestartArmed = false;

/**
 * Marks an auto-read assistant response as eligible for mic restart.
 *
 * @param {string} messageId - Assistant message that will be read aloud.
 * @returns {void}
 */
function queueVoiceInputAfterSpeech(messageId) {
    voiceRestartMessageId = messageId;
    voiceRestartArmed = false;
}

/**
 * Clears any pending microphone restart requested by voice mode.
 *
 * @returns {void}
 */
function clearVoiceInputAfterSpeech() {
    voiceRestartMessageId = '';
    voiceRestartArmed = false;
}

/**
 * Applies host-provided voice options to the voice selector.
 *
 * @param {object} message - Voice list message from the extension host.
 * @returns {void}
 */
function handleSpeechVoicesListedMessage(message) {
    dispatchChatState('setSpeechVoices', {
        voices: message.voices,
        selectedVoiceId: message.selectedVoiceId || '',
    });
    renderVoiceOptions();
}

/**
 * Persists the selected voice through the extension host.
 *
 * @returns {void}
 */
function handleVoiceChange() {
    dispatchChatState('setSelectedVoice', {
        voiceId: voiceInput.value,
    });
    vscode.postMessage({
        type: 'setTtsVoice',
        value: { voiceId: voiceInput.value },
    });
}

/**
 * Renders installed voices into the voice selector.
 *
 * @returns {void}
 */
function renderVoiceOptions() {
    const state = getChatState();
    voiceInput.innerHTML = '';
    appendVoiceOption('', 'Automatic voice');
    state.speechVoices.forEach(voice => {
        const label = voice.natural ? voice.name + ' (natural)' : voice.name;
        appendVoiceOption(voice.id, label);
    });
    voiceInput.value = state.selectedVoiceId || '';
    voiceInput.disabled = !state.speechSupported
        || state.speechVoices.length === 0;
}

/**
 * Appends one option to the voice selector.
 *
 * @param {string} value - Voice id value.
 * @param {string} label - Human-readable voice label.
 * @returns {void}
 */
function appendVoiceOption(value, label) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    voiceInput.appendChild(option);
}

/**
 * Restarts dictation after an auto-read voice response finishes.
 *
 * @param {object} message - Speech state message from the extension host.
 * @returns {void}
 */
function maybeRestartVoiceInputAfterSpeech(message) {
    const messageId = String(message.messageId || '');
    if (!voiceRestartMessageId || messageId !== voiceRestartMessageId) {
        return;
    }
    if (message.speaking) {
        voiceRestartArmed = true;
        return;
    }
    if (!voiceRestartArmed || message.error) {
        return;
    }

    clearVoiceInputAfterSpeech();
    window.setTimeout(() => {
        startVoiceInputCapture('after-tts');
    }, 250);
}

