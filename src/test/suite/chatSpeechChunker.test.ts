import * as assert from 'assert';

import { splitSpeechText } from '../../sidebar/chatSpeechChunker';

/**
 * Registers bounded progressive speech chunking tests.
 */
function registerChatSpeechChunkerTests(): void {
    test('keeps short speech in one chunk', keepShortSpeech);
    test('prefers sentence boundaries', preferSentenceBoundaries);
    test('hard-wraps an unbroken token', hardWrapToken);
}

suite('ChatSpeechChunker', registerChatSpeechChunkerTests);

/**
 * Verifies small messages avoid unnecessary synthesis requests.
 */
function keepShortSpeech(): void {
    assert.deepStrictEqual(
        splitSpeechText('A short response.'),
        ['A short response.']
    );
}

/**
 * Verifies natural punctuation is chosen before the hard character limit.
 */
function preferSentenceBoundaries(): void {
    const first = 'A'.repeat(90) + '.';
    const chunks = splitSpeechText(
        `${first} ${'B'.repeat(120)}.`
    );
    assert.strictEqual(chunks.length, 2);
    assert.strictEqual(chunks[0], first);
    assert.ok(chunks.every(chunk => chunk.length <= 180));
}

/**
 * Verifies pathological tokens cannot bypass the inference size bound.
 */
function hardWrapToken(): void {
    const chunks = splitSpeechText('x'.repeat(400));
    assert.deepStrictEqual(
        chunks.map(chunk => chunk.length),
        [180, 180, 40]
    );
}
