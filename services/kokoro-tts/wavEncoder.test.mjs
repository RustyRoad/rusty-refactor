import assert from 'node:assert/strict';
import test from 'node:test';

import { encodeWav } from './wavEncoder.mjs';

/**
 * Verifies floating-point chunks become one standards-shaped PCM WAV.
 */
function encodeMultipleChunks() {
    const audio = encodeWav([
        new Float32Array([-1, 0]),
        new Float32Array([0.5, 1])
    ], 24_000);

    assert.equal(audio.toString('ascii', 0, 4), 'RIFF');
    assert.equal(audio.toString('ascii', 8, 12), 'WAVE');
    assert.equal(audio.readUInt32LE(24), 24_000);
    assert.equal(audio.readUInt32LE(40), 8);
    assert.equal(audio.readInt16LE(44), -32_768);
    assert.equal(audio.readInt16LE(50), 32_767);
}

/**
 * Verifies a broken model cannot report a successful silent WAV response.
 */
function rejectSilentAudio() {
    assert.throws(
        () => encodeWav([new Float32Array(24_000)], 24_000),
        /silent audio/
    );
}

test('encodes multiple audio chunks as PCM WAV', encodeMultipleChunks);
test('rejects silent model audio', rejectSilentAudio);
