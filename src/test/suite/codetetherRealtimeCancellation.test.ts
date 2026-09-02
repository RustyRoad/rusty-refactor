import * as assert from 'assert';

import { CodetetherRealtimeSocket } from
    '../../codetetherRealtimeSocket';
import { CodetetherRealtimeTestServer } from
    './codetetherRealtimeTestServer';

/**
 * Identifies the transport-neutral cancellation error contract.
 */
function isCancellation(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}

/**
 * Creates one realtime socket bound to the loopback protocol server.
 */
function createSocket(
    server: CodetetherRealtimeTestServer,
    port: number
): CodetetherRealtimeSocket {
    return new CodetetherRealtimeSocket(
        '127.0.0.1',
        port,
        server.token,
        'session-1'
    );
}

/**
 * Verifies cancellation prevents even the initial transport connection.
 */
async function rejectsAlreadyAbortedSignal(): Promise<void> {
    const server = new CodetetherRealtimeTestServer();
    const port = await server.listen();
    const controller = new AbortController();
    controller.abort();
    try {
        await assert.rejects(
            createSocket(server, port).run('do not start', {
                signal: controller.signal
            }),
            isCancellation
        );
        assert.equal(server.upgradeCount, 0);
    } finally {
        await server.close();
    }
}

/**
 * Verifies an open turn receives cancellation before its socket terminates.
 */
async function cancelsOpenTurn(): Promise<void> {
    const server = new CodetetherRealtimeTestServer();
    const port = await server.listen();
    const controller = new AbortController();
    try {
        const completion = createSocket(server, port).run('long task', {
            signal: controller.signal
        });
        const rejection = assert.rejects(completion, isCancellation);
        await server.waitForPrompt();
        controller.abort();
        await rejection;
        await server.waitForCancel();
        await server.waitForClientClose();
        assert.deepEqual(server.clientFrames, ['prompt', 'cancel']);
    } finally {
        await server.close();
    }
}

/**
 * Verifies cancellation is bounded when a server fails to close its socket.
 */
async function forcesCancellationForUnresponsivePeer(): Promise<void> {
    const server = new CodetetherRealtimeTestServer({
        closeOnCancel: false
    });
    const port = await server.listen();
    const controller = new AbortController();
    try {
        const completion = createSocket(server, port).run('long task', {
            signal: controller.signal
        });
        const rejection = assert.rejects(completion, isCancellation);
        await server.waitForPrompt();
        controller.abort();
        await rejection;
        await server.waitForCancel();
        await server.waitForClientClose();
        assert.deepEqual(server.clientFrames, ['prompt', 'cancel']);
    } finally {
        await server.close();
    }
}

/**
 * Verifies an abort during upgrade can never send the queued prompt.
 */
async function suppressesPromptDuringConnection(): Promise<void> {
    const server = new CodetetherRealtimeTestServer({
        deferUpgrade: true
    });
    const port = await server.listen();
    const controller = new AbortController();
    try {
        const completion = createSocket(server, port).run('must not run', {
            signal: controller.signal
        });
        const rejection = assert.rejects(completion, isCancellation);
        await server.waitForUpgrade();
        controller.abort();
        await rejection;
        await new Promise(resolve => setImmediate(resolve));
        server.releaseUpgrade();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(server.prompt, '');
        assert.deepEqual(server.clientFrames, []);
        assert.equal(server.connectionCount, 0);
    } finally {
        await server.close();
    }
}

/**
 * Registers realtime hard-cancellation transport coverage.
 */
function defineCodetetherRealtimeCancellationTests(): void {
    test(
        'rejects an already-aborted signal before connecting',
        rejectsAlreadyAbortedSignal
    );
    test('sends cancel before closing an open turn', cancelsOpenTurn);
    test(
        'forces cancellation when the peer does not close',
        forcesCancellationForUnresponsivePeer
    );
    test(
        'suppresses a prompt when aborted during connection',
        suppressesPromptDuringConnection
    );
}

suite(
    'Codetether realtime cancellation',
    defineCodetetherRealtimeCancellationTests
);