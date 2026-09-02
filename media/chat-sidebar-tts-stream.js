let streamingSpeech = null;

/**
 * Begins reading one response while later model text is still arriving.
 *
 * @param {object} record - Current assistant stream snapshot.
 * @returns {void}
 */
function startStreamingSpeech(record) {
    if (streamingSpeech?.messageId === record.id) {
        syncStreamingSpeech(record);
        return;
    }
    if (streamingSpeech) {
        stopSpeech();
    }
    prepareSpeechAudioPlayback();
    streamingSpeech = {
        messageId: record.id,
        content: '',
        buffer: '',
        voiceId: getChatState().selectedVoiceId,
        finished: false,
        fragments: 0,
    };
    currentSpeechButton = speechButtonForMessage(record.id);
    dispatchChatState('setSpeakingMessage', {
        messageId: record.id,
    });
    updateSpeechButtons();
    if (shouldUseSystemSpeech()) {
        beginSystemSpeechStream(streamingSpeechRequest('', record.id));
    }
    syncStreamingSpeech(record);
}

/**
 * Appends newly stable text and closes speech with the final snapshot.
 *
 * @param {object} record - Latest cumulative assistant stream snapshot.
 * @returns {void}
 */
function syncStreamingSpeech(record) {
    if (record.error && streamingSpeech?.messageId === record.id) {
        stopSpeech();
        return;
    }
    if (!streamingSpeech && record.autoSpeak && !record.error) {
        queueVoiceInputAfterSpeech(record.id);
        startStreamingSpeech(record);
        return;
    }
    if (!streamingSpeech
            || streamingSpeech.messageId !== record.id
            || streamingSpeech.finished) {
        return;
    }
    const content = String(record.content || '');
    const delta = streamingSpeechDelta(
        streamingSpeech.content,
        content,
    );
    streamingSpeech.content = content;
    streamingSpeech.buffer += delta;
    const result = takeStreamingSpeechChunks(
        streamingSpeech.buffer,
        !record.streaming,
    );
    streamingSpeech.buffer = result.remainder;
    result.chunks.forEach(sendStreamingSpeechFragment);
    if (!record.streaming) {
        finishStreamingSpeech();
    }
}

/**
 * Returns only content not present in the preceding cumulative snapshot.
 *
 * @param {string} previous - Earlier cumulative model text.
 * @param {string} current - Latest cumulative model text.
 * @returns {string} Append-only suffix safe to queue once.
 */
function streamingSpeechDelta(previous, current) {
    if (current.startsWith(previous)) {
        return current.slice(previous.length);
    }
    let shared = 0;
    while (shared < previous.length
            && shared < current.length
            && previous[shared] === current[shared]) {
        shared += 1;
    }
    return current.slice(shared);
}

/**
 * Sends one raw Markdown fragment to the selected speech backend.
 *
 * @param {string} text - Stable model text fragment.
 * @returns {void}
 */
function sendStreamingSpeechFragment(text) {
    streamingSpeech.fragments += 1;
    const request = streamingSpeechRequest(
        text,
        streamingSpeech.messageId,
    );
    if (shouldUseSystemSpeech()) {
        request.text = speechText(request.text);
        appendSystemSpeechStream(request);
        return;
    }
    vscode.postMessage({
        type: 'appendSpeechStream',
        value: request,
    });
}

/**
 * Signals that no more fragments belong to the active speech response.
 *
 * @returns {void}
 */
function finishStreamingSpeech() {
    if (!streamingSpeech || streamingSpeech.finished) {
        return;
    }
    if (streamingSpeech.fragments === 0) {
        sendStreamingSpeechFragment('');
    }
    streamingSpeech.finished = true;
    if (shouldUseSystemSpeech()) {
        finishSystemSpeechStream(streamingSpeech.messageId);
        return;
    }
    vscode.postMessage({
        type: 'finishSpeechStream',
        value: { messageId: streamingSpeech.messageId },
    });
}

/**
 * Builds the shared fragment request without exposing mutable stream state.
 *
 * @param {string} text - Raw fragment text.
 * @param {string} messageId - Assistant message owning the fragment.
 * @returns {object} Host or browser speech request.
 */
function streamingSpeechRequest(text, messageId) {
    return {
        messageId,
        text,
        voiceId: streamingSpeech?.voiceId
            || getChatState().selectedVoiceId,
    };
}

/**
 * Releases progressive tracking after stop or final playback completion.
 *
 * @param {string} [messageId] - Optional message that completed playback.
 * @returns {void}
 */
function resetStreamingSpeech(messageId) {
    if (messageId
            && streamingSpeech?.messageId !== messageId) {
        return;
    }
    streamingSpeech = null;
}
