import * as assert from 'assert';

import { ChatVoiceInputService } from '../../sidebar/chatVoiceInputService';
import {
    ChatVoiceInputResult,
    ChatVoiceInputState
} from '../../sidebar/chatVoiceInputTypes';

interface FakeCommandOptions {
    error: Error;
}

/**
 * Simulates the cross-host audio companion without accessing a microphone.
 */
class FakeVoiceInputCommand {
    /**
     * Creates a supported command that rejects capture with a chosen result.
     */
    public constructor(private readonly options: FakeCommandOptions) {}

    /**
     * Reports command support so the service attempts capture.
     */
    public async isSupported(): Promise<boolean> {
        return true;
    }

    /**
     * Rejects capture with the simulated Windows recognition outcome.
     */
    public async capture(): Promise<ChatVoiceInputResult> {
        throw this.options.error;
    }

    /**
     * Accepts cancellation because no real worker is running.
     */
    public async cancel(): Promise<void> {}
}

/**
 * Runs the service once and returns every emitted microphone state.
 */
async function captureStates(error: Error): Promise<ChatVoiceInputState[]> {
    const states: ChatVoiceInputState[] = [];
    const command = new FakeVoiceInputCommand({ error });
    const service = new ChatVoiceInputService(
        undefined,
        state => states.push(state),
        () => undefined,
        command
    );

    await service.start();
    return states;
}

/**
 * Verifies Windows user cancellation returns the composer to Ready silently.
 */
async function ignoresUserCancellation(): Promise<void> {
    const states = await captureStates(new Error([
        'speech recognition failed: user-canceled',
        'Stack backtrace:',
        '0: <unknown>'
    ].join('\n')));

    assert.strictEqual(states.length, 2);
    assert.strictEqual(states[1].listening, false);
    assert.strictEqual(states[1].supported, true);
    assert.strictEqual(states[1].error, undefined);
}

/**
 * Verifies real failures remain visible without native stack trace rows.
 */
async function compactsRecognitionFailure(): Promise<void> {
    const states = await captureStates(new Error([
        'speech recognition failed: microphone-unavailable',
        'Stack backtrace:',
        '0: <unknown>'
    ].join('\n')));

    assert.strictEqual(
        states[1].error,
        'speech recognition failed: microphone-unavailable'
    );
}

/**
 * Registers cancellation and real-failure service coverage.
 */
function defineChatVoiceInputServiceTests(): void {
    test('treats user cancellation as a normal stop', ignoresUserCancellation);
    test('compacts real recognition failures', compactsRecognitionFailure);
}

suite('Chat voice input service', defineChatVoiceInputServiceTests);
