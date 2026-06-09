import * as vscode from 'vscode';

import { CodetetherClient } from '../codetetherClient';
import {
    CodeTetherApiError,
    CodeTetherDiscoveryTelemetry
} from '../codeTetherApiClient';
import { logToOutput } from '../extractor';
import { MODEL_SLOW_STATUS_MS } from './chatConstants';
import { ModelListPayload } from './chatTypes';

interface SidebarModelDiscovery {
    models: string[];
    status?: string;
    telemetry: CodeTetherDiscoveryTelemetry;
}

/**
 * Sends model-listing updates while keeping stale async results isolated.
 */
export class ModelListService {
    private requestId = 0;

    public constructor(private readonly client: CodetetherClient) {}

    /**
     * Refreshes the model list and streams progress to the view.
     *
     * Models are sourced from CodeTether's server-side HTTP model endpoint.
     * VS Code language models remain a fallback when CodeTether is not
     * configured or the HTTP endpoint is unavailable.
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
            status: 'Discovering CodeTether models...'
        });
        logToOutput('[Codetether Chat] Starting model discovery.');

        await this.discoverModels(
            view,
            requestId,
            configuredModel,
            initialModels,
        );
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
     * Once discovery responds, the configured default is prepended to the
     * list when not already present so it remains selectable as automatic.
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
                    'Still loading CodeTether models...',
                    'you can use a listed or custom model now.'
                ].join(' '));
            }, MODEL_SLOW_STATUS_MS);

            const discovery = await this.discoverModelIds();
            this.clearTimer(slowTimer);

            if (!this.isCurrent(requestId)) {
                return;
            }

            const models = discovery.telemetry.fallbackUsed
                ? this.mergeModels(
                    this.optionalModelGroup(configuredModel),
                    discovery.models,
                    initialModels
                )
                : discovery.models;
            const telemetry = {
                ...discovery.telemetry,
                shownModelCount: models.length,
                providerCounts: this.providerCounts(models)
            };
            this.logDiscoveryTelemetry(telemetry);
            logToOutput([
                '[Codetether Chat] Model discovery completed:',
                `${discovery.models.length} discovered,`,
                `${models.length} shown.`
            ].join(' '));
            this.postModels(view, requestId, {
                models,
                configuredModel,
                status: discovery.status,
                discoveryTelemetry: telemetry
            });
        } catch (err) {
            this.clearTimer(slowTimer);
            this.handleDiscoveryError(
                view,
                requestId,
                configuredModel,
                initialModels,
                err,
            );
        }
    }

    /**
     * Discovers CodeTether model IDs and falls back to VS Code LM IDs.
     */
    private async discoverModelIds(): Promise<SidebarModelDiscovery> {
        try {
            const discovery = await this.client.discoverModelPickerItems();
            const models = discovery.items.map(item => item.modelId);

            return {
                models,
                telemetry: {
                    ...discovery.telemetry,
                    shownModelCount: models.length,
                    providerCounts: this.providerCounts(models)
                }
            };
        } catch (error) {
            this.showCodeTetherFailure(error);
            const fallbackModels = await this.listVSCodeModelIds();
            return {
                models: fallbackModels,
                status: this.fallbackStatus(error),
                telemetry: {
                    discoverySource: 'vscode-lm',
                    serverUrl: this.safeServerUrlHint(),
                    httpStatus: this.errorStatus(error),
                    rawModelCount: fallbackModels.length,
                    shownModelCount: fallbackModels.length,
                    providerCounts: this.providerCounts(fallbackModels),
                    fallbackUsed: true
                }
            };
        }
    }

    /**
     * Lists VS Code language model ids as provider/family strings.
     */
    private async listVSCodeModelIds(): Promise<string[]> {
        try {
            const models = await vscode.lm.selectChatModels();
            return models.map(model => `${model.vendor}/${model.family}`);
        } catch (error) {
            const message = error instanceof Error
                ? error.message
                : String(error);
            logToOutput(
                `[Codetether Chat] VS Code fallback model` +
                ` discovery failed: ${message}`
            );
            return [];
        }
    }

    /**
     * Counts model IDs by provider prefix without renaming providers.
     */
    private providerCounts(models: string[]): Record<string, number> {
        return models.reduce<Record<string, number>>((counts, model) => {
            const provider = model.split('/')[0] || 'other';
            counts[provider] = (counts[provider] || 0) + 1;
            return counts;
        }, {});
    }

    /**
     * Emits structured discovery telemetry to the extension output log.
     */
    private logDiscoveryTelemetry(
        telemetry: Record<string, unknown>
    ): void {
        logToOutput(
            '[Codetether Chat] Model discovery telemetry: ' +
            JSON.stringify(telemetry)
        );
    }

    /**
     * Builds a token-free status message for fallback discovery.
     */
    private fallbackStatus(error: unknown): string {
        if (error instanceof CodeTetherApiError) {
            if (error.kind === 'auth') {
                return 'CodeTether token missing/wrong; using VS Code models.';
            }
            if (error.kind === 'policy') {
                return [
                    'CodeTether policy denied agent:read;',
                    'using VS Code models.'
                ].join(' ');
            }
            if (error.kind === 'network' || error.kind === 'timeout') {
                return 'CodeTether server unavailable; using VS Code models.';
            }
        }

        return 'CodeTether discovery failed; using VS Code models.';
    }

    /**
     * Shows the actionable CodeTether discovery failure once per refresh.
     */
    private showCodeTetherFailure(error: unknown): void {
        if (!(error instanceof CodeTetherApiError)) {
            return;
        }

        if (error.kind === 'auth') {
            vscode.window.showWarningMessage(
                'CodeTether token missing/wrong. Configure CODETETHER_TOKEN.'
            );
        } else if (error.kind === 'policy') {
            vscode.window.showWarningMessage(
                'CodeTether policy denied agent:read. Check OPA permissions.'
            );
        }
    }

    /**
     * Returns a non-secret server URL hint for discovery telemetry.
     */
    private safeServerUrlHint(): string {
        const config = vscode.workspace.getConfiguration('rustyRefactor');

        const rawUrl = config.get<string>('codeTether.serverUrl') ||
            process.env.CODETETHER_SERVER ||
            config.get<string>('codetetherServer') ||
            config.get<string>('codetetherA2AServerUrl') ||
            '';

        try {
            const parsed = new URL(rawUrl);
            return parsed.origin + parsed.pathname.replace(/\/$/, '');
        } catch {
            return rawUrl.split('?')[0].replace(/\/$/, '');
        }
    }

    /**
     * Returns HTTP status or error kind for discovery telemetry.
     */
    private errorStatus(error: unknown): number | string {
        if (error instanceof CodeTetherApiError) {
            return error.statusCode ?? error.kind;
        }

        return 'unknown';
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
            status: `${message} Falling back to configured/custom models.`
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
            status: payload.status,
            discoveryTelemetry: payload.discoveryTelemetry
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
