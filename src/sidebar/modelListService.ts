import * as vscode from 'vscode';

import { CodetetherModelDiscovery } from '../codetetherClient';
import {
    CodeTetherApiError,
    CodeTetherDiscoveryTelemetry
} from '../codeTetherApiClient';
import { logToOutput } from '../extractor';
import { MODEL_SLOW_STATUS_MS } from './chatConstants';
import {
    ModelListPayload,
    SidebarModelOption
} from './chatTypes';
import { SidebarModelRevalidator } from './sidebarModelRevalidator';

interface SidebarModelDiscovery {
    models: SidebarModelOption[];
    status?: string;
    telemetry: CodeTetherDiscoveryTelemetry;
}

/**
 * Narrows model discovery to the operations required by the sidebar.
 */
export interface SidebarModelDiscoveryClient {
    /**
     * Reads the latest selector entries from the current Codetether endpoint.
     */
    discoverModelPickerItems(): Promise<CodetetherModelDiscovery>;

    /**
     * Reloads settings used when discovery starts a managed endpoint.
     */
    refreshConfig(): void;
}

/**
 * Sends model-listing updates while keeping stale async results isolated.
 */
export class ModelListService {
    private requestId = 0;
    private readonly modelRevalidator =
        new SidebarModelRevalidator<SidebarModelDiscovery>();

    public constructor(
        private readonly client: SidebarModelDiscoveryClient
    ) {}

