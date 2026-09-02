import * as assert from 'assert';

import {
    ChatSpeechControlsMarkup
} from '../../sidebar/chatSpeechControlsMarkup';
import {
    ChatRunSettingsMarkup
} from '../../sidebar/chatRunSettingsMarkup';

/**
 * Verifies the Read voice selector is visible without expanding Run.
 */
function exposesReadVoiceSelector(): void {
    const speech = new ChatSpeechControlsMarkup().markup();
    const run = new ChatRunSettingsMarkup().markup();

    assert.ok(speech.includes('Read voice'));
    assert.ok(speech.includes('id="voice-input"'));
    assert.ok(!run.includes('id="voice-input"'));
}

/**
 * Registers visible Read voice selector tests.
 */
function defineChatSpeechControlsMarkupTests(): void {
    test(
        'exposes the Read voice selector',
        exposesReadVoiceSelector
    );
}

suite(
    'Chat speech controls markup',
    defineChatSpeechControlsMarkupTests
);
