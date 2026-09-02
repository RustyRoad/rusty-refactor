import * as assert from 'assert';

import {
    ChatSpeechTextPreparer
} from '../../sidebar/chatSpeechTextPreparer';

/**
 * Creates the deterministic Markdown speech preparer under test.
 */
function preparer(): ChatSpeechTextPreparer {
    return new ChatSpeechTextPreparer();
}

/**
 * Verifies outcome prose remains while inventory and validation lists go.
 */
function skipsStructuredLists(): void {
    const markdown = [
        'Outcome: `performance.rs` has been refactored.',
        '',
        'What changed:',
        '- Removed handwritten SQL.',
        '- Split the controller into modules.',
        '',
        'Validation:',
        '- Static checks passed.',
        '- Cargo was not run.'
    ].join('\n');

    assert.strictEqual(
        preparer().prepare(markdown),
        'Outcome: performance.rs has been refactored.'
    );
}

/**
 * Verifies links retain their readable labels without speaking URLs.
 */
function cleansNarrativeMarkdown(): void {
    const markdown = [
        'See **the report** at',
        '[this page](https://example.com/report).'
    ].join(' ');
    assert.strictEqual(
        preparer().prepare(markdown),
        'See the report at this page.'
    );
}

/**
 * Verifies code fences are not rendered as speech.
 */
function skipsFencedCode(): void {
    const markdown = [
        'The change is ready.',
        '',
        '```rust',
        'fn hidden() {}',
        '```'
    ].join('\n');
    assert.strictEqual(
        preparer().prepare(markdown),
        'The change is ready.'
    );
}

/**
 * Verifies a structured-only response still produces useful feedback.
 */
function announcesStructuredOnlyResponse(): void {
    assert.strictEqual(
        preparer().prepare('- One\n- Two'),
        'This response contains structured details. Review them on screen.'
    );
}

/**
 * Verifies streamed list fragments are silent instead of repeating notices.
 */
function silentlySkipsStructuredFragment(): void {
    assert.strictEqual(
        preparer().prepareFragment('- One completed validation item.'),
        ''
    );
}

/**
 * Registers smart Markdown speech preparation tests.
 */
function defineChatSpeechTextPreparerTests(): void {
    test('skips structured lists', skipsStructuredLists);
    test('cleans narrative Markdown', cleansNarrativeMarkdown);
    test('skips fenced code', skipsFencedCode);
    test('announces structured-only responses',
        announcesStructuredOnlyResponse);
    test('silently skips streamed structure',
        silentlySkipsStructuredFragment);
}

suite(
    'Chat speech text preparer',
    defineChatSpeechTextPreparerTests
);
