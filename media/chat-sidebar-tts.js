let currentSpeechButton = null;

/**
 * Requests host speech support status during webview startup.
 *
 * @returns {void}
 */
function initializeSpeechState() {
    dispatchChatState('setSpeechSupported', { supported: true });
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
