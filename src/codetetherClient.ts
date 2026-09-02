/**
 * Codetether client backed by the workspace-local Codetether CLI.
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as http from 'http';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { ChildProcess, spawn } from 'child_process';
import { CodetetherCliProgressParser } from './codetetherCliProgress';
import {
    CodetetherChatProgressSink,
    codetetherCancelledError
} from './codetetherChatProgress';
import {
    CodetetherRealtimeClient
} from './codetetherRealtimeClient';
import type {
    CodetetherSteeringSender
} from './codetetherRealtimeTypes';
import {
    summarizeCodetetherProcessFailure
} from './codetetherProcessFailure';
import { parseCodetetherRunOutput } from './codetetherRunOutput';
import {
    readCodetetherSessionToolEvents
} from './codetetherSessionToolEvents';
import { CodetetherToolEvent } from './codetetherToolEvents';
import {
    CodetetherVaultTokenManager
} from './codetetherVaultToken';
import {
    readCodetetherVaultTokenFile
} from './codetetherVaultTokenFile';
import {
    CodetetherManagedSessionStore
} from './codetetherManagedSession';
import { codetetherManagedServerKey } from
    './codetetherManagedServerKey';
import {
    applyCodetetherModelOptions,
    CodetetherModelOptions,
    defaultCodetetherModelOptions
} from './codetetherModelOptions';
import {
    CodeTetherApiError,
    CodeTetherDiscoveryTelemetry,
    CodeTetherClient
} from './codeTetherApiClient';
import {
    buildCodetetherRunArguments,
    CodetetherRunSessionMode
} from './codetetherRunArguments';
import { availableCodetetherModel } from './codetetherModelAvailability';
import { logToOutput } from './extractor';

const CODETETHER_HOSTNAME = '127.0.0.1';
const CODETETHER_BASE_PORT = 4203;
const CODETETHER_PORT_SCAN_LIMIT = 100;
const SERVER_START_TIMEOUT_MS = 15000;
const MODEL_LIST_TIMEOUT_MS = 15000;
const CODETETHER_RUN_TIMEOUT_MS = 30 * 60 * 1000;
const HEALTH_POLL_INTERVAL_MS = 250;
const ANSI_COLOR_PATTERN = new RegExp(
    `${String.fromCharCode(27)}\\[[0-9;]*m`,
    'g'
);
const CODETETHER_DEFAULT_VAULT_ADDRESS =
    'https://vault.spotlessbinco.com';
const CODETETHER_DEFAULT_VAULT_APP_ROLE =
    'rusty-refactor-vscode';
let defaultSecretStorage: vscode.SecretStorage | undefined;
let defaultVaultTokenManager: CodetetherVaultTokenManager | undefined;

/**
 * Registers extension SecretStorage for managed CodeTether sessions.
 */
export function configureCodetetherSecretStorage(
    secretStorage: vscode.SecretStorage
): CodetetherVaultTokenManager {
    defaultSecretStorage = secretStorage;
    const managedSessions = new CodetetherManagedSessionStore(
        secretStorage
    );
    defaultVaultTokenManager?.dispose();
    defaultVaultTokenManager = new CodetetherVaultTokenManager(
        secretStorage,
        {
            address: codetetherVaultAddress,
            roleName: codetetherVaultRoleName,
            localToken: readCodetetherVaultTokenFile,
            log: logToOutput,
            onTokenChanged: async () => {
                CodetetherServeManager.instance.disposeAll();
                await managedSessions.clear();
                logToOutput(
                    '[Codetether] Cleared the stale managed server session.'
                );
            }
        }
    );
    return defaultVaultTokenManager;
}

export interface JsToolCall {
    id: string;
    name: string;
    arguments: string;
    thought_signature?: string;
}

export interface JsChatResponse {
    text?: string;
    tool_calls?: JsToolCall[];
    tool_events?: CodetetherToolEvent[];
    session_id?: string;
    model_id?: string;
}

export interface JsToolDefinition {
    name: string;
    description: string;
    parameters: string;
}

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content?: string;
    tool_calls?: JsToolCall[];
    tool_call_id?: string;
}

export interface AvailableModel {
    label: string;
    provider: string;
    description: string;
    detail: string;
    modelId: string;
    source: 'vscode' | 'codetether';
}

export interface CodetetherModelDiscovery {
    items: AvailableModel[];
    telemetry: CodeTetherDiscoveryTelemetry;
}

export type CodetetherChatTransport =
    | 'websocket'
    | 'serve'
    | 'run';

interface CodetetherClientOptions {
    skipNativeBridge?: boolean;
    secretStorage?: vscode.SecretStorage;
    vaultTokenManager?: CodetetherVaultTokenManager;
}

class HttpStatusError extends Error {
    constructor(
        public readonly statusCode: number,
        public readonly requestPath: string,
        public readonly responseBody: string
    ) {
        super(`HTTP ${statusCode} from ${requestPath}: ${responseBody || '<empty body>'}`);
        this.name = 'HttpStatusError';
    }
}

interface AgentCard {
    name?: string;
    version?: string;
}

interface ServePromptOptions {
    maxTokens?: number;
    temperature?: number;
    signal?: AbortSignal;
    onProgress?: CodetetherChatProgressSink;
    sessionId?: string;
    sessionTitle?: string;
    onSteeringReady?: (
        sender: CodetetherSteeringSender
    ) => void;
}

/**
 * Configures one CodeTether chat request and its live progress channel.
 */
export interface CodetetherChatCompletionOptions {
    model?: string;
    modelOptions?: CodetetherModelOptions;
    maxTokens?: number;
    temperature?: number;
    tools?: JsToolDefinition[];
    preferCli?: boolean;
    transport?: CodetetherChatTransport;
    /**
     * Chooses whether a `run` process resumes history or creates a session.
     */
    runSessionMode?: CodetetherRunSessionMode;
    filePaths?: string[];
    signal?: AbortSignal;
    onProgress?: CodetetherChatProgressSink;
    sessionId?: string;
    sessionTitle?: string;
    onSteeringReady?: (
        sender: CodetetherSteeringSender
    ) => void;
}

/**
 * Encodes a JSON value for a JWT segment without padding.
 */
function base64UrlJson(value: unknown): string {
    return Buffer.from(JSON.stringify(value), 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/u, '');
}

/**
 * Encodes random bytes for a JWT signature-looking segment.
 */
function base64UrlRandom(byteLength: number): string {
    return crypto.randomBytes(byteLength)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/u, '');
}

/**
 * Creates the exact bearer secret for an extension-managed local server.
 *
 * Codetether validates this token by exact string match before reading the
 * JWT-shaped payload. The `editor` role is enough for local model chat and
 * model discovery without granting admin-only routes.
 */
function managedServerBearerToken(): string {
    const header = base64UrlJson({ alg: 'none', typ: 'JWT' });
    const payload = base64UrlJson({
        sub: 'rusty-refactor-managed-server',
        roles: ['editor'],
        auth_source: 'jwt',
        jti: crypto.randomBytes(16).toString('hex'),
    });
    const signature = base64UrlRandom(32);

    return `${header}.${payload}.${signature}`;
}

/**
 * Resolves the Vault server used to validate and renew provider credentials.
 */
function codetetherVaultAddress(): string {
    const config = vscode.workspace.getConfiguration('rustyRefactor');
    return config.get<string>('codetetherVaultAddress')
        || process.env.VAULT_ADDR
        || CODETETHER_DEFAULT_VAULT_ADDRESS;
}

