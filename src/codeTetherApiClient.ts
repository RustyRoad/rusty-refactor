import * as http from 'http';
import * as https from 'https';
import * as vscode from 'vscode';

export const CODE_TETHER_SERVER_SECRET_KEY =
    'rustyRefactor.codeTether.serverUrl';
export const CODE_TETHER_TOKEN_SECRET_KEY =
    'rustyRefactor.codeTether.token';

const REQUEST_TIMEOUT_MS = 6000;
let defaultSecretStorage: vscode.SecretStorage | undefined;

/**
 * Registers extension SecretStorage for CodeTether API clients.
 */
export function configureCodeTetherSecretStorage(
    secretStorage: vscode.SecretStorage
): void {
    defaultSecretStorage = secretStorage;
}

export interface CodeTetherModel {
    id: string;
    name: string;
    vendor: string;
    family: string;
    maxInputTokens: number;
    maxOutputTokens?: number;
    supportsTools?: boolean;
    supportsVision?: boolean;
}

interface CodeTetherModelsResponse {
    data?: CodeTetherModel[];
}

type CodeTetherErrorKind =
    | 'not-configured'
    | 'auth'
    | 'policy'
    | 'network'
    | 'timeout'
    | 'invalid-json'
    | 'http';

interface CodeTetherSession {
    serverUrl: string;
    token: string;
}

interface CodeTetherSessionCandidate {
    serverUrl?: string;
    token?: string;
}

interface HttpGetResult {
    body: string;
    status: number;
}

export interface CodeTetherDiscoveryTelemetry {
    discoverySource: string;
    serverUrl: string;
    httpStatus: number | string;
    rawModelCount: number;
    shownModelCount: number;
    providerCounts: Record<string, number>;
    fallbackUsed: boolean;
}

export interface CodeTetherModelDiscovery {
    models: CodeTetherModel[];
    telemetry: CodeTetherDiscoveryTelemetry;
}

/**
 * Error raised by CodeTether API discovery with safe, token-free messages.
 */
export class CodeTetherApiError extends Error {
    /**
     * Creates a token-safe CodeTether API error.
     */
    public constructor(
        public readonly kind: CodeTetherErrorKind,
        message: string,
        public readonly statusCode?: number
    ) {
        super(message);
        this.name = 'CodeTetherApiError';
    }
}

/**
 * Client for CodeTether's first-class VS Code model discovery API.
 */
export class CodeTetherClient {
    /**
     * Creates a client that reads settings, env vars, and SecretStorage.
     */
    public constructor(
        private readonly secretStorage = defaultSecretStorage
    ) {}

    /**
     * Lists VS Code-shaped models from the configured CodeTether server.
     */
    public async listVscodeModels(): Promise<CodeTetherModel[]> {
        const discovery = await this.discoverVscodeModels();

        return discovery.models;
    }

    /**
     * Lists models and includes debug telemetry for discovery diagnostics.
     */
    public async discoverVscodeModels(): Promise<CodeTetherModelDiscovery> {
        const session = await this.resolveSession();
        if (!session) {
            throw new CodeTetherApiError(
                'not-configured',
                'CodeTether server URL or token is not configured.'
            );
        }

        const result = await this.get(
            `${session.serverUrl}/v1/models/vscode`,
            session.token,
            REQUEST_TIMEOUT_MS
        );
        const parsed = this.parseModelsResponse(result.body);
        const models = parsed.data ?? [];

        return {
            models,
            telemetry: {
                discoverySource: 'codetether-api',
                serverUrl: this.telemetryServerUrl(session.serverUrl),
                httpStatus: result.status,
                rawModelCount: models.length,
                shownModelCount: models.length,
                providerCounts: this.providerCounts(models),
                fallbackUsed: false
            }
        };
    }

    /**
     * Returns whether discovery should be attempted for current settings.
     */
    public async isEnabledOrConfigured(): Promise<boolean> {
        const config = vscode.workspace.getConfiguration('rustyRefactor');
        const enabled = config.get<boolean>('codeTether.enabled') ||
            config.get<boolean>('useCodetether') ||
            false;
        const session = await this.resolveSession();

        return enabled || Boolean(session);
    }

    /**
     * Returns whether a usable server URL and token pair is configured.
     */
    public async hasConfiguredSession(): Promise<boolean> {
        return Boolean(await this.resolveSession());
    }

    /**
     * Resolves server URL and bearer token without probing the API.
     */
    private async resolveSession(): Promise<CodeTetherSession | undefined> {
        const candidates = await this.sessionCandidates();

        for (const candidate of candidates) {
            const serverUrl = this.normalizeServerUrl(
                candidate.serverUrl || ''
            );
            const token = (candidate.token || '').trim();

            if (serverUrl && token) {
                return { serverUrl, token };
            }
        }

        return undefined;
    }

