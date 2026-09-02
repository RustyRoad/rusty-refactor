import * as assert from 'assert';
import { readFileSync } from 'fs';
import { Script, createContext } from 'vm';

import { extensionTestPath } from './extensionTestPath';

interface PostedMessage {
    type?: string;
    value?: { messageId?: string; voices?: unknown[] };
}

/**
 * Registers the Windows-backed webview speech tests.
 */
function registerChatSystemSpeechTests(): void {
    test('speaks directly and reports completion', speakWithSystemVoice);
}

suite('ChatSystemSpeech', registerChatSystemSpeechTests);

/**
 * Verifies Remote-SSH speech stays in the local client and uses its voice.
 */
function speakWithSystemVoice(): void {
    const posted: PostedMessage[] = [];
    const synthesis = new FakeSpeechSynthesis();
    const context = createContext({
        window: {
            speechSynthesis: synthesis,
            SpeechSynthesisUtterance: FakeSpeechUtterance,
        },
        vscode: {
            postMessage: (message: PostedMessage) => posted.push(message),
        },
        getChatState: () => ({ speechBackend: 'system' }),
        Boolean,
        String,
    });
    const source = readFileSync(
        extensionTestPath('media', 'chat-sidebar-tts-system.js'),
        'utf8'
    );
    new Script(source).runInContext(context);
    new Script(`
        initializeSystemSpeech();
        startSystemSpeechPlayback({
            messageId: 'message-1',
            text: 'Windows speaker test.',
            voiceId: 'voice-1'
        });
    `).runInContext(context);

    assert.strictEqual(synthesis.spoken.length, 1);
    assert.strictEqual(synthesis.spoken[0].text, 'Windows speaker test.');
    assert.strictEqual(synthesis.spoken[0].voice?.voiceURI, 'voice-1');
    assert.strictEqual(posted[0].type, 'systemSpeechVoicesListed');
    assert.strictEqual(posted[1].type, 'systemSpeechStarted');

    synthesis.spoken[0].onend?.();
    assert.strictEqual(posted[2].type, 'speechAudioEnded');
    assert.strictEqual(posted[2].value?.messageId, 'message-1');
}

/**
 * Represents the small utterance surface used by the webview script.
 */
class FakeSpeechUtterance {
    public voice: FakeSpeechVoice | null = null;
    public onend: (() => void) | null = null;
    public onerror: ((event: { error?: string }) => void) | null = null;

    /**
     * Retains text that the system synthesizer should read.
     */
    public constructor(public readonly text: string) {}
}

interface FakeSpeechVoice {
    voiceURI: string;
    name: string;
}

/**
 * Records local speech requests without requiring an audio device in tests.
 */
class FakeSpeechSynthesis {
    public readonly spoken: FakeSpeechUtterance[] = [];
    private readonly voices: FakeSpeechVoice[] = [
        { voiceURI: 'voice-1', name: 'Windows Voice' },
    ];

    /**
     * Accepts the browser voice-change listener contract.
     */
    public addEventListener(
        _event: string,
        _listener: () => void
    ): void {}

    /**
     * Returns the voices exposed by the simulated Windows client.
     */
    public getVoices(): FakeSpeechVoice[] {
        return this.voices.slice();
    }

    /**
     * Records one utterance started from the Read click.
     */
    public speak(utterance: FakeSpeechUtterance): void {
        this.spoken.push(utterance);
    }

    /**
     * Supports cancellation without completing the current utterance.
     */
    public cancel(): void {}
}