/**
 * Resolves the least-privilege AppRole used for Codetether provider reads.
 */
function codetetherVaultRoleName(): string {
    const config = vscode.workspace.getConfiguration('rustyRefactor');
    return config.get<string>('codetetherVaultAppRole')
        || CODETETHER_DEFAULT_VAULT_APP_ROLE;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}


function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
    let timeout: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<T>((resolve) => {
        timeout = setTimeout(() => {
            logToOutput(timeoutMessage);
            resolve([] as unknown as T);
        }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timeout) {
            clearTimeout(timeout);
        }
    });
}

async function isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const server = net.createServer();

        server.once('error', () => {
            resolve(false);
        });

        server.once('listening', () => {
            server.close(() => resolve(true));
        });

        server.listen(port, CODETETHER_HOSTNAME);
    });
}

async function findAvailablePort(startPort: number): Promise<number> {
    for (let offset = 0; offset < CODETETHER_PORT_SCAN_LIMIT; offset++) {
        const port = startPort + offset;
        if (await isPortAvailable(port)) {
            return port;
        }
    }

    throw new Error(`Unable to find a free Codetether port starting at ${startPort}.`);
}

/**
 * Builds the environment used by extension-managed CodeTether processes.
 *
 * The generated auth token is shared with SecretStorage so HTTP clients can
 * call the same server. The static token receives the built-in admin role
 * because this private loopback server has no JWT identity provider. Local
 * policy evaluation remains enabled without requiring an OPA sidecar.
 * Cognition auto-start is disabled because extension requests use explicit
 * model chat calls and should not start a background thinker loop.
 */
function buildWorkspaceEnv(
    workspaceFolder: vscode.WorkspaceFolder,
    token: string,
    model: string
): NodeJS.ProcessEnv {
    const workspaceBin = path.join(workspaceFolder.uri.fsPath, 'node_modules', '.bin');
    const currentPath = process.env.PATH ?? process.env.Path ?? '';
    const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';

    const environment: NodeJS.ProcessEnv = {
        ...process.env,
        [pathKey]: `${workspaceBin}${path.delimiter}${currentPath}`,
        CODETETHER_AUTH_TOKEN: token,
        CODETETHER_STATIC_TOKEN_ADMIN: 'true',
        OPA_ENABLED: 'false',
        OPA_FAIL_OPEN: 'true',
        CODETETHER_COGNITION_AUTO_START: 'false',
        ...(model ? { CODETETHER_DEFAULT_MODEL: model } : {})
    };

    if (!model) {
        delete environment.CODETETHER_DEFAULT_MODEL;
    }
    return environment;
}

/**
 * Adds a maintained Vault credential to one Codetether process environment.
 */
async function buildCodetetherProcessEnv(
    workspaceFolder: vscode.WorkspaceFolder,
    token: string,
    model: string,
    vaultTokens?: CodetetherVaultTokenManager,
    modelOptions?: CodetetherModelOptions
): Promise<NodeJS.ProcessEnv> {
    const environment = buildWorkspaceEnv(
        workspaceFolder,
        token,
        model
    );
    const authenticated = vaultTokens
        ? await vaultTokens.environment(environment)
        : environment;
    return applyCodetetherModelOptions(
        authenticated,
        model,
        modelOptions
    );
}

class CodetetherServeProcess implements vscode.Disposable {
    private readonly token = managedServerBearerToken();
    private portPromise?: Promise<number>;
    private child: ChildProcess | null = null;
    private readyPromise: Promise<void> | null = null;
    private readonly stderrLines: string[] = [];

    /**
     * Creates one managed server with explicit auth and provider credentials.
     */
    constructor(
        private readonly workspaceFolder: vscode.WorkspaceFolder,
        private readonly binaryPath: string,
        private readonly model: string,
        private readonly modelOptions: CodetetherModelOptions,
        private readonly managedSessions?: CodetetherManagedSessionStore,
        private readonly vaultTokens?: CodetetherVaultTokenManager
    ) {}

    async ensureReady(): Promise<void> {
        if (this.readyPromise) {
            return this.readyPromise;
        }

        this.readyPromise = this.startAndWaitForHealth();

        try {
            await this.readyPromise;
        } catch (error) {
            this.readyPromise = null;
            throw error;
        }
    }

    async getAgentCard(): Promise<AgentCard> {
        await this.ensureReady();
        return this.requestJson<AgentCard>('GET', '/a2a/.well-known/agent.json');
    }

    /**
     * Runs one agent prompt over the authenticated realtime session adapter.
     */
    async sendPrompt(
        prompt: string,
        options: ServePromptOptions = {}
    ): Promise<JsChatResponse> {
        await this.ensureReady();
        const port = await this.resolvePort();
        const realtime = new CodetetherRealtimeClient(
            CODETETHER_HOSTNAME,
            port,
            this.token
        );
        const response = await realtime.complete(prompt, {
            sessionId: options.sessionId,
            sessionTitle: options.sessionTitle,
            signal: options.signal,
            sink: options.onProgress,
            onSteeringReady: options.onSteeringReady
        });

        return {
            text: response.text,
            tool_events: response.toolEvents,
            session_id: response.sessionId
        };
    }

    async checkHealth(): Promise<boolean> {
        try {
            await this.ensureReady();
            await this.requestRaw('GET', '/health');
            return true;
        } catch {
            return false;
        }
    }

    dispose(): void {
        this.stop();
    }

    /**
     * Starts the server process after preparing its maintained Vault lease.
     */
    private async startAndWaitForHealth(): Promise<void> {
        const port = await this.resolvePort();
        const args = ['serve', '--hostname', CODETETHER_HOSTNAME, '--port', String(port)];
        const env = await buildCodetetherProcessEnv(
            this.workspaceFolder,
            this.token,
            this.model,
            this.vaultTokens,
            this.modelOptions
        );
        await this.storeSessionSecrets(port);

        logToOutput(
            `[Codetether] Starting server in ${this.workspaceFolder.uri.fsPath} on ${CODETETHER_HOSTNAME}:${port} with model ${this.model}`
        );

        this.child = spawn(this.binaryPath, args, {
            cwd: this.workspaceFolder.uri.fsPath,
            env,
            shell: false,
            windowsHide: true
        });

        this.child.stdout?.on('data', (data) => {
            const text = data.toString().trim();
            if (text) {
                logToOutput(`[Codetether serve] ${text}`);
            }
        });

        this.child.stderr?.on('data', (data) => {
            const text = data.toString().trim();
            if (!text) {
                return;
            }

            this.stderrLines.push(text);
            if (this.stderrLines.length > 20) {
                this.stderrLines.shift();
            }
            logToOutput(`[Codetether serve] ${text}`);
        });

        this.child.on('error', (error) => {
            logToOutput(`[Codetether] Server process error: ${error.message}`);
        });

        this.child.on('exit', (code, signal) => {
            logToOutput(`[Codetether] Server exited with code=${code ?? 'null'} signal=${signal ?? 'null'}`);
            this.child = null;
            this.readyPromise = null;
        });

        const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
        while (Date.now() < deadline) {
            if (await this.healthcheckWithoutEnsure()) {
                logToOutput(`[Codetether] Server ready on ${CODETETHER_HOSTNAME}:${port}`);
                return;
            }

            if (this.child?.exitCode !== null && this.child?.exitCode !== undefined) {
                throw new Error(this.buildStartupError(`Codetether serve exited with code ${this.child.exitCode}.`));
            }

            await sleep(HEALTH_POLL_INTERVAL_MS);
        }

        throw new Error(this.buildStartupError('Timed out waiting for Codetether serve to become healthy.'));
    }

