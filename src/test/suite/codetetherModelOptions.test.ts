import * as assert from 'assert';

import {
    applyCodetetherModelOptions,
    codetetherModelOptionsKey,
    normalizeCodetetherModelOptions
} from '../../codetetherModelOptions';

/**
 * Verifies invalid webview values fall back to Codetether defaults.
 */
function normalizesUnknownOptions(): void {
    const options = normalizeCodetetherModelOptions({
        bedrockThinkingEffort: 'ultra',
        codexThinkingEffort: 'high'
    });

    assert.strictEqual(options.bedrockThinkingEffort, 'medium');
    assert.strictEqual(options.bedrockServiceTier, 'default');
    assert.strictEqual(options.codexThinkingEffort, 'high');
    assert.strictEqual(options.openRouterThinkingEffort, 'default');
}

/**
 * Verifies Bedrock receives thinking and non-default service tier options.
 */
function appliesBedrockOptions(): void {
    const environment = applyCodetetherModelOptions(
        {
            CODETETHER_OPENAI_CODEX_THINKING_LEVEL: 'xhigh'
        },
        'bedrock/us.anthropic.claude-opus-4-7',
        normalizeCodetetherModelOptions({
            bedrockThinkingEffort: 'high',
            bedrockServiceTier: 'priority'
        })
    );

    assert.strictEqual(
        environment.CODETETHER_BEDROCK_THINKING_EFFORT,
        'high'
    );
    assert.strictEqual(
        environment.CODETETHER_BEDROCK_SERVICE_TIER,
        'priority'
    );
    assert.strictEqual(
        environment.CODETETHER_OPENAI_CODEX_THINKING_LEVEL,
        undefined
    );
}

/**
 * Verifies Codex and OpenRouter use their distinct runtime variables.
 */
function appliesProviderEffortOptions(): void {
    const options = normalizeCodetetherModelOptions({
        codexThinkingEffort: 'max',
        openRouterThinkingEffort: 'minimal'
    });
    const codex = applyCodetetherModelOptions(
        {},
        'openai-codex/gpt-5.6-sol',
        options
    );
    const openRouter = applyCodetetherModelOptions(
        {},
        'openrouter/openai/gpt-5.5',
        options
    );

    assert.strictEqual(
        codex.CODETETHER_OPENAI_CODEX_THINKING_LEVEL,
        'max'
    );
    assert.strictEqual(
        openRouter.CODETETHER_OPENROUTER_REASONING_EFFORT,
        'minimal'
    );
}

/**
 * Verifies process reuse changes only for effective provider options.
 */
function comparesEffectiveRuntimeOptions(): void {
    const baseline = normalizeCodetetherModelOptions({
        codexThinkingEffort: 'low'
    });
    const unrelated = normalizeCodetetherModelOptions({
        codexThinkingEffort: 'low',
        bedrockThinkingEffort: 'high'
    });
    const changed = normalizeCodetetherModelOptions({
        codexThinkingEffort: 'high'
    });
    const model = 'openai-codex/gpt-5.6-sol';

    assert.strictEqual(
        codetetherModelOptionsKey(model, baseline),
        codetetherModelOptionsKey(model, unrelated)
    );
    assert.notStrictEqual(
        codetetherModelOptionsKey(model, baseline),
        codetetherModelOptionsKey(model, changed)
    );
}

/**
 * Registers focused runtime-option tests with Mocha's TDD interface.
 */
function defineCodetetherModelOptionTests(): void {
    test('normalizes unknown choices', normalizesUnknownOptions);
    test('applies Bedrock runtime choices', appliesBedrockOptions);
    test('applies provider effort choices', appliesProviderEffortOptions);
    test('compares effective runtime choices', comparesEffectiveRuntimeOptions);
}

suite('Codetether model options', defineCodetetherModelOptionTests);