    /**
     * Refreshes the model list and streams progress to the view.
     *
     * Models are sourced from CodeTether's server-side HTTP model endpoint.
     * Discovery errors are surfaced instead of switching providers so users
     * can fix the configured CodeTether path directly.
     */
    public async sendModelsList(
        view: vscode.Webview | undefined
    ): Promise<void> {
        if (!view) {
            return;
        }

        const requestId = ++this.requestId;
        this.client.refreshConfig();
        const configuredModel = this.getConfiguredModel();
        const initialModels = this.mergeModels(
            this.optionalModelGroup(configuredModel),
            this.modelRevalidator.current()
        );

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
    public mergeModels(
        ...groups: SidebarModelOption[][]
    ): SidebarModelOption[] {
        const modelsById = new Map<string, SidebarModelOption>();

        for (const model of groups.flat()) {
            const normalized = this.normalizeModel(model);
            if (normalized) {
                modelsById.set(normalized.id, normalized);
            }
        }

        return [...modelsById.values()].sort((left, right) => {
            return this.compareModels(left, right);
        });
    }

    /**
     * Loads discovered models with slow-load status handling.
     *
     * Once discovery responds, the configured default is prepended to the
     * list when not already present so it remains selectable as automatic.
     */
    private async discoverModels(
        view: vscode.Webview,
        requestId: number,
        configuredModel: string,
        initialModels: SidebarModelOption[]
    ): Promise<void> {
        let slowTimer: NodeJS.Timeout | undefined;

        try {
            slowTimer = setTimeout(() => {
                this.postStatus(view, requestId, [
                    'Still loading CodeTether models...',
                    'you can use a listed or custom model now.'
                ].join(' '));
            }, MODEL_SLOW_STATUS_MS);

            const discovery = await this.modelRevalidator.refresh(() => {
                return this.discoverModelIds();
            });
            this.clearTimer(slowTimer);

            if (!this.isCurrent(requestId)) {
                return;
            }

            const models = this.mergeModels(discovery.models);
            const effectiveConfiguredModel =
                this.availableConfiguredModel(configuredModel, models);
            if (configuredModel && !effectiveConfiguredModel) {
                await this.setDefaultModel('');
                logToOutput(
                    '[Codetether Chat] Cleared configured model missing '
                    + 'from live discovery.'
                );
            }
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
                configuredModel: effectiveConfiguredModel,
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
     * Discovers selector-ready CodeTether models from the configured endpoint.
     */
    private async discoverModelIds(): Promise<SidebarModelDiscovery> {
        const discovery = await this.client.discoverModelPickerItems();
        const models = discovery.items.map(item => ({
            id: item.modelId,
            name: item.label,
            provider: item.provider
        }));

        return {
            models,
            telemetry: {
                ...discovery.telemetry,
                shownModelCount: models.length,
                providerCounts: this.providerCounts(models)
            }
        };
    }

    /**
     * Counts selector models by their explicit provider field.
     */
    private providerCounts(
        models: SidebarModelOption[]
    ): Record<string, number> {
        return models.reduce<Record<string, number>>((counts, model) => {
            const provider = model.provider || 'other';
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
     * Shows the actionable CodeTether discovery failure once per refresh.
     */
    private showCodeTetherFailure(error: unknown): void {
        if (!(error instanceof CodeTetherApiError)) {
            return;
        }

        if (error.kind === 'auth') {
            vscode.window.showWarningMessage(
                'CodeTether rejected the model-discovery token. Reload the '
                + 'window to restart the managed server, or check '
                + 'CODETETHER_TOKEN if you point at your own server.'
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
     * Sends explicit model choices after CodeTether discovery fails.
     */
    private handleDiscoveryError(
        view: vscode.Webview,
        requestId: number,
        configuredModel: string,
        initialModels: SidebarModelOption[],
        err: unknown
    ): void {
        if (!this.isCurrent(requestId)) {
            return;
        }

        const message = err instanceof Error
            ? err.message
            : 'Failed to load models.';
        this.showCodeTetherFailure(err);
        logToOutput(`[Codetether Chat] Model discovery failed: ${message}`);
        this.postModels(view, requestId, {
            models: initialModels,
            configuredModel,
            status: this.discoveryFailureStatus(err),
            discoveryTelemetry: {
                discoverySource: 'codetether-api',
                serverUrl: this.safeServerUrlHint(),
                httpStatus: this.errorStatus(err),
                rawModelCount: 0,
                shownModelCount: initialModels.length,
                providerCounts: this.providerCounts(initialModels),
                fallbackUsed: false
            }
        });
    }

    /**
     * Builds a token-free status for a failed CodeTether model refresh.
     */
    private discoveryFailureStatus(error: unknown): string {
        if (error instanceof CodeTetherApiError) {
            if (error.kind === 'auth') {
                return 'CodeTether rejected the discovery token; '
                    + 'reload window.';
            }
            if (error.kind === 'policy') {
                return 'CodeTether policy denied agent:read.';
            }
            if (error.kind === 'network' || error.kind === 'timeout') {
                return 'CodeTether server unavailable.';
            }
        }

        const message = error instanceof Error
            ? error.message
            : 'CodeTether discovery failed.';

        return message;
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
    private optionalModelGroup(model: string): SidebarModelOption[] {
        if (!model) {
            return [];
        }

        return [{
            id: model,
            name: this.nameFromId(model),
            provider: this.providerFromId(model)
        }];
    }

    /**
     * Keeps a configured default only while live discovery still exposes it.
     */
    private availableConfiguredModel(
        configuredModel: string,
        models: SidebarModelOption[]
    ): string {
        return models.some(model => model.id === configuredModel)
            ? configuredModel
            : '';
    }

    /**
     * Trims a model option and rejects entries without an opaque ID.
     */
    private normalizeModel(
        model: SidebarModelOption
    ): SidebarModelOption | undefined {
        const id = model.id.trim();
        if (!id) {
            return undefined;
        }

        return {
            id,
            name: model.name.trim() || this.nameFromId(id),
            provider: model.provider.trim() || this.providerFromId(id)
        };
    }

    /**
     * Sorts models by provider, display name, and then opaque ID.
     */
    private compareModels(
        left: SidebarModelOption,
        right: SidebarModelOption
    ): number {
        const providerOrder = left.provider.localeCompare(right.provider);
        if (providerOrder !== 0) {
            return providerOrder;
        }

        const nameOrder = left.name.localeCompare(right.name);
        return nameOrder !== 0 ? nameOrder : left.id.localeCompare(right.id);
    }

    /**
     * Derives a readable model name for a configured legacy model ID.
     */
    private nameFromId(model: string): string {
        const slash = model.indexOf('/');
        return slash >= 0 ? model.slice(slash + 1) : model;
    }

    /**
     * Derives a provider for a configured provider/model identifier.
     */
    private providerFromId(model: string): string {
        const slash = model.indexOf('/');
        return slash > 0 ? model.slice(0, slash) : 'other';
    }

    /**
     * Sends model results only for the latest model-listing request.
     */
    private postModels(
        view: vscode.Webview,
        requestId: number,
        payload: ModelListPayload
    ): void {
        if (!this.isCurrent(requestId)) {
            return;
        }

        view.postMessage({
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
        view: vscode.Webview,
        requestId: number,
        status: string
    ): void {
        if (!this.isCurrent(requestId)) {
            return;
        }

        view.postMessage({ type: 'modelStatus', status });
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