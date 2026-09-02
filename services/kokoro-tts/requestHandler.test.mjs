import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { createRequestHandler } from './requestHandler.mjs';

const configuration = {
    model: 'test-model',
    device: 'cuda',
    dtype: 'fp32',
    maximumScriptCharacters: 400
};

/**
 * Verifies health remains available while inference work is unresolved.
 */
async function keepHealthResponsive() {
    const synthesizer = new DeferredSynthesizer();
    const server = createServer(
        createRequestHandler(
            configuration,
            synthesizer,
            new PassThrough()
        )
    );
    const url = await listen(server);
    try {
        const speech = fetch(`${url}/tts/speak`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ script: 'Test speech.' })
        });
        await synthesizer.waitUntilStarted();

        const health = await fetch(`${url}/health`);
        assert.equal(health.status, 200);
        assert.deepEqual(await health.json(), {
            status: 'ok',
            model: 'test-model',
            device: 'cuda',
            dtype: 'fp32',
            gpu_required: true,
            model_loaded: true,
            inference_busy: true,
            queued_requests: 0
        });

        synthesizer.complete(testWav());
        assert.equal((await speech).status, 200);
    } finally {
        await close(server);
    }
}

/**
 * Verifies oversized callers cannot begin unbounded inference work.
 */
async function rejectOversizedScript() {
    const synthesizer = new DeferredSynthesizer();
    const server = createServer(
        createRequestHandler(
            configuration,
            synthesizer,
            new PassThrough()
        )
    );
    const url = await listen(server);
    try {
        const response = await fetch(`${url}/tts/speak`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ script: 'x'.repeat(401) })
        });
        assert.equal(response.status, 400);
        assert.equal(synthesizer.callCount, 0);
    } finally {
        await close(server);
    }
}

/**
 * Verifies successful inference is observable without logging private text.
 */
async function logSuccessfulRequest() {
    const synthesizer = new DeferredSynthesizer();
    const output = new PassThrough();
    let log = '';
    output.on('data', chunk => {
        log += chunk.toString();
    });
    const server = createServer(
        createRequestHandler(configuration, synthesizer, output)
    );
    const url = await listen(server);
    try {
        const speech = fetch(`${url}/tts/speak`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ script: 'Private test speech.' })
        });
        await synthesizer.waitUntilStarted();
        synthesizer.complete(testWav());
        assert.equal((await speech).status, 200);
        const records = log.trim().split('\n').map(JSON.parse);
        assert.equal(records[0].status, 'started');
        assert.equal(records[1].status, 'completed');
        assert.equal(records[1].request_id, records[0].request_id);
        assert.ok(!log.includes('Private test speech'));
    } finally {
        await close(server);
    }
}

test('keeps health responsive during inference', keepHealthResponsive);
test('rejects oversized synthesis scripts', rejectOversizedScript);
test('logs successful synthesis metadata', logSuccessfulRequest);

/**
 * Provides controllable inference state to HTTP request tests.
 */
class DeferredSynthesizer {
    /**
     * Creates unresolved start and audio signals for one request test.
     */
    constructor() {
        this.voices = [{ voice_id: 'af_heart', name: 'Heart' }];
        this.defaultVoice = 'af_heart';
        this.callCount = 0;
        this.busy = false;
        this.started = deferred();
        this.audio = deferred();
    }

    /**
     * Reports the fake worker state without waiting for its audio promise.
     */
    status() {
        return { busy: this.busy, queued: 0 };
    }

    /**
     * Starts one controllable synthesis operation for a request.
     */
    async synthesize(_text, _voice, _signal) {
        this.callCount += 1;
        this.busy = true;
        this.started.resolve();
        try {
            return await this.audio.promise;
        } finally {
            this.busy = false;
        }
    }

    /**
     * Waits until the HTTP handler has entered fake inference.
     */
    waitUntilStarted() {
        return this.started.promise;
    }

    /**
     * Completes fake inference with deterministic WAV bytes.
     */
    complete(audio) {
        this.audio.resolve(audio);
    }
}

/**
 * Creates a promise with an externally callable resolver for test control.
 */
function deferred() {
    let resolve;
    const promise = new Promise(resolver => {
        resolve = resolver;
    });
    return { promise, resolve };
}

/**
 * Creates the smallest byte buffer accepted by the extension WAV check.
 */
function testWav() {
    const audio = Buffer.alloc(12);
    audio.write('RIFF', 0, 'ascii');
    audio.write('WAVE', 8, 'ascii');
    return audio;
}

/**
 * Starts one ephemeral loopback HTTP server for an isolated request test.
 */
async function listen(server) {
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    return `http://127.0.0.1:${address.port}`;
}

/**
 * Closes one test server after its in-flight request has settled.
 */
async function close(server) {
    await new Promise((resolve, reject) => {
        server.close(error => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}
