import * as assert from 'assert';

import { codetetherSessionTitle } from '../../codetetherSessionTitle';

/**
 * Verifies titles are compact, single-line descriptions of their prompt.
 */
function normalizesAndTruncatesTitles(): void {
    assert.strictEqual(
        codetetherSessionTitle('  Fix\n  the   parser  '),
        'Fix the parser'
    );
    assert.strictEqual(
        codetetherSessionTitle(''),
        'VS Code chat'
    );

    const title = codetetherSessionTitle('x'.repeat(100));
    assert.strictEqual(title.length, 56);
    assert.ok(title.endsWith('...'));
}

/**
 * Verifies distinct first prompts produce distinct session titles.
 */
function separatesChatTitles(): void {
    assert.notStrictEqual(
        codetetherSessionTitle('Investigate the realtime transport'),
        codetetherSessionTitle('Fix the Thinking panel flicker')
    );
}

/**
 * Registers persisted CodeTether session-title tests.
 */
function defineCodetetherSessionTitleTests(): void {
    test(
        'normalizes and truncates titles',
        normalizesAndTruncatesTitles
    );
    test('separates chat titles', separatesChatTitles);
}

suite(
    'Codetether session title',
    defineCodetetherSessionTitleTests
);