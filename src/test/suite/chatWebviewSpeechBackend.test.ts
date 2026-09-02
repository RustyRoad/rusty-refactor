import * as assert from 'assert';

import {
    ChatWebviewSpeechBackend
} from '../../sidebar/chatWebviewSpeechBackend';
import type {
    ChatSpeechAudioCommand,
    ChatSpeechVoice
} from '../../sidebar/chatSpeechTypes';

/**
 * Registers progressive remote speech backend tests.
 */
function registerChatWebviewSpeechBackendTests(): void {
    test('sends bounded chunks with one final marker', sendChunks);
    test('keeps streamed chunks open until finish', streamChunks);
}

/**
 * Verifies streamed synthesis queues audio before its finish command.
 */
async function streamChunks(): Promise<void> {
    const client = new RecordingSpeechClient();
    const commands: ChatSpeechAudioCommand[] = [];
    const backend = new ChatWebviewSpeechBackend(
        command => commands.push(command),
        () => 'http://localhost',
        client
    );

    await backend.append('message-1', 'First fragment.', 'af_heart');
    await backend.append('message-1', 'Second fragment.', 'af_heart');
    backend.finish('message-1');

    const play = commands.filter(command => command.action === 'play');
    assert.strictEqual(play.length, 2);
    assert.ok(play.every(command => !command.final));
    assert.deepStrictEqual(commands[commands.length - 1], {
        action: 'finish',
        messageId: 'message-1'
    });
}

suite(
    'ChatWebviewSpeechBackend',
    registerChatWebviewSpeechBackendTests
);

/**
 * Verifies long text becomes ordered server calls and queued audio commands.
 */
async function sendChunks(): Promise<void> {
    const client = new RecordingSpeechClient();
    const commands: ChatSpeechAudioCommand[] = [];
    const backend = new ChatWebviewSpeechBackend(
        command => commands.push(command),
        () => 'http://localhost',
        client
    );

    await backend.speak('message-1', 'word '.repeat(120), 'af_heart');

    assert.ok(client.scripts.length > 1);
    assert.ok(client.scripts.every(script => script.length <= 180));
    const playCommands = commands.filter(command => {
        return command.action === 'play';
    });
    assert.strictEqual(playCommands.length, client.scripts.length);
    assert.deepStrictEqual(
        playCommands.map(command => command.final),
        playCommands.map((_, index) => {
            return index === playCommands.length - 1;
        })
    );
}

/**
 * Records synthesis calls while returning deterministic WAV signatures.
 */
class RecordingSpeechClient {
    public readonly scripts: string[] = [];

    /**
     * Reports the deterministic test endpoint as configured.
     */
    public isConfigured(): boolean {
        return true;
    }

    /**
     * Returns no selectable voices because this test exercises chunking.
     */
    public async listVoices(): Promise<ChatSpeechVoice[]> {
        return [];
    }

    /**
     * Records one bounded script and returns a minimal WAV signature.
     */
    public async synthesize(
        text: string,
        _voiceId: string,
        _signal: AbortSignal
    ): Promise<Buffer> {
        this.scripts.push(text);
        const audio = Buffer.alloc(12);
        audio.write('RIFF', 0, 'ascii');
        audio.write('WAVE', 8, 'ascii');
        return audio;
    }
}
