/**
 * Normalizes model-runtime options shared by webview and process transports.
 */

export type BedrockThinkingEffort = 'low' | 'medium' | 'high';

export type BedrockServiceTier =
    | 'default'
    | 'standard'
    | 'priority';

export type CodexThinkingEffort =
    | 'default'
    | 'none'
    | 'low'
    | 'medium'
    | 'high'
    | 'xhigh'
    | 'max';

export type OpenRouterThinkingEffort =
    | CodexThinkingEffort
    | 'minimal';

/**
 * Stores independent provider choices so switching models preserves intent.
 */
export interface CodetetherModelOptions {
    bedrockThinkingEffort: BedrockThinkingEffort;
    bedrockServiceTier: BedrockServiceTier;
    codexThinkingEffort: CodexThinkingEffort;
    openRouterThinkingEffort: OpenRouterThinkingEffort;
}

const BEDROCK_THINKING_EFFORTS = [
    'low',
    'medium',
    'high'
] as const;
const BEDROCK_SERVICE_TIERS = [
    'default',
    'standard',
    'priority'
] as const;
const CODEX_THINKING_EFFORTS = [
    'default',
    'none',
    'low',
    'medium',
    'high',
    'xhigh',
    'max'
] as const;
const OPENROUTER_THINKING_EFFORTS = [
    'default',
    'none',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'max'
] as const;
const OPTION_ENVIRONMENT_KEYS = [
    'CODETETHER_BEDROCK_THINKING_EFFORT',
    'CODETETHER_BEDROCK_SERVICE_TIER',
    'CODETETHER_OPENAI_CODEX_THINKING_LEVEL',
    'CODETETHER_OPENAI_CODEX_REASONING_EFFORT',
    'CODETETHER_OPENROUTER_REASONING_EFFORT',
    'CODETETHER_OPENROUTER_THINKING_LEVEL'
];

/**
 * Returns Codetether's provider defaults for a fresh sidebar session.
 */
export function defaultCodetetherModelOptions(): CodetetherModelOptions {
    return {
        bedrockThinkingEffort: 'medium',
        bedrockServiceTier: 'default',
        codexThinkingEffort: 'default',
        openRouterThinkingEffort: 'default'
    };
}

/**
 * Validates persisted or webview-provided values against known choices.
 */
export function normalizeCodetetherModelOptions(
    value: unknown
): CodetetherModelOptions {
    const defaults = defaultCodetetherModelOptions();
    const candidate = isRecord(value) ? value : {};

    return {
        bedrockThinkingEffort: choice(
            candidate.bedrockThinkingEffort,
            BEDROCK_THINKING_EFFORTS,
            defaults.bedrockThinkingEffort
        ),
        bedrockServiceTier: choice(
            candidate.bedrockServiceTier,
            BEDROCK_SERVICE_TIERS,
            defaults.bedrockServiceTier
        ),
        codexThinkingEffort: choice(
            candidate.codexThinkingEffort,
            CODEX_THINKING_EFFORTS,
            defaults.codexThinkingEffort
        ),
        openRouterThinkingEffort: choice(
            candidate.openRouterThinkingEffort,
            OPENROUTER_THINKING_EFFORTS,
            defaults.openRouterThinkingEffort
        )
    };
}

/**
 * Adds only the selected model provider's runtime variables.
 *
 * Existing option variables are removed first so an ambient shell setting
 * cannot override the explicit sidebar selection.
 */
export function applyCodetetherModelOptions(
    baseEnvironment: NodeJS.ProcessEnv,
    model: string,
    value?: CodetetherModelOptions
): NodeJS.ProcessEnv {
    const environment = withoutOptionEnvironment(baseEnvironment);
    const options = normalizeCodetetherModelOptions(value);
    const provider = modelProvider(model);

    if (provider === 'bedrock') {
        environment.CODETETHER_BEDROCK_THINKING_EFFORT =
            options.bedrockThinkingEffort;
        if (options.bedrockServiceTier !== 'default') {
            environment.CODETETHER_BEDROCK_SERVICE_TIER =
                options.bedrockServiceTier;
        }
    } else if (provider === 'openai-codex') {
        if (options.codexThinkingEffort !== 'default') {
            environment.CODETETHER_OPENAI_CODEX_THINKING_LEVEL =
                options.codexThinkingEffort;
        }
    } else if (provider === 'openrouter') {
        if (options.openRouterThinkingEffort !== 'default') {
            environment.CODETETHER_OPENROUTER_REASONING_EFFORT =
                options.openRouterThinkingEffort;
        }
    }

    return environment;
}

/**
 * Creates a stable comparison key for managed-process reuse decisions.
 */
export function codetetherModelOptionsKey(
    model: string,
    value?: CodetetherModelOptions
): string {
    const environment = applyCodetetherModelOptions({}, model, value);
    return JSON.stringify(environment);
}

/**
 * Removes known runtime overrides while preserving unrelated variables.
 */
function withoutOptionEnvironment(
    baseEnvironment: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
    const environment = { ...baseEnvironment };
    for (const key of OPTION_ENVIRONMENT_KEYS) {
        delete environment[key];
    }
    return environment;
}

/**
 * Extracts the provider prefix from an opaque model identifier.
 */
function modelProvider(model: string): string {
    const slash = model.indexOf('/');
    return slash > 0 ? model.slice(0, slash).toLowerCase() : '';
}

/**
 * Narrows unknown input to a key-value object without trusting its fields.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object';
}

/**
 * Returns a supported string choice or its provider-specific fallback.
 */
function choice<T extends string>(
    value: unknown,
    choices: readonly T[],
    fallback: T
): T {
    return typeof value === 'string' && choices.includes(value as T)
        ? value as T
        : fallback;
}
