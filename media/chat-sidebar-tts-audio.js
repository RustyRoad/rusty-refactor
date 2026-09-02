let speechAudioContext = null;
let speechAudioSource = null;
let speechAudioMessageId = '';
let speechAudioSequence = 0;
let speechAudioDecoding = false;
let speechAudioQueue = [];
let speechAudioInputFinished = false;

/**
 * Reports local playback progress without including message text or audio.
 *
 * @param {string} stage - Short playback lifecycle stage.
 * @param {object} [detail] - Bounded audio metadata for diagnostics.
 * @returns {void}
 */
function reportSpeechAudio(stage, detail) {
    if (typeof postTelemetry !== 'function') {
        return;
    }
    postTelemetry('speechAudioPlayback', {
        stage,
        ...(detail || {}),
    });
}

/**
 * Unlocks local Web Audio while the Read click has user activation.
 *
 * @returns {void}
 */
function prepareSpeechAudioPlayback() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
        return;
    }
    if (!speechAudioContext) {
        speechAudioContext = new AudioContext();
    }
    void speechAudioContext.resume();
}

/**
 * Applies a queued play or immediate stop command from the extension host.
 *
 * @param {object} message - Transferable speech audio command.
 * @returns {void}
 */
function handleSpeechAudioMessage(message) {
    if (message.action === 'stop') {
        stopSpeechAudioPlayback();
        stopSystemSpeechPlayback();
        return;
    }
    if (message.action === 'finish') {
        finishSpeechAudioInput(message);
        return;
    }
    queueSpeechAudio(message);
}

/**
 * Marks the active queue complete after its final transferred fragment.
 *
 * @param {object} message - Finish command for one assistant message.
 * @returns {void}
 */
function finishSpeechAudioInput(message) {
    const messageId = String(message.messageId || '');
    if (!messageId
            || (speechAudioMessageId
                && messageId !== speechAudioMessageId)) {
        return;
    }
    speechAudioMessageId = messageId;
    speechAudioInputFinished = true;
    if (!speechAudioSource
            && !speechAudioDecoding
            && speechAudioQueue.length === 0) {
        finishSpeechAudio(messageId);
    }
}

/**
 * Adds one WAV chunk to the active message's ordered playback queue.
 *
 * @param {object} message - Play command with a base64 WAV chunk.
 * @returns {void}
 */
function queueSpeechAudio(message) {
    const messageId = String(message.messageId || '');
    if (!messageId) {
        return;
    }
    if (speechAudioMessageId
            && speechAudioMessageId !== messageId) {
        stopSpeechAudioPlayback();
    }
    if (!speechAudioMessageId) {
        speechAudioInputFinished = false;
    }
    speechAudioMessageId = messageId;
    speechAudioQueue.push({
        messageId,
        audioBase64: String(message.audioBase64 || ''),
        final: message.final !== false,
    });
    reportSpeechAudio('queued', {
        encodedBytes: String(message.audioBase64 || '').length,
        queueLength: speechAudioQueue.length,
        contextState: speechAudioContext?.state || 'unavailable',
    });
    void playNextSpeechAudio();
}

/**
 * Decodes and starts the next queued chunk when the player is idle.
 *
 * @returns {Promise<void>} Audio decode and start completion.
 */
async function playNextSpeechAudio() {
    if (speechAudioSource
            || speechAudioDecoding
            || speechAudioQueue.length === 0) {
        return;
    }

    prepareSpeechAudioPlayback();
    const context = speechAudioContext;
    const message = speechAudioQueue.shift();
    if (!context) {
        finishSpeechAudio(
            message.messageId,
            'Local Web Audio is unavailable.',
        );
        return;
    }

    const sequence = speechAudioSequence;
    speechAudioDecoding = true;
    try {
        await context.resume();
        reportSpeechAudio('context-resumed', {
            contextState: context.state || 'unknown',
        });
        const bytes = speechAudioBytes(message.audioBase64);
        const buffer = await context.decodeAudioData(bytes.buffer);
        reportSpeechAudio('decoded', {
            audioBytes: bytes.byteLength,
            durationMs: Math.round(buffer.duration * 1000),
            sampleRate: buffer.sampleRate,
        });
        if (sequence !== speechAudioSequence) {
            return;
        }
        startSpeechAudioSource(context, buffer, message);
    } catch (error) {
        if (sequence === speechAudioSequence) {
            reportSpeechAudio('failed', {
                error: speechAudioErrorMessage(error),
            });
            finishSpeechAudio(
                message.messageId,
                speechAudioErrorMessage(error),
            );
        }
    } finally {
        if (sequence === speechAudioSequence) {
            speechAudioDecoding = false;
        }
    }
}

/**
 * Starts one decoded chunk and advances the queue when playback ends.
 *
 * @param {AudioContext} context - Local Web Audio context.
 * @param {AudioBuffer} buffer - Decoded chunk to play.
 * @param {object} message - Queue metadata for the decoded chunk.
 * @returns {void}
 */
function startSpeechAudioSource(context, buffer, message) {
    const source = context.createBufferSource();
    speechAudioSource = source;
    source.buffer = buffer;
    source.connect(context.destination);
    source.onended = () => {
        finishSpeechAudioSource(source, message);
    };
    source.start();
    reportSpeechAudio('started', {
        contextState: context.state || 'unknown',
    });
}

/**
 * Completes one source and either reports final playback or advances.
 *
 * @param {AudioBufferSourceNode} source - Source that reached its end.
 * @param {object} message - Queue metadata for the completed chunk.
 * @returns {void}
 */
function finishSpeechAudioSource(source, message) {
    if (source !== speechAudioSource) {
        return;
    }
    speechAudioSource = null;
    reportSpeechAudio('ended', {
        queuedChunks: speechAudioQueue.length,
    });
    if (message.final
            || (speechAudioInputFinished
                && speechAudioQueue.length === 0)) {
        finishSpeechAudio(message.messageId);
        return;
    }
    void playNextSpeechAudio();
}

/**
 * Stops local audio and invalidates queued or pending decode work.
 *
 * @returns {void}
 */
function stopSpeechAudioPlayback() {
    speechAudioSequence += 1;
    speechAudioQueue = [];
    speechAudioDecoding = false;
    speechAudioInputFinished = false;
    const source = speechAudioSource;
    speechAudioSource = null;
    speechAudioMessageId = '';
    if (!source) {
        return;
    }
    source.onended = null;
    try {
        source.stop();
    } catch {
        // A source that already ended does not need further cancellation.
    }
}

/**
 * Converts a base64 WAV payload into bytes for Web Audio decoding.
 *
 * @param {string} value - Base64-encoded WAV bytes.
 * @returns {Uint8Array} Decoded audio bytes.
 */
function speechAudioBytes(value) {
    const binary = window.atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

/**
 * Reports final playback completion to the remote extension host.
 *
 * @param {string} messageId - Assistant message that finished playback.
 * @param {string} [error] - Optional local playback failure detail.
 * @returns {void}
 */
function finishSpeechAudio(messageId, error) {
    speechAudioQueue = [];
    speechAudioSource = null;
    speechAudioMessageId = '';
    speechAudioInputFinished = false;
    vscode.postMessage({
        type: 'speechAudioEnded',
        value: { messageId, error },
    });
}

/**
 * Converts an unknown Web Audio failure into a user-facing message.
 *
 * @param {unknown} error - Error thrown while decoding or starting audio.
 * @returns {string} Compact playback failure detail.
 */
function speechAudioErrorMessage(error) {
    return error instanceof Error
        ? 'Local audio playback failed: ' + error.message
        : 'Local audio playback failed.';
}
