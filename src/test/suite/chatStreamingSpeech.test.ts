import * as assert from 'assert';
import { readFileSync } from 'fs';
import { Script, createContext } from 'vm';

import { extensionTestPath } from './extensionTestPath';

interface PostedMessage {
    type?: string;
    value?: { messageId?: string; text?: string };
}

/**
 * Registers progressive speech extraction tests for streamed snapshots.
 */
function registerChatStreamingSpeechTests(): void {
    test('queues a sentence before the final snapshot', streamsSentence);
}

suite('ChatStreamingSpeech', registerChatStreamingSpeechTests);

/**
 * Proves cumulative model text emits an early fragment and one final signal.
 */
function streamsSentence(): void {
    const posted: PostedMessage[] = [];
    let queuedVoiceInput = '';
    const context = createContext({
        vscode: {
            postMessage: (message: PostedMessage) => posted.push(message)
        },
        getChatState: () => ({
            selectedVoiceId: 'af_heart',
            speechBackend: 'server'
        }),
        prepareSpeechAudioPlayback: () => undefined,
        speechButtonForMessage: () => null,
        dispatchChatState: () => undefined,
        updateSpeechButtons: () => undefined,
        shouldUseSystemSpeech: () => false,
        queueVoiceInputAfterSpeech: (id: string) => {
            queuedVoiceInput = id;
        },
        stopSpeech: () => undefined,
        String,
        Math,
        Array,
        RegExp
    });
    runSpeechScript(context, 'chat-sidebar-tts-stream-chunks.js');
    runSpeechScript(context, 'chat-sidebar-tts-stream.js');

    new Script(`
        syncStreamingSpeech({
            id: 'response-1',
            content: 'This complete sentence can start playing right now. Pa',
            streaming: true,
            autoSpeak: true,
            error: false
        });
        syncStreamingSpeech({
            id: 'response-1',
            content: 'This complete sentence can start playing right now. '
                + 'Partial ending is now complete.',
            streaming: false,
            autoSpeak: true,
            error: false
        });
    `).runInContext(context);

    assert.strictEqual(queuedVoiceInput, 'response-1');
    assert.deepStrictEqual(
        posted.map(message => message.type),
        [
            'appendSpeechStream',
            'appendSpeechStream',
            'finishSpeechStream'
        ]
    );
    assert.match(posted[0].value?.text || '', /start playing/);
}

/**
 * Loads one browser speech module into a shared deterministic VM context.
 */
function runSpeechScript(
    context: ReturnType<typeof createContext>,
    name: string
): void {
    const source = readFileSync(
        extensionTestPath('media', name),
        'utf8'
    );
    new Script(source).runInContext(context);
}