    /**
     * Stores the managed server URL and bearer token for API clients.
     *
     * Public so discovery can re-publish the credentials of a server that
     * is already running; SecretStorage otherwise keeps whichever managed
     * server wrote last, which may be a stopped or differently-keyed one.
     */
    async storeSessionSecrets(port?: number): Promise<void> {
        if (!this.managedSessions) {
            return;
        }

        const resolvedPort = port ?? await this.resolvePort();
        const serverUrl = `http://${CODETETHER_HOSTNAME}:${resolvedPort}`;
        try {
            await this.managedSessions.store(serverUrl, this.token);
        } catch (error) {
            const message = error instanceof Error
                ? error.message
                : String(error);
            logToOutput(
                `[Codetether] Failed to store managed server` +
                ` credentials: ${message}`
            );
        }
    }

    private stop(): void {
        if (!this.child) {
            return;
        }

        const child = this.child;
        this.child = null;
        this.readyPromise = null;

        try {
            child.kill();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logToOutput(`[Codetether] Failed to stop server: ${message}`);
        }
    }

    private async healthcheckWithoutEnsure(): Promise<boolean> {
        try {
            await this.requestRaw('GET', '/health');
            return true;
        } catch {
            return false;
        }
    }

    private buildStartupError(prefix: string): string {
        const relevantStderr = summarizeCodetetherProcessFailure(
            this.stderrLines.join('\n')
        );
        const stderrTail = relevantStderr
            ? ` Last stderr: ${relevantStderr}`
            : '';
        return `${prefix}${stderrTail}`;
    }

    private async requestJson<T>(method: 'GET' | 'POST', requestPath: string, body?: unknown): Promise<T> {
        const raw = await this.requestRaw(method, requestPath, body);
        return JSON.parse(raw) as T;
    }

    private async requestRaw(method: 'GET' | 'POST', requestPath: string, body?: unknown): Promise<string> {
        const port = await this.resolvePort();
        const payload = body === undefined ? undefined : JSON.stringify(body);

        return new Promise((resolve, reject) => {
            const request = http.request(
                {
                    hostname: CODETETHER_HOSTNAME,
                    port,
                    path: requestPath,
                    method,
                    headers: {
                        Authorization: `Bearer ${this.token}`,
                        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {})
                    }
                },
                (response) => {
                    const chunks: Buffer[] = [];

                    response.on('data', (chunk: Buffer | string) => {
                        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                    });

                    response.on('end', () => {
                        const rawBody = Buffer.concat(chunks).toString('utf8');
                        const statusCode = response.statusCode ?? 0;

                        if (statusCode >= 200 && statusCode < 300) {
                            resolve(rawBody);
                            return;
                        }

                        reject(new HttpStatusError(statusCode, requestPath, rawBody));
                    });
                }
            );

            request.on('error', reject);

            if (payload) {
                request.write(payload);
            }

            request.end();
        });
    }

    /**
     * Lazily reserves this process's port when serialized startup begins.
     *
     * Deferring the scan prevents concurrent process objects from observing
     * the same free port before either server has bound it.
     */
    private resolvePort(): Promise<number> {
        this.portPromise ??= findAvailablePort(CODETETHER_BASE_PORT);
        return this.portPromise;
    }
}

class CodetetherServeManager {
    private static singleton: CodetetherServeManager | null = null;
    private readonly servers = new Map<string, CodetetherServeProcess>();
    private startupTail: Promise<void> = Promise.resolve();

    static get instance(): CodetetherServeManager {
        if (!this.singleton) {
            this.singleton = new CodetetherServeManager();
        }

        return this.singleton;
    }

    /**
     * Returns a healthy per-workspace server with the requested dependencies.
     */
    async ensureServer(
        workspaceFolder: vscode.WorkspaceFolder,
        binaryPath: string,
        model: string,
        modelOptions: CodetetherModelOptions,
        managedSessions?: CodetetherManagedSessionStore,
        vaultTokens?: CodetetherVaultTokenManager
    ): Promise<CodetetherServeProcess> {
        const key = codetetherManagedServerKey(
            workspaceFolder.uri.toString(),
            binaryPath,
            model,
            modelOptions
        );

        let server = this.servers.get(key);
        if (!server) {
            server = new CodetetherServeProcess(
                workspaceFolder,
                binaryPath,
                model,
                modelOptions,
                managedSessions,
                vaultTokens
            );
            this.servers.set(key, server);
        }

        await this.ensureReadyInOrder(server);
        return server;
    }

    /**
     * Serializes process startup so each server reserves a distinct port.
     *
     * Active turns remain concurrent after startup; only port selection and
     * binding are ordered to remove their shared free-port race.
     */
    private async ensureReadyInOrder(
        server: CodetetherServeProcess
    ): Promise<void> {
        const previous = this.startupTail;
        let release = (): void => {};
        this.startupTail = new Promise<void>(resolve => {
            release = resolve;
        });
        await previous;
        try {
            await server.ensureReady();
        } finally {
            release();
        }
    }

    disposeAll(): void {
        for (const server of this.servers.values()) {
            server.dispose();
        }
        this.servers.clear();
    }
}

/**
 * Client that talks to Codetether using `serve` chat or `run`.
 */
export class CodetetherClient {
    private defaultModel: string;
    private binaryPath: string;
    private readonly skipNativeBridge: boolean;
    private readonly secretStorage?: vscode.SecretStorage;
    private readonly managedSessions?: CodetetherManagedSessionStore;
    private readonly vaultTokens?: CodetetherVaultTokenManager;

    /**
     * Creates a client from workspace settings and optional secret storage.
     */
    constructor(options: CodetetherClientOptions = {}) {
        const config = vscode.workspace.getConfiguration('rustyRefactor');
        this.defaultModel = config.get<string>('codetetherModel') || '';
        this.binaryPath = config.get<string>('codetetherBinaryPath') || 'codetether';
        this.skipNativeBridge = options.skipNativeBridge ?? false;
        this.secretStorage = options.secretStorage ?? defaultSecretStorage;
        this.managedSessions = this.secretStorage
            ? new CodetetherManagedSessionStore(this.secretStorage)
            : undefined;
        this.vaultTokens = options.vaultTokenManager
            ?? defaultVaultTokenManager;

        if (this.skipNativeBridge) {
            logToOutput(
                '[Codetether] Native bridge skip flag is ignored for chat; '
                + 'chat uses `codetether serve` or `codetether run`.'
            );
        }
    }

    static disposeAllServers(): void {
        CodetetherServeManager.instance.disposeAll();
    }

    refreshConfig(): void {
        const config = vscode.workspace.getConfiguration('rustyRefactor');
        this.defaultModel = config.get<string>('codetetherModel') || '';
        this.binaryPath = config.get<string>('codetetherBinaryPath') || 'codetether';
    }

    isEnabled(): boolean {
        const config = vscode.workspace.getConfiguration('rustyRefactor');
        return config.get<boolean>('useCodetether') || false;
    }

