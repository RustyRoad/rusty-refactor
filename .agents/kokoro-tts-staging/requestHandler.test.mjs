import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { createRequestHandler } from './requestHandler.mjs';

/**
 * Verifies successful speech is observable without exposing its text.
 */
test('logs successful synthesis metadata', async () => {
    const output = new PassThrough();
    let log = '';
    output.on('data', chunk => {
        log += chunk.toString();
    });
    const configuration = {
        maximumScriptCharacters: 500,
        model: 'test-model',
        device: 'cuda',
        dtype: 'fp16'
    };
    const synthesizer = {
        defaultVoice: 'af_heart',
        voices: [{ voice_id: 'af_heart' }],
        status: () => ({ busy: false, queued: 0 }),
        synthesize: async () => Buffer.from('RIFF-test')
    };
    const server = createServer(
        createRequestHandler(configuration, synthesizer, output)
    );
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.equal(typeof address, 'object');
    const response = await fetch(
        `http://127.0.0.1:${address.port}/tts/speak`,
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                script: 'Private words stay out of logs.',
                voice_id: 'af_heart'
            })
        }
    );
    await response.arrayBuffer();
    server.close();

    const records = log.trim().split('\n').map(JSON.parse);
    assert.equal(records[0].event, 'tts_request');
    assert.equal(records[0].status, 'started');
    assert.equal(records[0].characters, 31);
    assert.equal(records[1].request_id, records[0].request_id);
    assert.equal(records[1].status, 'completed');
    assert.equal(records[1].audio_bytes, 9);
    assert.ok(!log.includes('Private words'));
});
