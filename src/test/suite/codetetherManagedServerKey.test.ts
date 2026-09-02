import * as assert from 'assert';

import { codetetherManagedServerKey } from
    '../../codetetherManagedServerKey';
import { defaultCodetetherModelOptions } from
    '../../codetetherModelOptions';

/**
 * Verifies concurrent model processes receive distinct manager identities.
 */
function separatesModelsAndOptions(): void {
    const baseline = defaultCodetetherModelOptions();
    const workspace = 'file:///workspace';
    const binary = '/usr/local/bin/codetether';
    const first = codetetherManagedServerKey(
        workspace,
        binary,
        'bedrock/model-a',
        baseline
    );

    assert.strictEqual(
        first,
        codetetherManagedServerKey(
            workspace,
            binary,
            'bedrock/model-a',
            { ...baseline }
        )
    );
    assert.notStrictEqual(
        first,
        codetetherManagedServerKey(
            workspace,
            binary,
            'bedrock/model-b',
            baseline
        )
    );
    assert.notStrictEqual(
        first,
        codetetherManagedServerKey(
            workspace,
            binary,
            'bedrock/model-a',
            { ...baseline, bedrockThinkingEffort: 'high' }
        )
    );
}

/**
 * Registers immutable managed-server identity tests.
 */
function defineCodetetherManagedServerKeyTests(): void {
    test(
        'separates concurrent models and runtime options',
        separatesModelsAndOptions
    );
}

suite(
    'Codetether managed server key',
    defineCodetetherManagedServerKeyTests
);