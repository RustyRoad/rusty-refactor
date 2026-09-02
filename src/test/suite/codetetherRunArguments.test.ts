import * as assert from 'assert';

import {
    buildCodetetherRunArguments
} from '../../codetetherRunArguments';

/**
 * Verifies regular chat retains explicit last-session continuation.
 */
function buildsContinuingRun(): void {
    const args = buildCodetetherRunArguments({
        model: 'provider/model',
        prompt: 'Continue this chat.',
        sessionMode: 'continue'
    });

    assert.deepStrictEqual(args, [
        'run',
        '--print-logs',
        '-c',
        '--model',
        'provider/model',
        '--format',
        'json',
        'Continue this chat.'
    ]);
}

/**
 * Verifies isolated processes cannot select the latest workspace session.
 */
function buildsIsolatedRun(): void {
    const args = buildCodetetherRunArguments({
        model: 'provider/model',
        prompt: 'Fix this diagnostic.',
        sessionMode: 'isolated'
    });

    assert.deepStrictEqual(args, [
        'run',
        '--print-logs',
        '--model',
        'provider/model',
        '--format',
        'json',
        'Fix this diagnostic.'
    ]);
    assert.ok(!args.includes('-c'));
    assert.ok(!args.includes('--continue-session'));
    assert.ok(!args.includes('--session'));
}

/**
 * Registers CLI argument tests with Mocha's TDD interface.
 */
function defineCodetetherRunArgumentTests(): void {
    test('builds a continuing run', buildsContinuingRun);
    test('builds an isolated run', buildsIsolatedRun);
}

suite('Codetether run arguments', defineCodetetherRunArgumentTests);
