import * as assert from 'assert';
import { readFileSync } from 'fs';
import { Script, createContext } from 'vm';

import { extensionTestPath } from './extensionTestPath';

interface PostedMessage {
    type?: string;
    value?: { messageId?: string; error?: string };
}

/**
 * Registers the progressive webview audio queue test.
 */
function registerChatSpeechAudioQueueTests(): void {
    test('plays chunks in order and ends after final audio', playQueue);
}

suite('ChatSpeechAudioQueue', registerChatSpeechAudioQueueTests);

/**
 * Verifies only the final queued chunk reports message playback completion.
 */
async function playQueue(): Promise<void> {
    const posted: PostedMessage[] = [];
    const telemetry: string[] = [];
    const audio = new FakeAudioContext();

    /**
     * Returns the shared fake context for deterministic playback.
     */
    function createAudioContext(): FakeAudioContext {
        return audio;
    }

    const context = createContext({
        window: {
            AudioContext: createAudioContext,
            atob: decodeBase64
        },
        vscode: {
            postMessage: (message: PostedMessage) => posted.push(message)
        },
        postTelemetry: (
            _event: string,
            detail: { stage?: string }
        ) => telemetry.push(detail.stage || ''),
        Uint8Array,
        Error
    });
    const source = readFileSync(
        extensionTestPath('media', 'chat-sidebar-tts-audio.js'),
        'utf8'
    );
    new Script(source).runInContext(context);
    new Script(`
        handleSpeechAudioMessage({
            action: 'play',
            messageId: 'message-1',
            audioBase64: 'AA==',
            final: false
        });
        handleSpeechAudioMessage({
            action: 'play',
            messageId: 'message-1',
            audioBase64: 'AA==',
            final: false
        });
        handleSpeechAudioMessage({
            action: 'finish',
            messageId: 'message-1'
        });
    `).runInContext(context);

    await settlePlayback();
    assert.strictEqual(audio.startedSources, 2);
    assert.strictEqual(posted.length, 1);
    assert.strictEqual(posted[0].type, 'speechAudioEnded');
    assert.strictEqual(posted[0].value?.messageId, 'message-1');
    assert.strictEqual(posted[0].value?.error, undefined);
    assert.ok(telemetry.includes('decoded'));
    assert.ok(telemetry.includes('started'));
    assert.ok(telemetry.includes('ended'));
}

/**
 * Decodes test base64 with Node while matching the browser atob contract.
 */
function decodeBase64(value: string): string {
    return Buffer.from(value, 'base64').toString('binary');
}

/**
 * Allows async decode and source-end callbacks to drain in sequence.
 */
async function settlePlayback(): Promise<void> {
    for (let index = 0; index < 8; index += 1) {
        await new Promise<void>(resolve => {
            setImmediate(resolve);
        });
    }
}

/**
 * Implements the Web Audio operations required by the queue script.
 */
class FakeAudioContext {
    public startedSources = 0;
    public readonly destination = {};
    public readonly state = 'running';

    /**
     * Simulates an already-unlocked audio context.
     */
    public async resume(): Promise<void> {
        return undefined;
    }

    /**
     * Accepts any bytes because decoding behavior is outside this queue test.
     */
    public async decodeAudioData(
        _audio: ArrayBuffer
    ): Promise<{ duration: number; sampleRate: number }> {
        return { duration: 0.25, sampleRate: 24_000 };
    }

    /**
     * Creates one controllable source and records when playback starts.
     */
    public createBufferSource(): FakeAudioSource {
        return new FakeAudioSource(() => {
            this.startedSources += 1;
        });
    }
}

/**
 * Simulates one Web Audio source that ends on the next event-loop turn.
 */
class FakeAudioSource {
    public buffer: object | undefined;
    public onended: (() => void) | null = null;

    /**
     * Retains the callback used to count source starts.
     */
    public constructor(private readonly onStart: () => void) {}

    /**
     * Accepts the fake destination without additional routing behavior.
     */
    public connect(_destination: object): void {}

    /**
     * Starts playback and schedules deterministic completion.
     */
    public start(): void {
        this.onStart();
        setImmediate(() => {
            this.onended?.();
        });
    }

    /**
     * Supports the production stop contract for cleanup paths.
     */
    public stop(): void {}
}