    /**
     * Sends chat messages through the configured Codetether transport.
     *
     * Server transports use the authenticated realtime session endpoint.
     */
    async chatCompletion(
        messages: ChatMessage[],
        options: CodetetherChatCompletionOptions = {}
    ): Promise<JsChatResponse> {
        this.refreshConfig();

        const workspaceFolder = this.resolveWorkspaceFolder(
            options.filePaths
        );
        const requestedModel = options.model || this.defaultModel;
        const model = await this.resolveAvailableModel(requestedModel);
        const transport = options.transport
            ?? this.resolveChatTransport(options.preferCli);

        if (transport === 'run') {
            const prompt = this.lastUserMessage(messages);
            const response = await this.runViaCli(
                workspaceFolder,
                model,
                prompt,
                options.runSessionMode ?? 'continue',
                options.modelOptions,
                options.signal,
                options.onProgress
            );
            return this.withResponseModel(response, model);
        }

        if (options.tools && options.tools.length > 0) {
            logToOutput(
                '[Codetether] Realtime transport does not support '
                + 'extension-side tool callbacks; ignoring requested tools.'
            );
        }

        const server = await CodetetherServeManager.instance.ensureServer(
            workspaceFolder,
            this.binaryPath,
            model,
            options.modelOptions || defaultCodetetherModelOptions(),
            this.managedSessions,
            this.vaultTokens
        );

        logToOutput(
            `[Codetether] Sending realtime chat request to `
            + `${workspaceFolder.name} on ${CODETETHER_HOSTNAME} `
            + `with model ${model}`
        );

        const response = await server.sendPrompt(
            this.lastUserMessage(messages),
            {
                maxTokens: options.maxTokens,
                temperature: options.temperature,
                signal: options.signal,
                onProgress: options.onProgress,
                sessionId: options.sessionId,
                sessionTitle: options.sessionTitle,
                onSteeringReady: options.onSteeringReady
            }
        );
        return this.withResponseModel(response, model);
    }

    /**
     * Attaches the exact requested model to a completed response.
     */
    private withResponseModel(
        response: JsChatResponse,
        model: string
    ): JsChatResponse {
        return {
            ...response,
            model_id: response.model_id || model
        };
    }

    /**
     * Revalidates a requested model against the live CodeTether endpoint.
     *
     * Discovery failures and stale IDs both select automatic routing so a
     * cached provider can never make an otherwise valid CLI run fail.
     */
    private async resolveAvailableModel(requested: string): Promise<string> {
        try {
            const discovery = await this.discoverModelPickerItems();
            const available = discovery.items.map(item => item.modelId);
            const resolved = availableCodetetherModel(
                requested,
                available
            );
            this.logModelResolution(requested, resolved, available.length);
            return resolved;
        } catch (error) {
            const message = error instanceof Error
                ? error.message
                : String(error);
            logToOutput(
                '[Codetether] Live model revalidation failed; using '
                + `automatic provider routing: ${message}`
            );
            return '';
        }
    }

    /**
     * Records when live discovery replaces a stale explicit model.
     */
    private logModelResolution(
        requested: string,
        resolved: string,
        availableCount: number
    ): void {
        const requestedId = requested.trim();
        if (requestedId && !resolved) {
            logToOutput(
                `[Codetether] Model ${requestedId} is absent from the live `
                + `endpoint (${availableCount} models); using automatic `
                + 'provider routing.'
            );
        }
    }

    /**
     * Chooses the chat transport from call options or workspace settings.
     */
    private resolveChatTransport(preferCli?: boolean): CodetetherChatTransport {
        if (preferCli === true) {
            return 'run';
        }
        if (preferCli === false) {
            return 'serve';
        }

        const config = vscode.workspace.getConfiguration('rustyRefactor');
        const configured = config.get<string>(
            'codetetherChatTransport'
        ) || 'websocket';
        if (configured === 'run') {
            return 'run';
        }
        return configured === 'serve' ? 'serve' : 'websocket';
    }

    /**
     * Runs one chat request through the short-lived Codetether CLI transport.
     */
    private async runViaCli(
        workspaceFolder: vscode.WorkspaceFolder,
        model: string,
        prompt: string,
        sessionMode: CodetetherRunSessionMode,
        modelOptions?: CodetetherModelOptions,
        signal?: AbortSignal,
        onProgress?: CodetetherChatProgressSink
    ): Promise<JsChatResponse> {
        if (signal?.aborted) {
            throw codetetherCancelledError();
        }

        const token = crypto.randomBytes(12).toString('hex');
        const env = await buildCodetetherProcessEnv(
            workspaceFolder,
            token,
            model,
            this.vaultTokens,
            modelOptions
        );
        const args = buildCodetetherRunArguments({
            model,
            prompt,
            sessionMode
        });
        const progressParser = new CodetetherCliProgressParser(onProgress);

        const modelLabel = model || 'automatic';
        logToOutput(
            `[Codetether] Spawning CLI transport in ` +
            `${workspaceFolder.uri.fsPath} with model ${modelLabel}`
        );

        return new Promise((resolve, reject) => {
            const proc = spawn(this.binaryPath, args, {
                cwd: workspaceFolder.uri.fsPath,
                env,
                shell: false,
                windowsHide: true
            });

            let stdout = '';
            let stderr = '';
            let settled = false;
            const cleanup = (): void => {
                clearTimeout(timeout);
                signal?.removeEventListener('abort', onAbort);
            };
            const onAbort = (): void => {
                if (settled) {
                    return;
                }

                settled = true;
                cleanup();
                try {
                    proc.kill();
                } catch {
                    // The process already exited while steering was queued.
                }
                reject(codetetherCancelledError());
            };
            const timeout = setTimeout(() => {
                if (settled) {
                    return;
                }

                settled = true;
                cleanup();
                logToOutput(`[Codetether] CLI transport timed out after ${CODETETHER_RUN_TIMEOUT_MS}ms.`);
                try {
                    proc.kill();
                } catch {
                    // The process is already gone or cannot be killed; rejecting unblocks the caller.
                }
                reject(new Error(
                    'Codetether run timed out. Check the Codetether ' +
                    'terminal/output for a stuck request.'
                ));
            }, CODETETHER_RUN_TIMEOUT_MS);
            signal?.addEventListener('abort', onAbort, { once: true });

            proc.stdout?.on('data', (data) => {
                stdout += data.toString();
            });

            proc.stderr?.on('data', (data) => {
                const chunk = data.toString();
                stderr += chunk;
                progressParser.push(chunk);
            });

            proc.on('error', (err) => {
                if (settled) {
                    return;
                }

                settled = true;
                cleanup();
                logToOutput(
                    `[Codetether] CLI transport spawn failed: ${err.message}`
                );
                reject(new Error(
                    `Failed to spawn codetether CLI transport: ${err.message}`
                ));
            });

            proc.on('close', (code) => {
                if (settled) {
                    return;
                }

                settled = true;
                cleanup();
                progressParser.finish();
                if (code !== 0) {
                    const detail = summarizeCodetetherProcessFailure(
                        stderr,
                        stdout
                    ) || '<no non-log error output>';
                    logToOutput(`[Codetether] CLI transport exited with code ${code}: ${detail}`);
                    reject(new Error(`Codetether CLI transport exited with code ${code}: ${detail}`));
                    return;
                }

                void this.cliRunResponse(
                    workspaceFolder.uri.fsPath,
                    stdout
                ).then(resolve, reject);
            });
        });
    }

