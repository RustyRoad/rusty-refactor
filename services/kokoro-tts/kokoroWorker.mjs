import { parentPort, workerData } from 'node:worker_threads';

import { createKokoroSynthesizer } from './kokoroSynthesizer.mjs';

if (!parentPort) {
    throw new Error('The Kokoro worker requires a parent message port.');
}

const synthesizer = await createKokoroSynthesizer(workerData);
parentPort.postMessage({
    type: 'ready',
    voices: synthesizer.voices,
    defaultVoice: synthesizer.defaultVoice
});
parentPort.on('message', message => {
    void synthesizeMessage(message);
});

/**
 * Runs one bounded inference job and reports its transferable result.
 */
async function synthesizeMessage(message) {
    if (!message || message.type !== 'synthesize') {
        return;
    }
    try {
        const audio = await synthesizer.synthesize(
            message.text,
            message.voice
        );
        parentPort.postMessage({
            type: 'complete',
            id: message.id,
            audio
        });
    } catch (error) {
        parentPort.postMessage({
            type: 'failed',
            id: message.id,
            error: errorMessage(error)
        });
    }
}

/**
 * Converts an unknown worker failure to a bounded transferable string.
 */
function errorMessage(error) {
    return error instanceof Error
        ? error.message.slice(0, 500)
        : 'Unknown Kokoro inference failure.';
}
