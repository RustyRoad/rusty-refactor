import assert from 'node:assert/strict';
import test from 'node:test';

import { readConfiguration } from './configuration.mjs';

/**
 * Verifies production defaults select the validated CUDA execution path.
 */
function defaultsToCudaFp32() {
    const configuration = readConfiguration({});
    assert.equal(configuration.device, 'cuda');
    assert.equal(configuration.dtype, 'fp32');
}

/**
 * Verifies an operator cannot configure an accidental CPU fallback.
 */
function rejectsCpuDevice() {
    assert.throws(
        () => readConfiguration({ KOKORO_DEVICE: 'cpu' }),
        /must be cuda/
    );
}

test('defaults to CUDA FP32 inference', defaultsToCudaFp32);
test('rejects CPU inference', rejectsCpuDevice);
