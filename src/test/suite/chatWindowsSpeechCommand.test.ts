import * as assert from 'assert';

import {
    ChatWindowsSpeechCommand
} from '../../sidebar/chatWindowsSpeechCommand';

const EXTENSION_FOLDER =
    'rusty-refactor.rusty-refactor-0.6.32-test';

/**
 * Builds one representative native HF speech command.
 */
function buildCommand(
    text: string,
    voice: string,
    server: string
): string {
    return new ChatWindowsSpeechCommand().build(
        text,
        voice,
        server,
        EXTENSION_FOLDER,
        '.vscode-insiders'
    );
}

/**
 * Returns the encoded worker arguments before the terminal exit statement.
 */
function workerArguments(command: string): string[] {
    const tokens = command.split(' ');
    return tokens.slice(3, tokens.indexOf(';'));
}

/**
 * Verifies speech inputs never become executable terminal grammar.
 */
function encodesSpeechInputs(): void {
    const text = "hello'; Write-Error 'unsafe";
    const voice = "voice'; exit";
    const server = "http://server/'; Write-Error 'unsafe";
    const command = buildCommand(text, voice, server);
    const arguments_ = workerArguments(command);

    assert.ok(!command.includes(text));
    assert.ok(!command.includes(voice));
    assert.ok(!command.includes(server));
    assert.strictEqual(
        Buffer.from(arguments_[0], 'base64').toString('utf8'),
        server
    );
    assert.strictEqual(
        Buffer.from(arguments_[1], 'base64').toString('utf8'),
        voice
    );
}

/**
 * Verifies the terminal directly invokes the packaged Rust worker.
 */
function targetsPackagedWorker(): void {
    const command = buildCommand(
        'Hugging Face test',
        'af_heart',
        'http://192.168.50.101:8016'
    );

    assert.ok(command.includes('rusty_refactor_worker.exe'));
    assert.ok(command.includes('.vscode-insiders'));
    assert.ok(command.includes(EXTENSION_FOLDER));
    assert.ok(command.includes(' hf-tts '));
    assert.ok(!command.includes('powershell.exe'));
    assert.ok(!command.includes('Invoke-WebRequest'));
    assert.ok(command.endsWith('; exit'));
}

/**
 * Verifies long responses become service-safe native worker arguments.
 */
function chunksLongResponses(): void {
    const text = `${'First sentence. '.repeat(20)}Last sentence.`;
    const command = buildCommand(
        text,
        'af_heart',
        'http://192.168.50.101:8016'
    );
    const chunks = workerArguments(command).slice(2).map(value => {
        return Buffer.from(value, 'base64').toString('utf8');
    });

    assert.strictEqual(chunks.join(' '), text);
    assert.ok(chunks.length > 1);
    assert.ok(chunks.every(chunk => chunk.length <= 180));
}

/**
 * Verifies unsafe installation path fragments are rejected.
 */
function rejectsUnsafeWorkerPath(): void {
    assert.throws(() => {
        new ChatWindowsSpeechCommand().build(
            'test',
            'af_heart',
            'http://192.168.50.101:8016',
            'extension"; exit',
            '.vscode-insiders'
        );
    });
}

/**
 * Registers native Windows speech command tests.
 */
function defineChatWindowsSpeechCommandTests(): void {
    test('encodes speech inputs', encodesSpeechInputs);
    test('targets the packaged Rust worker', targetsPackagedWorker);
    test('chunks long responses', chunksLongResponses);
    test('rejects unsafe worker paths', rejectsUnsafeWorkerPath);
}

suite(
    'Chat Windows speech command',
    defineChatWindowsSpeechCommandTests
);
