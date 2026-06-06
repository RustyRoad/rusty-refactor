import * as vscode from 'vscode';

import { CodetetherClient } from '../codetetherClient';
import { logToOutput } from '../extractor';
import { MODEL_SLOW_STATUS_MS } from './chatConstants';
import { ModelListPayload } from './chatTypes';

/**
 * Sends model-listing updates while keeping stale async results isolated.
 */
export class ModelListService {
    private requestId = 0;

    public constructor(private readonly client: CodetetherClient) {}

    /**
     * Refreshes the model list and streams progress to the view.
     *
     * Models are sourced exclusively from the Codetether CLI's `models`
     * endpoint via {@link CodetetherClient.listModels}. The configured
     * default model is reported alongside the discovered list so the
     * webview can surface it as the dropdown's automatic choice, but no
     * built-in defaults are seeded before the CLI responds.
     */
    public async sendModelsList(
        view: vscode.WebviewView | undefined
    ): Promise<void> {
        if (!view) {
            return;
        }

        const requestId = ++this.requestId;
        const configuredModel = this.getConfiguredModel();
        const initialModels = this.optionalModelGroup(configuredModel);

        this.postModels(view, requestId, {
            models: initialModels,
            configuredModel,
            status: 'Discovering Codetether models…'
        });
        logToOutput('[Codetether Chat] Starting model discovery.');

        await this.discoverModels(view, requestId, configuredModel,
            initialModels);
    }

    /**
     * Saves the configured default model and refreshes client configuration.
     */
    public async setDefaultModel(model: string): Promise<void> {
        const config = vscode.workspace.getConfiguration('rustyRefactor');

        await config.update(
            'codetetherModel',
            model,
            vscode.ConfigurationTarget.Global
        );
        this.client.refreshConfig();
    }

    /**
     * Combines model groups with trimming, de-duplication, and sorting.
     */
    public mergeModels(...groups: string[][]): string[] {
        return [...new Set(
            groups.flat()
                .map(model => model.trim())
                .filter(Boolean)
        )].sort();
    }

    /**
     * Loads discovered models with slow-load status handling.
     *
     * Once the CLI responds, the configured default is prepended to the
     * list (when not already present) so it remains selectable as the
     * automatic choice in the webview.
     */
    private async discoverModels(
        view: vscode.WebviewView,
        requestId: number,
        configuredModel: string,
        initialModels: string[]
    ): Promise<void> {
        let slowTimer: NodeJS.Timeout | undefined;

        try {
            slowTimer = setTimeout(() => {
                this.postStatus(view, requestId, [
                    'Still loading Codetether models…',
                    'you can use a listed or custom model now.'
                ].join(' '));
            }, MODEL_SLOW_STATUS_MS);

            const models = await this.client.listModels();
            this.clearTimer(slowTimer);

            if (!this.isCurrent(requestId)) {
                return;
            }

            const mergedModels = this.mergeModels(
                this.optionalModelGroup(configuredModel),
                models,
                initialModels
            );
            logToOutput([
                '[Codetether Chat] Model discovery completed:',
                `${models.length} discovered,`,
                `${mergedModels.length} shown.`
            ].join(' '));
            this.postModels(view, requestId, {
                models: mergedModels,
                configuredModel
            });
        } catch (err) {
            this.clearTimer(slowTimer);
            this.handleDiscoveryError(view, requestId, configuredModel,
                initialModels, err);
        }
    }

    /**
     * Sends a usable model list after discovery fails.
     */
    private handleDiscoveryError(
        view: vscode.WebviewView,
        requestId: number,
        configuredModel: string,
        initialModels: string[],
        err: unknown
    ): void {
        if (!this.isCurrent(requestId)) {
            return;
        }

        const message = err instanceof Error
            ? err.message
            : 'Failed to load models.';
        logToOutput(`[Codetether Chat] Model discovery failed: ${message}`);
        this.postModels(view, requestId, {
            models: initialModels,
            configuredModel,
            status: `${message} The Codetether CLI did not return any models.`
        });
    }

    /**
     * Reads the configured default Codetether model from workspace settings.
     */
    private getConfiguredModel(): string {
        const config = vscode.workspace.getConfiguration('rustyRefactor');

        return config.get<string>('codetetherModel') || '';
    }

    /**
     * Wraps a configured model as a list only when it has content.
     */
    private optionalModelGroup(model: string): string[] {
        return model ? [model] : [];
    }

    /**
     * Sends model results only for the latest model-listing request.
     */
    private postModels(
        view: vscode.WebviewView,
        requestId: number,
        payload: ModelListPayload
    ): void {
        if (!this.isCurrent(requestId)) {
            return;
        }

        view.webview.postMessage({
            type: 'modelsListed',
            models: payload.models,
            configuredModel: payload.configuredModel,
            status: payload.status
        });
    }

    /**
     * Sends model-loading status only for the latest listing request.
     */
    private postStatus(
        view: vscode.WebviewView,
        requestId: number,
        status: string
    ): void {
        if (!this.isCurrent(requestId)) {
            return;
        }

        view.webview.postMessage({ type: 'modelStatus', status });
    }

    /**
     * Checks whether an async discovery result still belongs to the view.
     */
    private isCurrent(requestId: number): boolean {
        return requestId === this.requestId;
    }

    /**
     * Clears an optional timer created for slow discovery status.
     */
    private clearTimer(timer: NodeJS.Timeout | undefined): void {
        if (timer) {
            clearTimeout(timer);
        }
    }
}