    /**
     * Builds ordered server/token candidates without mixing managed secrets
     * ahead of explicit user-managed settings.
     */
    private async sessionCandidates(): Promise<CodeTetherSessionCandidate[]> {
        const config = vscode.workspace.getConfiguration('rustyRefactor');
        const settingsServer = config.get<string>('codeTether.serverUrl') ||
            '';
        const envServer = process.env.CODETETHER_SERVER || '';
        const secretServer = await this.secretValue(
            CODE_TETHER_SERVER_SECRET_KEY
        );
        const legacyServer = config.get<string>('codetetherServer') || '';
        const legacySecretServer = await this.secretValue(
            'rustyRefactor.codetetherServer'
        );
        const a2aServer = config.get<string>('codetetherA2AServerUrl') || '';
        const settingsToken = config.get<string>('codeTether.token') || '';
        const legacyToken = config.get<string>('codetetherToken') || '';
        const envToken = process.env.CODETETHER_TOKEN || '';
        const secretToken = await this.secretValue(
            CODE_TETHER_TOKEN_SECRET_KEY
        );
        const legacySecretToken = await this.secretValue(
            'rustyRefactor.codetetherToken'
        );
        const authToken = process.env.CODETETHER_AUTH_TOKEN || '';
        const fallbackToken = settingsToken ||
            legacyToken ||
            envToken ||
            secretToken ||
            legacySecretToken ||
            authToken;

        return [
            { serverUrl: settingsServer, token: settingsToken },
            { serverUrl: envServer, token: envToken },
            { serverUrl: secretServer, token: secretToken },
            { serverUrl: legacyServer, token: legacyToken },
            { serverUrl: legacySecretServer, token: legacySecretToken },
            { serverUrl: a2aServer, token: fallbackToken },
            { serverUrl: settingsServer, token: fallbackToken },
            { serverUrl: envServer, token: fallbackToken },
            { serverUrl: legacyServer, token: fallbackToken },
            { serverUrl: legacySecretServer, token: fallbackToken },
            { serverUrl: secretServer, token: fallbackToken }
        ];
    }

    /**
     * Removes a trailing slash from a configured server URL.
     */
    private normalizeServerUrl(serverUrl: string): string {
        return serverUrl.trim().replace(/\/$/, '');
    }

    /**
     * Formats a server URL for telemetry without userinfo or query values.
     */
    private telemetryServerUrl(serverUrl: string): string {
        try {
            const parsed = new URL(serverUrl);
            return parsed.origin + parsed.pathname.replace(/\/$/, '');
        } catch {
            return serverUrl.split('?')[0].replace(/\/$/, '');
        }
    }

    /**
     * Reads a stored secret, returning an empty value when unavailable.
     */
    private async secretValue(key: string): Promise<string> {
        if (!this.secretStorage) {
            return '';
        }

        return await this.secretStorage.get(key) || '';
    }

    /**
     * Parses and validates the CodeTether model-list response.
     */
    private parseModelsResponse(raw: string): CodeTetherModelsResponse {
        try {
            const parsed = JSON.parse(raw) as CodeTetherModelsResponse;

            if (!parsed || !Array.isArray(parsed.data)) {
                throw new Error('Missing data array');
            }

            return parsed;
        } catch (error) {
            const message = error instanceof Error
                ? error.message
                : String(error);
            throw new CodeTetherApiError(
                'invalid-json',
                `CodeTether returned invalid model JSON: ${message}`
            );
        }
    }

    /**
     * Performs one authenticated GET with timeout and safe errors.
     */
    private get(
        url: string,
        token: string,
        timeoutMs: number
    ): Promise<HttpGetResult> {
        const parsed = new URL(url);
        const transport = parsed.protocol === 'https:' ? https : http;
        const port = parsed.port
            ? parseInt(parsed.port, 10)
            : (parsed.protocol === 'https:' ? 443 : 80);

        return new Promise((resolve, reject) => {
            const request = transport.request(
                {
                    hostname: parsed.hostname,
                    port,
                    path: parsed.pathname + parsed.search,
                    method: 'GET',
                    timeout: timeoutMs,
                    headers: {
                        Authorization: `Bearer ${token}`
                    }
                },
                response => this.handleResponse(response, resolve, reject)
            );

            request.on('timeout', () => {
                request.destroy(new CodeTetherApiError(
                    'timeout',
                    'Timed out requesting CodeTether models.'
                ));
            });
            request.on('error', error => {
                if (error instanceof CodeTetherApiError) {
                    reject(error);
                    return;
                }
                reject(new CodeTetherApiError(
                    'network',
                    `CodeTether model request failed: ${error.message}`
                ));
            });
            request.end();
        });
    }

    /**
     * Converts one HTTP response into text or a typed API error.
     */
    private handleResponse(
        response: http.IncomingMessage,
        resolve: (value: HttpGetResult) => void,
        reject: (reason?: unknown) => void
    ): void {
        const chunks: Buffer[] = [];

        response.on('data', (chunk: Buffer | string) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            const status = response.statusCode ?? 0;

            if (status >= 200 && status < 300) {
                resolve({ body, status });
                return;
            }

            reject(this.statusError(status));
        });
    }

    /**
     * Maps an HTTP status into a user-actionable CodeTether error.
     */
    private statusError(status: number): CodeTetherApiError {
        if (status === 401) {
            return new CodeTetherApiError(
                'auth',
                'CodeTether rejected the bearer token.',
                status
            );
        }

        if (status === 403) {
            return new CodeTetherApiError(
                'policy',
                'CodeTether policy denied agent:read.',
                status
            );
        }

        return new CodeTetherApiError(
            'http',
            `CodeTether model endpoint returned HTTP ${status}.`,
            status
        );
    }

    /**
     * Counts models by provider without changing provider names.
     */
    private providerCounts(
        models: CodeTetherModel[]
    ): Record<string, number> {
        return models.reduce<Record<string, number>>((counts, model) => {
            const provider = model.vendor || model.id.split('/')[0] || 'other';
            counts[provider] = (counts[provider] || 0) + 1;
            return counts;
        }, {});
    }
}