    /**
     * Converts noisy CLI output into a response with completed tool events.
     */
    private async cliRunResponse(
        workspacePath: string,
        stdout: string
    ): Promise<JsChatResponse> {
        const output = parseCodetetherRunOutput(stdout);
        const toolEvents = await readCodetetherSessionToolEvents(
            workspacePath,
            output.sessionId
        );

        return {
            text: output.text,
            session_id: output.sessionId,
            tool_events: toolEvents
        };
    }

    private buildPrompt(messages: ChatMessage[]): string {
        const sections: string[] = [];

        for (const message of messages) {
            const bodyParts: string[] = [];

            if (message.content) {
                bodyParts.push(message.content);
            }

            if (message.tool_calls && message.tool_calls.length > 0) {
                bodyParts.push(`Tool calls:\n${JSON.stringify(message.tool_calls, null, 2)}`);
            }

            if (message.role === 'tool' && message.tool_call_id) {
                bodyParts.unshift(`Tool call id: ${message.tool_call_id}`);
            }

            const body = bodyParts.join('\n\n').trim();
            if (!body) {
                continue;
            }

            sections.push(`${message.role.toUpperCase()}:\n${body}`);
        }

        return sections.join('\n\n');
    }

    /**
     * Extracts the most recent user message from a chat history.
     * Used by the `run` CLI transport, which spawns a fresh session
     * each call and cannot receive an ever-growing argument string
     * without risking an E2BIG error from the OS argument-list limit.
     * Falls back to the full buildPrompt output if no user message
     * is found.
     */
    private lastUserMessage(messages: ChatMessage[]): string {
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.role === 'user' && msg.content) {
                return msg.content;
            }
        }
        return this.buildPrompt(messages);
    }

    private resolveWorkspaceFolder(filePaths: string[] = []): vscode.WorkspaceFolder {
        for (const filePath of filePaths) {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
            if (workspaceFolder) {
                return workspaceFolder;
            }
        }

        const activeEditorUri = vscode.window.activeTextEditor?.document.uri;
        if (activeEditorUri) {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeEditorUri);
            if (workspaceFolder) {
                return workspaceFolder;
            }
        }

        const fallback = vscode.workspace.workspaceFolders?.[0];
        if (fallback) {
            return fallback;
        }

        throw new Error('Open a workspace folder before using Codetether.');
    }

    /**
     * Builds model-discovery environment variables with maintained Vault auth.
     */
    private async buildModelListEnv(
        workspaceFolder: vscode.WorkspaceFolder | undefined
    ): Promise<NodeJS.ProcessEnv> {
        const token = crypto.randomBytes(12).toString('hex');
        const model = this.defaultModel;
        let baseEnv: NodeJS.ProcessEnv;

        if (workspaceFolder) {
            baseEnv = await buildCodetetherProcessEnv(
                workspaceFolder,
                token,
                model,
                this.vaultTokens
            );
        } else if (this.vaultTokens) {
            baseEnv = await this.vaultTokens.environment({
                ...process.env
            });
        } else {
            baseEnv = { ...process.env };
        }

        const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
        const pathValue = baseEnv[pathKey] ?? baseEnv.PATH ?? baseEnv.Path ?? '';

        if (process.platform !== 'win32') {
            const home = os.homedir();
            const likelyUserBins = [
                path.join(home, '.codetether', 'bin'),
                path.join(home, '.cargo', 'bin'),
                path.join(home, '.local', 'bin'),
                '/usr/local/bin',
                '/opt/homebrew/bin'
            ];
            baseEnv[pathKey] = [...likelyUserBins, pathValue].filter(Boolean).join(path.delimiter);
        }

        return baseEnv;
    }

    private mergeModelLists(...groups: string[][]): string[] {
        return [...new Set(groups.flat().map(model => model.trim()).filter(Boolean))].sort();
    }

    /**
     * Lists provider models through a short-lived authenticated CLI process.
     */
    private async listModelsViaCli(): Promise<string[]> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const cwd = workspaceFolder?.uri.fsPath;
        const env = await this.buildModelListEnv(workspaceFolder);

        logToOutput(`[Codetether] Listing models via CLI: ${this.binaryPath} models${cwd ? ` (cwd: ${cwd})` : ''}.`);

        return new Promise((resolve) => {
            const proc = spawn(this.binaryPath, ['models'], {
                cwd,
                env,
                shell: false,
                windowsHide: true
            });

            let stdout = '';
            let stderr = '';
            let settled = false;
            const timeout = setTimeout(() => {
                if (settled) {
                    return;
                }
                settled = true;
                logToOutput(
                    '[Codetether] listModels CLI timed out after '
                    + `${MODEL_LIST_TIMEOUT_MS}ms; using default/manual `
                    + 'model selection.'
                );
                try {
                    proc.kill();
                } catch {
                    // Resolving is enough when the process already exited.
                }
                resolve([]);
            }, MODEL_LIST_TIMEOUT_MS);

            proc.stdout?.on('data', (data) => {
                const text = data.toString();
                stdout += text;
                this.logChunk('[Codetether models stdout]', text);
            });

            proc.stderr?.on('data', (data) => {
                const text = data.toString();
                stderr += text;
                this.logChunk('[Codetether models stderr]', text);
            });

            proc.on('error', (err) => {
                if (settled) {
                    return;
                }
                settled = true;
                if (timeout) {
                    clearTimeout(timeout);
                }
                logToOutput(`[Codetether] listModels CLI spawn failed: ${err.message}`);
                resolve([]);
            });

            proc.on('close', (code, signal) => {
                if (settled) {
                    return;
                }
                settled = true;
                if (timeout) {
                    clearTimeout(timeout);
                }

                if (code !== 0) {
                    const detail = summarizeCodetetherProcessFailure(
                        stderr,
                        stdout
                    ) || '<no non-log error output>';
                    logToOutput(`[Codetether] listModels CLI exited with code=${code ?? 'null'} signal=${signal ?? 'null'}: ${detail}`);
                    resolve([]);
                    return;
                }

                const combined = `${stdout}\n${stderr}`;
                logToOutput(`[Codetether] listModels CLI completed with ${combined.length} bytes of output.`);
                const jsonModels = this.extractModelsFromJson(combined);
                if (jsonModels.length > 0) {
                    logToOutput(`[Codetether] Parsed ${jsonModels.length} models from JSON CLI output.`);
                    resolve(jsonModels);
                     return;
                 }

                const models = this.extractModelsFromCliTable(combined);
                logToOutput(`[Codetether] Parsed ${models.length} models from provider CLI output.`);
                resolve(models);
             });

         });
     }

    private extractModelsFromCliTable(output: string): string[] {
        const models: string[] = [];
        let currentProvider = '';

        for (const rawLine of output.split(/\r?\n/)) {
            const line = rawLine
                .replace(ANSI_COLOR_PATTERN, '')
                .replace(/\r/g, '');
            const trimmed = line.trim();

            if (!trimmed) {
                continue;
            }

            if (/\b(INFO|WARN|ERROR|DEBUG|TRACE)\b/.test(trimmed) || /^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
                continue;
            }

            if (/^\d+\s+models?\s+from\s+\d+\s+providers?/i.test(trimmed)) {
                continue;
            }

            if (/^\s{2,}\S+/.test(line)) {
                if (currentProvider) {
                    const modelId = trimmed.split(/\s+/)[0];
                    if (this.isCliModelToken(modelId)) {
                        models.push(`${currentProvider}/${modelId}`);
                    }
                }
                continue;
            }

            if (/^[~a-z0-9][\w.-]*$/i.test(trimmed)) {
                currentProvider = trimmed;
            }
        }

        return [...new Set(models)].sort();
    }

    private isCliModelToken(token: string): boolean {
        if (!token || token === '-' || /^\d/.test(token)) {
            return false;
        }

        return /^[~a-z0-9][\w./:@-]*$/i.test(token);
    }

     private logChunk(prefix: string, text: string): void {
         for (const line of text.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (trimmed) {
                logToOutput(`${prefix} ${trimmed}`);
            }
        }
    }

    private async listModelsViaServeApi(cwd: string | undefined, env: NodeJS.ProcessEnv): Promise<string[]> {
        const token = crypto.randomBytes(24).toString('hex');
        const port = await findAvailablePort(CODETETHER_BASE_PORT + CODETETHER_PORT_SCAN_LIMIT);
        const args = ['serve', '--hostname', CODETETHER_HOSTNAME, '--port', String(port)];
        const serveEnv = {
            ...env,
            CODETETHER_AUTH_TOKEN: token,
            CODETETHER_STATIC_TOKEN_ADMIN: 'true',
            OPA_ENABLED: 'false'
        };
        const proc = spawn(this.binaryPath, args, {
            cwd,
            env: serveEnv,
            shell: false,
            windowsHide: true
        });

        let stderr = '';
        proc.stderr?.on('data', data => {
            stderr += data.toString();
        });

        try {
            const ready = await this.waitForServeHealth(port, token, 8000);
            if (!ready) {
                return [];
            }

            const candidatePaths = ['/models', '/api/models', '/v1/models'];
            for (const requestPath of candidatePaths) {
                try {
                    const body = await this.httpGet(port, requestPath, token, 5000);
                    const models = this.extractModelsFromJson(body);
                    if (models.length > 0) {
                        return models;
                    }
                } catch {
                    // Try the next known endpoint. Codetether 4.6.3 returns 403 for these.
                }
            }

            return [];
        } finally {
            if (stderr.trim()) {
                logToOutput(`[Codetether] serve API model probe stderr: ${stderr.trim().split(/\r?\n/).slice(-3).join(' | ')}`);
            }
            try {
                proc.kill();
            } catch {
                // Best-effort cleanup.
            }
        }
    }

    private async waitForServeHealth(port: number, token: string, timeoutMs: number): Promise<boolean> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            try {
                await this.httpGet(port, '/health', token, 1000);
                return true;
            } catch {
                await sleep(250);
            }
        }
        return false;
    }

    private async httpGet(port: number, requestPath: string, token: string, timeoutMs: number): Promise<string> {
        return new Promise((resolve, reject) => {
            const request = http.request({
                hostname: CODETETHER_HOSTNAME,
                port,
                path: requestPath,
                method: 'GET',
                timeout: timeoutMs,
                headers: { Authorization: `Bearer ${token}` }
            }, response => {
                const chunks: Buffer[] = [];
                response.on('data', (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
                response.on('end', () => {
                    const rawBody = Buffer.concat(chunks).toString('utf8');
                    const statusCode = response.statusCode ?? 0;
                    if (statusCode >= 200 && statusCode < 300) {
                        resolve(rawBody);
                    } else {
                        reject(new HttpStatusError(statusCode, requestPath, rawBody));
                    }
                });
            });
            request.on('timeout', () => {
                request.destroy(new Error(`Timed out requesting ${requestPath}`));
            });
            request.on('error', reject);
            request.end();
        });
    }

    private extractModelsFromJson(rawBody: string): string[] {
        try {
            const parsed = JSON.parse(rawBody);
            const candidates = Array.isArray(parsed) ? parsed : parsed.models ?? parsed.data ?? [];
            if (!Array.isArray(candidates)) {
                return [];
            }
            return [...new Set(candidates.map((item: any) => {
                if (typeof item === 'string') return item;
                return item?.id || item?.name || item?.model || '';
            }).filter((model: string) => typeof model === 'string' && model.trim()).map((model: string) => model.trim()))].sort();
        } catch {
            return [];
        }
    }

    /**
     * Starts the configured server and reports its health and version.
     */
    async checkAvailable(): Promise<{
        available: boolean;
        version?: string;
        error?: string;
    }> {
        try {
            this.refreshConfig();
            const workspaceFolder = this.resolveWorkspaceFolder();
            const model = this.defaultModel;
            const server = await CodetetherServeManager.instance.ensureServer(
                workspaceFolder,
                this.binaryPath,
                model,
                defaultCodetetherModelOptions(),
                this.managedSessions,
                this.vaultTokens
            );
            const healthy = await server.checkHealth();
            if (!healthy) {
                return { available: false, error: 'CodeTether server failed its health check.' };
            }

            const card = await server.getAgentCard();
            const description = [card.name || 'CodeTether', card.version].filter(Boolean).join(' ');
            return { available: true, version: description || 'A2A server ready' };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { available: false, error: message };
        }
    }

    /**
     * Lists picker-ready models from CodeTether's VS Code model endpoint.
     */
    async listModelPickerItems(): Promise<AvailableModel[]> {
        const discovery = await this.discoverModelPickerItems();

        return discovery.items;
    }

    /**
     * Lists picker-ready models with endpoint discovery telemetry.
     */
    async discoverModelPickerItems(): Promise<CodetetherModelDiscovery> {
        await this.vaultTokens?.initialize();
        const apiClient = new CodeTetherClient(this.secretStorage);
        await this.ensureModelDiscoverySession(apiClient);

        try {
            return await this.discoverModelPickerItemsFromApi(apiClient);
        } catch (error) {
            if (!this.shouldRetryManagedDiscovery(error)) {
                throw error;
            }

            logToOutput(
                '[Codetether] Stored model endpoint credentials are stale;' +
                ' re-publishing the managed server credentials.'
            );
            await this.startManagedModelDiscoverySession();
            return this.discoverModelPickerItemsFromApi(
                new CodeTetherClient(this.secretStorage)
            );
        }
    }

    /**
     * Maps CodeTether API models into picker-ready model items.
     */
    private async discoverModelPickerItemsFromApi(
        apiClient: CodeTetherClient
    ): Promise<CodetetherModelDiscovery> {
        const discovery = await apiClient.discoverVscodeModels();
        const items = discovery.models.map(model => ({
            label: model.name,
            provider: model.vendor,
            description: `${model.vendor}/${model.family}`,
            detail: [
                `Vendor: ${model.vendor}`,
                `Family: ${model.family}`,
                `Max tokens: ${model.maxInputTokens}`
            ].join(', '),
            modelId: model.id,
            source: 'codetether' as const
        }));

        return {
            items,
            telemetry: {
                ...discovery.telemetry,
                shownModelCount: items.length
            }
        };
    }

    /**
     * Returns whether stale managed connection details should be replaced.
     *
     * A managed server may outlive SecretStorage or be restarted with a new
     * generated token. Explicit user-managed credentials are never rotated.
     */
    private shouldRetryManagedDiscovery(error: unknown): boolean {
        if (!(error instanceof CodeTetherApiError)) {
            return false;
        }

        const retryable = [
            'auth',
            'network',
            'timeout'
        ].includes(error.kind);
        if (!retryable) {
            return false;
        }

        return this.shouldStartManagedDiscoveryServer()
            && !this.hasExplicitServerConfiguration();
    }

    /**
     * Starts a managed server for discovery when the user opted into it.
     */
    private async ensureModelDiscoverySession(
        apiClient: CodeTetherClient
    ): Promise<void> {
        if (await apiClient.hasConfiguredSession()) {
            return;
        }

        if (!this.shouldStartManagedDiscoveryServer()) {
            return;
        }

        await this.startManagedModelDiscoverySession();
    }

    /**
     * Starts or reuses the extension-managed CodeTether server.
     *
     * The live server's URL and bearer token are always re-published to
     * SecretStorage. A reused server never rewrites them on its own, so a
     * stale pair left by an earlier server would otherwise keep producing
     * 401 "token missing/wrong" discovery failures.
     */
    private async startManagedModelDiscoverySession(): Promise<void> {
        this.refreshConfig();
        const workspaceFolder = this.resolveWorkspaceFolder();
        const model = '';

        const server = await CodetetherServeManager.instance.ensureServer(
            workspaceFolder,
            this.binaryPath,
            model,
            defaultCodetetherModelOptions(),
            this.managedSessions,
            this.vaultTokens
        );
        await server.storeSessionSecrets();
    }

    /**
     * Returns whether settings or env point at a user-managed server.
     */
    private hasExplicitServerConfiguration(): boolean {
        const config = vscode.workspace.getConfiguration('rustyRefactor');

        return Boolean(
            config.get<string>('codeTether.serverUrl') ||
            config.get<string>('codetetherServer') ||
            config.get<string>('codetetherA2AServerUrl') ||
            process.env.CODETETHER_SERVER
        );
    }

    /**
     * Returns whether model discovery may create a workspace server.
     */
    private shouldStartManagedDiscoveryServer(): boolean {
        const config = vscode.workspace.getConfiguration('rustyRefactor');
        const transport = config.get<string>('codetetherChatTransport') ||
            'websocket';

        return !this.hasExplicitServerConfiguration() || Boolean(
            config.get<boolean>('codeTether.enabled') ||
            config.get<boolean>('useCodetether') ||
            transport === 'serve' ||
            transport === 'websocket'
        );
    }

    /**
     * Lists CodeTether model IDs for compact sidebar dropdowns.
     */
    async listModels(): Promise<string[]> {
        const items = await this.listModelPickerItems();

        return items.map(item => item.modelId);
    }

    /**
     * Legacy CLI/A2A model probes kept only for debugging old builds.
     */
    private async listModelsLegacyViaCli(): Promise<string[]> {
        this.refreshConfig();
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const cwd = workspaceFolder?.uri.fsPath;
        const env = await this.buildModelListEnv(workspaceFolder);
        const groups: string[][] = [];

        // Probe remote A2A server first — cheapest and most complete
        // source when a cluster server is port-forwarded locally.
        const remoteA2AModels = await this.listModelsViaRemoteA2A();
        if (remoteA2AModels.length > 0) {
            logToOutput(
                `[Codetether] Remote A2A server returned` +
                ` ${remoteA2AModels.length} models.`
            );
            groups.push(remoteA2AModels);
        }

        const cliModels = await this.listModelsViaCli();
        if (cliModels.length > 0) {
            groups.push(cliModels);
        }

        if (cliModels.length === 0 && remoteA2AModels.length === 0) {
            try {
                logToOutput(
                    '[Codetether] Probing Codetether serve API for' +
                    ' models after CLI and remote A2A returned none.'
                );
                const serveApiModels =
                    await this.listModelsViaServeApi(cwd, env);
                logToOutput(
                    `[Codetether] Serve API model probe returned` +
                    ` ${serveApiModels.length} models.`
                );
                if (serveApiModels.length > 0) {
                    groups.push(serveApiModels);
                }
            } catch (error) {
                const message = error instanceof Error
                    ? error.message
                    : String(error);
                logToOutput(
                    `[Codetether] Serve API model discovery` +
                    ` failed: ${message}`
                );
            }
        }

        const merged = this.mergeModelLists(...groups);
        logToOutput(
            `[Codetether] Model discovery final result:` +
            ` ${merged.length} models from the Codetether CLI.`
        );
        return merged;
    }

    /**
     * Queries the configured remote A2A server for its model list.
     * Tries standard OpenAI-compatible and A2A agent-card endpoints.
     * Returns an empty list when no URL is configured or the server
     * is unreachable, so callers can fall back gracefully.
     */
    private async listModelsViaRemoteA2A(): Promise<string[]> {
        const config = vscode.workspace.getConfiguration('rustyRefactor');
        const rawUrl = config.get<string>('codetetherA2AServerUrl') || '';
        const baseUrl = rawUrl.trim().replace(/\/$/, '');

        if (!baseUrl) {
            return this.listModelsViaWellKnownA2A();
        }

        return this.queryA2AServerForModels(baseUrl);
    }

    /**
     * Tries the default port-forwarded a2a-server URL
     * (http://localhost:8000) without requiring explicit configuration.
     * Only used when no explicit URL is set.
     */
    private async listModelsViaWellKnownA2A(): Promise<string[]> {
        const defaultUrl = 'http://127.0.0.1:8000';
        try {
            const models = await this.queryA2AServerForModels(defaultUrl);
            if (models.length > 0) {
                logToOutput(
                    '[Codetether] Auto-discovered' +
                    ` ${models.length} models from` +
                    ` well-known A2A server at ${defaultUrl}.`
                );
            }
            return models;
        } catch {
            return [];
        }
    }

    /**
     * Queries a single A2A server base URL for its available models.
     * Probes /v1/models, /models, and /a2a/.well-known/agent.json in
     * order, returning the first non-empty result.
     */
    private async queryA2AServerForModels(
        baseUrl: string
    ): Promise<string[]> {
        // 1. Workers endpoint — live agents register their actual model IDs here.
        try {
            const body = await this.httpGetUrl(`${baseUrl}/v1/agent/workers`, 6000);
            const workers = JSON.parse(body);
            if (Array.isArray(workers) && workers.length > 0) {
                const seen = new Set<string>();
                const models: string[] = [];
                for (const worker of workers) {
                    for (const m of (worker.models || [])) {
                        const id: string = m?.id || m?.name || '';
                        if (id && !seen.has(id)) {
                            seen.add(id);
                            models.push(id);
                        }
                    }
                }
                if (models.length > 0) {
                    logToOutput(
                        `[Codetether] Remote A2A workers: ${models.length}` +
                        ` unique model IDs across ${workers.length} workers.`
                    );
                    return models.sort();
                }
            }
        } catch (err) {
            logToOutput(
                `[Codetether] Remote A2A workers probe failed: ${err instanceof Error ? err.message : String(err)}`
            );
        }

        // 2. Providers endpoint — returns Vault-configured providers even when
        //    no workers are connected via SSE.
        try {
            const body = await this.httpGetUrl(`${baseUrl}/v1/agent/providers`, 4000);
            const parsed = JSON.parse(body);
            const providers: string[] = ((parsed.providers || []) as any[])
                .filter((p: any) => p.configured && p.model_count > 0)
                .map((p: any) => String(p.provider_id))
                .filter(Boolean);
            if (providers.length > 0) {
                logToOutput(
                    `[Codetether] Remote A2A providers: ${providers.length}` +
                    ` configured providers (no live workers).`
                );
                return providers.sort();
            }
        } catch {
            // Fall through to legacy endpoints.
        }

        // 3. Legacy OpenAI-compatible and agent-card endpoints.
        const candidates = [
            `${baseUrl}/v1/models`,
            `${baseUrl}/models`,
            `${baseUrl}/a2a/.well-known/agent.json`
        ];

        for (const url of candidates) {
            try {
                const body = await this.httpGetUrl(url, 4000);
                const models = this.extractModelsFromJson(body);
                if (models.length > 0) {
                    logToOutput(
                        `[Codetether] Remote A2A: ${models.length}` +
                        ` models from ${url}`
                    );
                    return models;
                }
            } catch {
                // Try the next endpoint.
            }
        }

        return [];
    }

    /**
     * Performs a plain GET to an absolute URL with a timeout.
     * Resolves with the response body text on 2xx, rejects otherwise.
     */
    private httpGetUrl(
        url: string,
        timeoutMs: number
    ): Promise<string> {
        const parsed = new URL(url);
        const port = parsed.port
            ? parseInt(parsed.port, 10)
            : (parsed.protocol === 'https:' ? 443 : 80);

        return new Promise((resolve, reject) => {
            const request = http.request(
                {
                    hostname: parsed.hostname,
                    port,
                    path: parsed.pathname + parsed.search,
                    method: 'GET',
                    timeout: timeoutMs
                },
                response => {
                    const chunks: Buffer[] = [];
                    response.on('data', (chunk: Buffer | string) =>
                        chunks.push(
                            Buffer.isBuffer(chunk)
                                ? chunk
                                : Buffer.from(chunk)
                        )
                    );
                    response.on('end', () => {
                        const body =
                            Buffer.concat(chunks).toString('utf8');
                        const status = response.statusCode ?? 0;
                        if (status >= 200 && status < 300) {
                            resolve(body);
                        } else {
                            reject(
                                new Error(
                                    `HTTP ${status} from ${url}`
                                )
                            );
                        }
                    });
                }
            );
            request.on('timeout', () =>
                request.destroy(
                    new Error(`Timed out requesting ${url}`)
                )
            );
            request.on('error', reject);
            request.end();
        });
    }
}

/**
 * Unified interface that works with codetether or VS Code's LM API
 */
export class UnifiedModelClient {
    private codetetherClient: CodetetherClient;

    /**
     * Creates a unified model client with optional secret-backed auth.
     */
    constructor(secretStorage?: vscode.SecretStorage) {
        this.codetetherClient = new CodetetherClient({ secretStorage });
    }

    shouldUseCustomEndpoint(): boolean {
        return this.codetetherClient.isEnabled();
    }

    async sendChat(
        messages: ChatMessage[],
        options: {
            model?: string;
            maxTokens?: number;
            temperature?: number;
            justification?: string;
            token?: vscode.CancellationToken;
        } = {}
    ): Promise<string> {
        if (this.shouldUseCustomEndpoint()) {
            const resp = await this.codetetherClient.chatCompletion(messages, {
                model: options.model,
                maxTokens: options.maxTokens,
                temperature: options.temperature
            });
            return resp.text || '';
        }

        return this.sendVSCodeChat(messages, options);
    }

    async *streamChat(
        messages: ChatMessage[],
        options: {
            model?: string;
            maxTokens?: number;
            temperature?: number;
            justification?: string;
            token?: vscode.CancellationToken;
        } = {}
    ): AsyncGenerator<string> {
        if (this.shouldUseCustomEndpoint()) {
            const result = await this.codetetherClient.chatCompletion(messages, {
                model: options.model,
                maxTokens: options.maxTokens,
                temperature: options.temperature
            });
            if (result.text) {
                yield result.text;
            }
            return;
        }

        const model = await this.selectModel(options.model);
        if (!model) {
            throw new Error('No language model available');
        }

        const chatMessages = messages.map(m =>
            m.role === 'user'
                ? vscode.LanguageModelChatMessage.User(m.content || '')
                : vscode.LanguageModelChatMessage.Assistant(m.content || '')
        );

        const response = await model.sendRequest(
            chatMessages,
            { justification: options.justification },
            options.token || new vscode.CancellationTokenSource().token
        );

        for await (const fragment of response.text) {
            yield fragment;
        }
    }

    async selectModel(preferredId?: string): Promise<vscode.LanguageModelChat | null> {
        try {
            const allModels = await vscode.lm.selectChatModels();
            if (allModels.length === 0) {
                return null;
            }

            const config = vscode.workspace.getConfiguration('rustyRefactor');
            const fastId = config.get<string>('aiFastModel');
            const preferred = preferredId || config.get<string>('aiPreferredModel');

            if (preferred) {
                const match = allModels.find(m => `${m.vendor}/${m.family}` === preferred);
                if (match) {
                    return match;
                }
            }

            if (fastId) {
                const match = allModels.find(m => `${m.vendor}/${m.family}` === fastId);
                if (match) {
                    return match;
                }
            }

            const sorted = [...allModels].sort((a, b) => b.maxInputTokens - a.maxInputTokens);
            return sorted[0] || null;
        } catch {
            return null;
        }
    }

    private async sendVSCodeChat(
        messages: ChatMessage[],
        options: {
            model?: string;
            maxTokens?: number;
            temperature?: number;
            justification?: string;
            token?: vscode.CancellationToken;
        }
    ): Promise<string> {
        const model = await this.selectModel(options.model);
        if (!model) {
            throw new Error('No language model available');
        }

        const chatMessages = messages.map(m =>
            m.role === 'user'
                ? vscode.LanguageModelChatMessage.User(m.content || '')
                : vscode.LanguageModelChatMessage.Assistant(m.content || '')
        );

        const response = await model.sendRequest(
            chatMessages,
            { justification: options.justification },
            options.token || new vscode.CancellationTokenSource().token
        );

        let result = '';
        for await (const fragment of response.text) {
            result += fragment;
        }

        return result;
    }

    /**
     * Lists picker-ready models from the requested source with fallback.
     */
    async getAvailableModels(
        source: 'vscode' | 'codetether' = 'vscode'
    ): Promise<AvailableModel[]> {
        if (source === 'vscode') {
            return this.getVSCodeModels();
        }

        try {
            return await this.codetetherClient.listModelPickerItems();
        } catch (error) {
            logToOutput(
                `[UnifiedModelClient] Failed to list CodeTether` +
                ` models: ${error}`
            );
            return this.getVSCodeModels();
        }
    }

    /**
     * Lists VS Code language models as picker items.
     */
    private async getVSCodeModels(): Promise<AvailableModel[]> {
        try {
            const vscodeModels = await vscode.lm.selectChatModels();

            return vscodeModels.map(model => ({
                label: model.name || `${model.vendor}/${model.family}`,
                provider: model.vendor,
                description: `${model.vendor}/${model.family}`,
                detail: [
                    `Vendor: ${model.vendor}`,
                    `Family: ${model.family}`,
                    `Max tokens: ${model.maxInputTokens}`
                ].join(', '),
                modelId: `${model.vendor}/${model.family}`,
                source: 'vscode' as const
            }));
        } catch (error) {
            logToOutput(
                `[UnifiedModelClient] Failed to list VS Code models: ${error}`
            );
            return [];
        }
    }
}