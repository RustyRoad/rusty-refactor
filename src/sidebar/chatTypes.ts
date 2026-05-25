import { ChatMessage } from '../codetetherClient';

/**
 * Names the interaction style requested from Codetether for a message.
 */
export type ChatMode =
    | 'chat'
    | 'agent'
    | 'orchestrate'
    | 'plan'
    | 'review';

/**
 * Names the tool preset requested from Codetether for a message.
 */
export type CodetetherFeature =
    | 'auto'
    | 'code'
    | 'debug'
    | 'refactor'
    | 'search'
    | 'test'
    | 'git'
    | 'browser'
    | 'swarm'
    | 'prd';

/**
 * Describes the user payload sent from the chat webview.
 */
export interface UserMessageRequest {
    text: string;
    model?: string;
    mode?: ChatMode;
    feature?: CodetetherFeature;
    includeContext: boolean;
    autoSpeak?: boolean;
}

/**
 * Captures the dependencies needed to build a model-listing message.
 */
export interface ModelListPayload {
    models: string[];
    configuredModel: string;
    status?: string;
}

/**
 * Allows the provider to keep transport-specific chat history private.
 */
export type ChatHistory = ChatMessage[];
