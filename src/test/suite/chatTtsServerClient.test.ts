import * as assert from 'assert';
import {
    createServer,
    IncomingMessage,
    Server,
    ServerResponse
} from 'http';

import {
    ChatTtsServerClient
} from '../../sidebar/chatTtsServerClient';

/**
 * Registers focused API-client tests without starting the VS Code host.
 */
function registerTtsServerClientTests(): void {
    test('lists validated server voices', listValidatedVoices);
    test('accepts direct WAV synthesis', synthesizeDirectWav);
    test('accepts legacy job-based synthesis', synthesizeLegacyWav);
}

suite('ChatTtsServerClient', registerTtsServerClientTests);

/**
 * Verifies malformed voice records cannot enter the sidebar voice selector.
 */
async function listValidatedVoices(): Promise<void> {
    const server = createServer(handleDirectRequest);
    const url = await listen(server);
    try {
        const client = new ChatTtsServerClient(() => url);
        const voices = await client.listVoices();
        assert.deepStrictEqual(voices, [{
            id: 'af_heart',
            name: 'Heart (Kokoro)',
            natural: true
        }]);
    } finally {
        await close(server);
    }
}

/**
 * Verifies Kokoro's direct response returns transferable WAV bytes.
 */
async function synthesizeDirectWav(): Promise<void> {
    await assertSynthesis(handleDirectRequest);
}

/**
 * Verifies an existing Qwen-style job response remains compatible.
 */
async function synthesizeLegacyWav(): Promise<void> {
    await assertSynthesis(handleLegacyRequest);
}

/**
 * Runs one synthesis contract against an ephemeral HTTP server.
 */
async function assertSynthesis(
    handler: (
        request: IncomingMessage,
        response: ServerResponse
    ) => void
): Promise<void> {
    const server = createServer(handler);
    const url = await listen(server);
    try {
        const client = new ChatTtsServerClient(() => url);
        const audio = await client.synthesize(
            'Hello from the test.',
            'af_heart',
            new AbortController().signal
        );
        assert.strictEqual(audio.toString('ascii', 0, 4), 'RIFF');
        assert.strictEqual(audio.toString('ascii', 8, 12), 'WAVE');
    } finally {
        await close(server);
    }
}

/**
 * Serves deterministic voice and direct audio responses for tests.
 */
function handleDirectRequest(
    request: IncomingMessage,
    response: ServerResponse
): void {
    if (request.method === 'GET' && request.url === '/voices') {
        respondJson(response, {
            voices: [
                { voice_id: 'af_heart', name: 'Heart (Kokoro)' },
                { voice_id: '', name: 'Invalid Voice' }
            ]
        });
        return;
    }
    if (request.method === 'POST' && request.url === '/tts/speak') {
        respondAudio(response);
        return;
    }

    response.writeHead(404);
    response.end();
}

/**
 * Serves the older job and output response sequence for compatibility.
 */
function handleLegacyRequest(
    request: IncomingMessage,
    response: ServerResponse
): void {
    if (request.method === 'POST' && request.url === '/tts/speak') {
        respondJson(response, { job_id: 'test-job' });
        return;
    }
    if (request.method === 'GET'
            && request.url === '/outputs/test-job') {
        respondAudio(response);
        return;
    }

    response.writeHead(404);
    response.end();
}

/**
 * Sends a compact JSON response from the local API test double.
 */
function respondJson(
    response: ServerResponse,
    body: object
): void {
    const encoded = JSON.stringify(body);
    response.writeHead(200, {
        'content-length': Buffer.byteLength(encoded),
        'content-type': 'application/json'
    });
    response.end(encoded);
}

/**
 * Sends the smallest WAV signature accepted by the production client.
 */
function respondAudio(response: ServerResponse): void {
    const audio = testWav();
    response.writeHead(200, {
        'content-length': audio.byteLength,
        'content-type': 'audio/wav'
    });
    response.end(audio);
}

/**
 * Creates the smallest byte buffer accepted by the WAV signature check.
 */
function testWav(): Buffer {
    const audio = Buffer.alloc(12);
    audio.write('RIFF', 0, 'ascii');
    audio.write('WAVE', 8, 'ascii');
    return audio;
}

/**
 * Starts an ephemeral loopback server and returns its HTTP base URL.
 */
async function listen(server: Server): Promise<string> {
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
        throw new Error('Test server did not expose a TCP address.');
    }
    return `http://127.0.0.1:${address.port}`;
}

/**
 * Closes one test server after in-flight connections finish.
 */
async function close(server: Server): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        server.close(error => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}
