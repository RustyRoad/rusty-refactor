let currentSpeechButton = null;
let voiceRestartMessageId = '';
let voiceRestartArmed = false;

/**
 * Requests host speech support status during webview startup.
 *
 * @returns {void}
 */
function initializeSpeechState() {
    dispatchChatState('setSpeechSupported', { supported: true });
}

/**
 * Creates a read-aloud button for an assistant message.
 *
 * @param {object} record - Message record stored in chat state.
 * @returns {HTMLButtonElement} Button wired to host speech playback.
 */
function createSpeechButton(record) {
    const button = document.createElement('button');
    button.className = 'read-btn';
    button.textContent = 'Read';
    button.title = 'Read this response aloud';
    button.dataset.messageId = record.id;
    button.onclick = toggleSpeech.bind(null, record);
    updateSpeechButton(button, false);
    return button;
}

/**
 * Starts or stops speech for one message through the extension host.
 *
 * @param {object} record - Message record to read aloud.
 * @returns {void}
 */
function toggleSpeech(record) {
    if (isSpeakingMessage(record.id)) {
        vscode.postMessage({ type: 'stopSpeech' });
        return;
    }

    startSpeech(record);
}

/**
 * Starts speech for one message through the extension host.
 *
 * @param {object} record - Message record to read aloud.
 * @returns {void}
 */
function startSpeech(record) {
    currentSpeechButton = speechButtonForMessage(record.id);
    dispatchChatState('setSpeakingMessage', {
        messageId: record.id,
    });
    updateSpeechButtons();
    vscode.postMessage({
        type: 'speakText',
        value: {
            messageId: record.id,
            text: speechText(record.content),
            voiceId: getChatState().selectedVoiceId,
        },
    });
}

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
 * Applies one host speech state update to the local UI.
 *
 * @param {object} message - Speech state message from the extension host.
 * @returns {void}
 */
function handleSpeechStateMessage(message) {
    dispatchChatState('setSpeechSupported', {
        supported: message.supported !== false,
    });
    dispatchChatState('setSpeakingMessage', {
        messageId: message.speaking ? message.messageId || '' : '',
    });
    currentSpeechButton = message.speaking
        ? speechButtonForMessage(message.messageId)
        : null;
    renderVoiceOptions();
    updateSpeechButtons();
    updateSpeechStatus(message);
    maybeRestartVoiceInputAfterSpeech(message);
    if (message.error) {
        statusText.textContent = 'TTS unavailable: ' + message.error;
        clearVoiceInputAfterSpeech();
    }
}

/**
 * Reflects read-aloud state in the shared status spinner.
 *
 * @param {object} message - Speech state message from the extension host.
 * @returns {void}
 */
function updateSpeechStatus(message) {
    statusBar.classList.toggle('speaking', Boolean(message.speaking));
    if (message.speaking) {
        statusText.textContent = 'Reading response...';
        return;
    }
    if (!getChatState().busy && !getChatState().voiceInputActive) {
        statusText.textContent = 'Ready';
    }
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

/**
 * Updates every read-aloud button from the current speech state.
 *
 * @returns {void}
 */
function updateSpeechButtons() {
    document.querySelectorAll('.read-btn').forEach(updateSpeechButtonState);
}

/**
 * Updates one read-aloud button from the current speech state.
 *
 * @param {Element} item - Button element to update.
 * @returns {void}
 */
function updateSpeechButtonState(item) {
    const button = /** @type {HTMLButtonElement} */ (item);
    const state = getChatState();
    const speaking = isSpeakingMessage(button.dataset.messageId || '');
    button.disabled = !state.speechSupported;
    updateSpeechButton(button, speaking);
}

/**
 * Updates a read-aloud button for the current playback state.
 *
 * @param {HTMLButtonElement} button - Button to update.
 * @param {boolean} speaking - Whether the button is currently speaking.
 * @returns {void}
 */
function updateSpeechButton(button, speaking) {
    button.textContent = speaking ? 'Stop' : 'Read';
    button.classList.toggle('speaking', speaking);
    button.title = speaking
        ? 'Stop reading this response'
        : 'Read this response aloud';
}

/**
 * Finds the read button associated with a message id.
 *
 * @param {string} messageId - Message id to find.
 * @returns {HTMLButtonElement|null} Matching button or null.
 */
function speechButtonForMessage(messageId) {
    return document.querySelector(
        '.read-btn[data-message-id="' + String(messageId) + '"]',
    );
}

/**
 * Stops any active host speech playback.
 *
 * @returns {void}
 */
function stopSpeech() {
    vscode.postMessage({ type: 'stopSpeech' });
    clearVoiceInputAfterSpeech();
    dispatchChatState('setSpeakingMessage', { messageId: '' });
    currentSpeechButton = null;
    updateSpeechButtons();
}

/**
 * Checks whether a message is the active speech target.
 *
 * @param {string} messageId - Message id to compare.
 * @returns {boolean} True when the message is being spoken.
 */
function isSpeakingMessage(messageId) {
    return chatStateApi.isMessageSpeaking(getChatState(), messageId);
}

/**
 * Converts markdown-ish assistant text to speech-friendly plain text.
 *
 * @param {string} content - Raw assistant message content.
 * @returns {string} Text suitable for speech synthesis.
 */
function speechText(content) {
    const tick = String.fromCharCode(96);
    const fence = new RegExp(
        tick + tick + tick + '[\\s\\S]*?' + tick + tick + tick,
        'g',
    );
    return String(content || '')
        .replace(fence, ' code block omitted. ')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/[#>*_\[\]()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
