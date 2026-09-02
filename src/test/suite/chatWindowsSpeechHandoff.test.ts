import * as assert from 'assert';
import { readFileSync } from 'fs';

import { extensionTestPath } from './extensionTestPath';

/**
 * Verifies Remote-SSH audio is transferred through the webview backend.
 */
function targetsLocalWebviewAudio(): void {
    const service = readFileSync(
        extensionTestPath('src', 'sidebar', 'chatSpeechService.ts'),
        'utf8'
    );
    const provider = readFileSync(
        extensionTestPath(
            'src',
            'sidebar',
            'CodetetherChatViewProvider.ts'
        ),
        'utf8'
    );

    assert.ok(service.includes('ChatWebviewSpeechBackend'));
    assert.ok(!service.includes('ChatWindowsTerminalSpeechBackend'));
    assert.ok(!provider.includes('usesClientSystemSpeech'));
}

/**
 * Registers Remote-SSH Windows speech handoff tests.
 */
function defineChatWindowsSpeechHandoffTests(): void {
    test(
        'targets local webview audio',
        targetsLocalWebviewAudio
    );
}

suite(
    'Chat Windows speech handoff',
    defineChatWindowsSpeechHandoffTests
);
