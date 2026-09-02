import * as assert from 'assert';

import { CodetetherRealtimeClient } from
    '../../codetetherRealtimeClient';
import type {
    CodetetherChatProgress
} from '../../codetetherChatProgress';
import type {
    CodetetherSteeringSender
} from '../../codetetherRealtimeTypes';
import { CodetetherRealtimeTestServer } from
    './codetetherRealtimeTestServer';

/**
 * Verifies authenticated streaming and same-turn steering end to end.
 */
async function streamsAndSteersActiveTurn(): Promise<void> {
    const server = new CodetetherRealtimeTestServer();
    const port = await server.listen();
    const progress: CodetetherChatProgress[] = [];
    let steer: CodetetherSteeringSender | undefined;
    try {
        const client = new CodetetherRealtimeClient(
            '127.0.0.1',
            port,
            server.token
        );
        const completion = client.complete('inspect the workspace', {
            sessionTitle: 'Workspace inspection',
            sink: update => progress.push(update),
            onSteeringReady: sender => {
                steer = sender;
            }
        });
        await server.waitForPrompt();
        assert.ok(steer);
        assert.equal(await steer('use the focused tests'), true);
        const result = await completion;

        assert.equal(server.authorization, 'Bearer test-token');
        assert.equal(server.sessionTitle, 'Workspace inspection');
        assert.equal(server.prompt, 'inspect the workspace');
        assert.equal(server.steering, 'use the focused tests');
        assert.equal(result.text, 'final answer');
        assert.equal(result.sessionId, 'session-1');
        assert.equal(result.toolEvents.length, 2);
        assert.equal(progress.map(item => item.textDelta || '').join(''),
            'final answer');
        assert.equal(
            progress.map(item => item.thinkingDelta || '').join(''),
            'hello'
        );
    } finally {
        await server.close();
    }
}

/**
 * Verifies a refused upgrade names the outdated-server cause and remedy.
 */
async function explainsRejectedHandshake(): Promise<void> {
    const server = new CodetetherRealtimeTestServer({
        rejectUpgradeStatus: 403
    });
    const port = await server.listen();
    try {
        const client = new CodetetherRealtimeClient(
            '127.0.0.1',
            port,
            server.token
        );
        await assert.rejects(
            client.complete('hello', {}),
            (error: Error) => {
                assert.match(error.message, /returned HTTP 403/);
                assert.match(error.message, /api\/realtime\/session/);
                assert.match(error.message, /upgrade codetether/);
                assert.doesNotMatch(error.message, /Unexpected server/);
                return true;
            }
        );
    } finally {
        await server.close();
    }
}

/**
 * Registers realtime transport integration tests.
 */
function defineCodetetherRealtimeClientTests(): void {
    test('streams and steers one active turn', streamsAndSteersActiveTurn);
    test(
        'explains a rejected realtime handshake',
        explainsRejectedHandshake
    );
}

suite(
    'Codetether realtime client',
    defineCodetetherRealtimeClientTests
);