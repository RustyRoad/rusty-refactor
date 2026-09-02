import * as assert from 'assert';

import {
    availableCodetetherModel
} from '../../codetetherModelAvailability';

/**
 * Preserves an explicit model while current discovery still exposes it.
 */
function preservesAvailableModel(): void {
    assert.strictEqual(
        availableCodetetherModel(
            'bedrock/claude',
            ['bedrock/claude']
        ),
        'bedrock/claude'
    );
}

/**
 * Falls back to automatic routing when a cached provider disappeared.
 */
function rejectsStaleModel(): void {
    assert.strictEqual(
        availableCodetetherModel(
            'zai/glm-5',
            ['bedrock/claude']
        ),
        ''
    );
}

/**
 * Keeps automatic selection automatic for any provider snapshot.
 */
function preservesAutomaticSelection(): void {
    assert.strictEqual(
        availableCodetetherModel('', ['bedrock/claude']),
        ''
    );
}

/**
 * Registers live model selection policy regression tests.
 */
function defineCodetetherModelAvailabilityTests(): void {
    test('preserves a live explicit model', preservesAvailableModel);
    test('rejects a stale explicit model', rejectsStaleModel);
    test('preserves automatic routing', preservesAutomaticSelection);
}

suite(
    'Codetether model availability',
    defineCodetetherModelAvailabilityTests
);
