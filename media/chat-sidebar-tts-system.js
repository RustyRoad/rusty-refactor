let activeSystemSpeechMessageId = '';
let systemSpeechPending = 0;
let systemSpeechInputFinished = false;

/**
 * Publishes Windows-backed speech voices and follows later voice changes.
 *
 * @returns {void}
 */
function initializeSystemSpeech() {
    const synthesis = window.speechSynthesis;
    if (!synthesis) {
        return;
    }
    publishSystemSpeechVoices();
    synthesis.addEventListener(
        'voiceschanged',
        publishSystemSpeechVoices,
    );
}

/**
 * Reports system voices exposed by the local VS Code client.
 *
 * @returns {void}
 */
function publishSystemSpeechVoices() {
    const synthesis = window.speechSynthesis;
    if (!synthesis) {
        return;
    }
    const voices = synthesis.getVoices().map(voice => ({
        id: voice.voiceURI,
        name: voice.name,
    }));
    vscode.postMessage({
        type: 'systemSpeechVoicesListed',
        value: { voices },
    });
}

/**
 * Checks whether Remote-SSH selected local Windows system speech.
 *
 * @returns {boolean} True when system speech can handle the next click.
 */
function shouldUseSystemSpeech() {
    return getChatState().speechBackend === 'system'
        && Boolean(window.speechSynthesis)
        && Boolean(window.SpeechSynthesisUtterance);
}

/**
 * Speaks one response synchronously from the originating Read click.
 *
 * @param {object} request - Message text and selected system voice.
 * @returns {boolean} True when Windows accepted the speech request.
 */
function startSystemSpeechPlayback(request) {
    if (!shouldUseSystemSpeech()) {
        return false;
    }
    beginSystemSpeechStream(request);
    appendSystemSpeechStream(request);
    finishSystemSpeechStream(request.messageId);
    return true;
}

/**
 * Opens a browser speech queue for one progressively streamed response.
 *
 * @param {object} request - Message id and selected system voice.
 * @returns {boolean} True when Windows can own this speech stream.
 */
function beginSystemSpeechStream(request) {
    if (!shouldUseSystemSpeech()) {
        return false;
    }
    const messageId = String(request.messageId || '');
    if (messageId === activeSystemSpeechMessageId) {
        return true;
    }
    stopSystemSpeechPlayback();
    activeSystemSpeechMessageId = messageId;
    systemSpeechPending = 0;
    systemSpeechInputFinished = false;
    vscode.postMessage({
        type: 'systemSpeechStarted',
        value: { messageId },
    });
    return true;
}

/**
 * Queues one speech fragment without interrupting the current utterance.
 *
 * @param {object} request - Message text and selected system voice.
 * @returns {boolean} True when the fragment was accepted locally.
 */
function appendSystemSpeechStream(request) {
    if (!beginSystemSpeechStream(request)) {
        return false;
    }
    const messageId = String(request.messageId || '');
    const text = String(request.text || '').trim();
    if (!text) {
        return true;
    }
    const utterance = new window.SpeechSynthesisUtterance(
        text,
    );
    utterance.voice = selectedSystemSpeechVoice(request.voiceId);
    utterance.onend = () => {
        completeSystemSpeechUtterance(messageId);
    };
    utterance.onerror = event => {
        failSystemSpeechPlayback(messageId, event);
    };
    systemSpeechPending += 1;
    window.speechSynthesis.speak(utterance);
    return true;
}

/**
 * Closes streamed browser speech after every queued utterance ends.
 *
 * @param {unknown} messageId - Assistant message whose input is complete.
 * @returns {void}
 */
function finishSystemSpeechStream(messageId) {
    if (String(messageId || '') !== activeSystemSpeechMessageId) {
        return;
    }
    systemSpeechInputFinished = true;
    if (systemSpeechPending === 0) {
        finishSystemSpeechPlayback(activeSystemSpeechMessageId);
    }
}

/**
 * Advances completion accounting after one queued utterance finishes.
 *
 * @param {string} messageId - Assistant message owning the utterance.
 * @returns {void}
 */
function completeSystemSpeechUtterance(messageId) {
    if (messageId !== activeSystemSpeechMessageId) {
        return;
    }
    systemSpeechPending = Math.max(0, systemSpeechPending - 1);
    if (systemSpeechInputFinished && systemSpeechPending === 0) {
        finishSystemSpeechPlayback(messageId);
    }
}

/**
 * Finds the selected Windows voice without mutating the browser voice list.
 *
 * @param {unknown} voiceId - Persisted system voice identifier.
 * @returns {SpeechSynthesisVoice|null} Matching voice or automatic selection.
 */
function selectedSystemSpeechVoice(voiceId) {
    const id = String(voiceId || '');
    return window.speechSynthesis.getVoices().find(voice => {
        return voice.voiceURI === id;
    }) || null;
}

/**
 * Cancels queued and active speech owned by the local system synthesizer.
 *
 * @returns {void}
 */
function stopSystemSpeechPlayback() {
    activeSystemSpeechMessageId = '';
    systemSpeechPending = 0;
    systemSpeechInputFinished = false;
    window.speechSynthesis?.cancel();
}

/**
 * Reports successful local playback to the remote extension host.
 *
 * @param {string} messageId - Assistant message that finished speaking.
 * @returns {void}
 */
function finishSystemSpeechPlayback(messageId) {
    if (messageId !== activeSystemSpeechMessageId) {
        return;
    }
    activeSystemSpeechMessageId = '';
    systemSpeechPending = 0;
    systemSpeechInputFinished = false;
    postSystemSpeechCompletion(messageId);
}

/**
 * Reports a Windows speech failure to the remote extension host.
 *
 * @param {string} messageId - Assistant message that failed.
 * @param {object} event - Browser speech synthesis error event.
 * @returns {void}
 */
function failSystemSpeechPlayback(messageId, event) {
    if (messageId !== activeSystemSpeechMessageId) {
        return;
    }
    activeSystemSpeechMessageId = '';
    systemSpeechPending = 0;
    systemSpeechInputFinished = false;
    window.speechSynthesis?.cancel();
    const detail = String(event?.error || 'unknown error');
    postSystemSpeechCompletion(
        messageId,
        'Windows speech failed: ' + detail,
    );
}

/**
 * Sends one local speech completion result through the shared host contract.
 *
 * @param {string} messageId - Assistant message that stopped speaking.
 * @param {string} [error] - Optional Windows speech failure detail.
 * @returns {void}
 */
function postSystemSpeechCompletion(messageId, error) {
    vscode.postMessage({
        type: 'speechAudioEnded',
        value: { messageId, error },
    });
}
