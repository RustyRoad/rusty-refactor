import { ChatMode, CodetetherFeature } from './chatTypes';

/**
 * Defines the assistant identity kept at the start of every chat session.
 */
export const CHAT_SYSTEM_PROMPT = [
    'You are Codetether, a helpful programming assistant.',
    'Provide concise markdown.'
].join(' ');

/**
 * Sets how long model discovery can run before showing a slow-load hint.
 */
export const MODEL_SLOW_STATUS_MS = 6000;

/**
 * Limits active-editor context so webview requests remain responsive.
 */
export const WORKSPACE_CONTEXT_LIMIT = 12000;

/**
 * Lists built-in fallback models that remain available without discovery.
 */
export const BUILT_IN_MODELS = ['zai/glm-5', 'zai/glm-5.1'];

/**
 * Enumerates accepted chat modes for validation and webview controls.
 */
export const CHAT_MODES: ChatMode[] = [
    'chat',
    'agent',
    'orchestrate',
    'plan',
    'review'
];

/**
 * Enumerates accepted feature presets for validation and webview controls.
 */
export const CODETETHER_FEATURES: CodetetherFeature[] = [
    'auto',
    'code',
    'debug',
    'refactor',
    'search',
    'test',
    'git',
    'browser',
    'swarm',
    'prd'
];
