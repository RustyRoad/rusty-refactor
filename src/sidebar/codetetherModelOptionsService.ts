/**
 * Persists provider-specific model runtime choices for the chat sidebar.
 */

import * as vscode from 'vscode';

import {
    CodetetherModelOptions,
    normalizeCodetetherModelOptions
} from '../codetetherModelOptions';

const MODEL_OPTIONS_STATE_KEY = 'codetether.modelOptions';

/**
 * Owns validation and workspace-independent persistence for model options.
 */
export class CodetetherModelOptionsService {
    private options: CodetetherModelOptions;

    /**
     * Loads persisted choices while replacing stale values with defaults.
     */
    public constructor(private readonly state: vscode.Memento) {
        this.options = normalizeCodetetherModelOptions(
            state.get<unknown>(MODEL_OPTIONS_STATE_KEY)
        );
    }

    /**
     * Returns a detached snapshot safe to send across the webview boundary.
     */
    public current(): CodetetherModelOptions {
        return { ...this.options };
    }

    /**
     * Validates and persists a complete provider-option snapshot.
     */
    public async update(value: unknown): Promise<CodetetherModelOptions> {
        this.options = normalizeCodetetherModelOptions(value);
        await this.state.update(MODEL_OPTIONS_STATE_KEY, this.options);
        return this.current();
    }
}
