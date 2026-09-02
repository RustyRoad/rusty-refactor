import * as assert from 'assert';

import { SubagentWorkflow } from '../../sidebar/subagentWorkflow';

/**
 * Verifies an explicit parent model is embedded in every spawn instruction.
 */
function inheritsExplicitParentModel(): void {
    const instruction = new SubagentWorkflow().instruction(
        'anthropic/claude-sonnet-4'
    );

    assert.match(
        instruction,
        /model to "anthropic\/claude-sonnet-4"/
    );
    assert.match(instruction, /exact model serving this supervising chat/);
    assert.doesNotMatch(instruction, /or omit the model/);
}

/**
 * Verifies automatic routing still requires the runtime's resolved model id.
 */
function requiresResolvedAutomaticModel(): void {
    const instruction = new SubagentWorkflow().instruction();

    assert.match(instruction, /exact resolved model identifier/);
    assert.match(instruction, /Never pass "automatic"/);
    assert.doesNotMatch(instruction, /or omit the model/);
}

/**
 * Verifies model text cannot escape or blur its prompt boundary.
 */
function quotesParentModelIdentifier(): void {
    const instruction = new SubagentWorkflow().instruction(
        'provider/model"variant'
    );

    assert.match(instruction, /provider\/model\\"variant/);
}

/**
 * Registers parent-model inheritance policy coverage.
 */
function registerSubagentWorkflowTests(): void {
    test(
        'inherits the explicit supervising model',
        inheritsExplicitParentModel
    );
    test(
        'requires the resolved automatic model',
        requiresResolvedAutomaticModel
    );
    test(
        'quotes the parent model identifier',
        quotesParentModelIdentifier
    );
}

suite('Sub-agent workflow', registerSubagentWorkflowTests);