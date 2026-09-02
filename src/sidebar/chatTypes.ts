import { ChatMessage } from '../codetetherClient';
import { CodetetherModelOptions } from '../codetetherModelOptions';

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
    modelOptions: CodetetherModelOptions;
    mode?: ChatMode;
    feature?: CodetetherFeature;
    includeContext: boolean;
    autoSpeak?: boolean;
}

/**
 * Describes one model choice shown by the chat webview.
 *
 * The opaque ID is sent back to CodeTether. The name and provider exist only
 * to give the selector a stable, human-readable label.
 */
export interface SidebarModelOption {
    id: string;
    name: string;
    provider: string;
}

/**
 * Captures the dependencies needed to build a model-listing message.
 */
export interface ModelListPayload {
    models: SidebarModelOption[];
    configuredModel: string;
    status?: string;
    discoveryTelemetry?: Record<string, unknown>;
}

/**
 * Allows the provider to keep transport-specific chat history private.
 */
export type ChatHistory = ChatMessage[];
