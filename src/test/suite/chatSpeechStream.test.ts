import * as assert from 'assert';

import { ChatSpeechStream } from '../../sidebar/chatSpeechStream';

/**
 * Registers ordered host speech queue tests.
 */
function registerChatSpeechStreamTests(): void {
    test('serializes fragments before finish', serializesFragments);
    test('ignores fragments after cancellation', cancelsFragments);
}

suite('ChatSpeechStream', registerChatSpeechStreamTests);

/**
 * Verifies asynchronous playback retains model text order through close.
 */
async function serializesFragments(): Promise<void> {
    const events: string[] = [];
    const stream = new ChatSpeechStream(
        async text => {
            await Promise.resolve();
            events.push(text);
        },
        () => {
            events.push('finished');
        },
        error => {
            throw error;
        }
    );

    stream.append('first');
    stream.append('second');
    stream.finish();
    await settleQueue();

    assert.deepStrictEqual(events, ['first', 'second', 'finished']);
}

/**
 * Verifies superseded model responses cannot reach a speech backend.
 */
async function cancelsFragments(): Promise<void> {
    const events: string[] = [];
    const stream = new ChatSpeechStream(
        async text => {
            events.push(text);
        },
        () => undefined,
        error => {
            throw error;
        }
    );
    stream.cancel();
    stream.append('ignored');
    stream.finish();
    await settleQueue();
    assert.deepStrictEqual(events, []);
}

/**
 * Allows the promise chain owned by the speech queue to drain.
 */
async function settleQueue(): Promise<void> {
    for (let index = 0; index < 4; index += 1) {
        await new Promise<void>(resolve => {
            setImmediate(resolve);
        });
    }
}
