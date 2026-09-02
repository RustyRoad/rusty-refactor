import { KokoroTTS } from 'kokoro-js';
import {
    env as transformersEnvironment
} from '@huggingface/transformers';

import { encodeWav } from './wavEncoder.mjs';

/**
 * Loads one Kokoro model and exposes a serialized inference interface.
 */
export async function createKokoroSynthesizer(configuration) {
    configureCache(configuration.cacheDirectory);
    const model = await KokoroTTS.from_pretrained(
        configuration.model,
        {
            dtype: configuration.dtype,
            device: configuration.device
        }
    );
    const voices = mapVoices(model.voices);
    assertDefaultVoice(voices, configuration.voice);
    /**
     * Generates one bounded text chunk with the loaded ONNX model.
     */
    async function synthesize(text, voice) {
        const audio = await model.generate(text, { voice });
        return encodeWav([audio.audio], audio.sampling_rate);
    }

    return {
        voices,
        defaultVoice: configuration.voice,
        synthesize
    };
}

/**
 * Places downloaded model files outside node_modules so package installs do
 * not discard the model cache.
 */
function configureCache(cacheDirectory) {
    if (cacheDirectory) {
        transformersEnvironment.cacheDir = cacheDirectory;
    }
}

/**
 * Converts Kokoro's keyed voice metadata to the narrow HTTP API contract.
 */
function mapVoices(voiceMetadata) {
    return Object.entries(voiceMetadata).map(([voiceId, metadata]) => ({
        voice_id: voiceId,
        name: `${metadata.name} (Kokoro)`
    }));
}

/**
 * Fails startup when a configured default is not present in the model.
 */
function assertDefaultVoice(voices, defaultVoice) {
    const exists = voices.some(voice => {
        return voice.voice_id === defaultVoice;
    });
    if (!exists) {
        throw new Error(
            `Kokoro voice ${defaultVoice} is not available.`
        );
    }
}
