/**
 * Authenticates Codetether child processes through a Vault AppRole.
 */

import * as http from 'http';
import * as https from 'https';

const VAULT_REQUEST_TIMEOUT_MS = 10_000;
const MINIMUM_RENEWAL_DELAY_MS = 60_000;
const MAXIMUM_RENEWAL_DELAY_MS = 2_147_000_000;
const LEGACY_VAULT_TOKEN_SECRET_KEY =
    'rustyRefactor.codetetherVaultToken';
const VAULT_ROLE_ID_SECRET_KEY =
    'rustyRefactor.codetetherVaultRoleId';
const VAULT_SECRET_ID_SECRET_KEY =
    'rustyRefactor.codetetherVaultSecretId';

/**
 * Describes the subset of secret storage needed for AppRole credentials.
 */
export interface VaultTokenSecretStore {
    get(key: string): Thenable<string | undefined>;
    store(key: string, value: string): Thenable<void>;
    delete(key: string): Thenable<void>;
}

/**
 * Reports a Vault-issued token lease without exposing its credential.
 */
export interface VaultTokenLease {
    renewable: boolean;
    ttlSeconds: number;
}

/**
 * Supplies runtime dependencies without coupling Vault auth to VS Code.
 */
export interface CodetetherVaultTokenOptions {
    address: () => string;
    roleName: () => string;
    localToken?: () => Promise<string | undefined>;
    log?: (message: string) => void;
    onTokenChanged?: () => void | Promise<void>;
}

interface VaultResponseData {
    role_id?: string;
    secret_id?: string;
}

interface VaultAuthData {
    client_token?: string;
    renewable?: boolean;
    lease_duration?: number;
}

interface VaultResponse {
    data?: VaultResponseData;
    auth?: VaultAuthData;
    errors?: string[];
}

interface VaultAppRoleCredentials {
    roleId: string;
    secretId: string;
}

interface IssuedVaultToken {
    token: string;
    lease: VaultTokenLease;
}

/**
 * Identifies safe Vault API failures without including credentials.
 */
class VaultRequestError extends Error {
    /**
     * Creates a request error suitable for logs and user notifications.
     */
    public constructor(
        message: string,
        public readonly statusCode?: number
    ) {
        super(message);
        this.name = 'VaultRequestError';
    }
}

/**
 * Exchanges stored AppRole credentials for fresh Vault client tokens.
 */
export class CodetetherVaultTokenManager {
    private renewalTimer?: NodeJS.Timeout;
    private activeToken?: string;
    private cacheValidUntil = 0;
    private preparation?: Promise<string | undefined>;
    private disposed = false;
    private missingCredentialsLogged = false;
    private ambientTokenIgnoredLogged = false;
    private localTokenLoadedLogged = false;
    private lastLocalToken?: string;

    /**
     * Creates an AppRole client around secure credential storage.
     */
    public constructor(
        private readonly secrets: VaultTokenSecretStore,
        private readonly options: CodetetherVaultTokenOptions
    ) {}

    /**
     * Logs in with stored AppRole credentials when the extension activates.
     *
     * A login obtains a new client token. Missing credentials are allowed so
     * providers that do not use Vault remain available before configuration.
     */
    public async initialize(): Promise<void> {
        try {
            await this.tokenForProcess();
        } catch (error) {
            this.logFailure('Vault AppRole initialization failed', error);
        }
    }

    /**
     * Uses an administrator token once to provision local AppRole credentials.
     *
     * Vault supplies the configured role's RoleID and creates a SecretID. The
     * bootstrap token is never persisted. A successful AppRole login returns
     * a newly issued client token for Codetether processes.
     */
    public async bootstrapToken(
        bootstrapToken: string
    ): Promise<VaultTokenLease> {
        const normalized = bootstrapToken.trim();
        if (!normalized) {
            throw new Error('Vault bootstrap token cannot be empty.');
        }

        const credentials = await this.createAppRoleCredentials(normalized);
        await this.storeAppRoleCredentials(credentials);
        const issued = await this.login(credentials);
        await this.secrets.delete(LEGACY_VAULT_TOKEN_SECRET_KEY);
        this.cacheLease(issued.token, issued.lease);
        await this.notifyTokenChanged();
        return issued.lease;
    }

    /**
     * Adds a current AppRole-issued token to a child-process environment.
     */
    public async environment(
        baseEnvironment: NodeJS.ProcessEnv
    ): Promise<NodeJS.ProcessEnv> {
        const token = await this.tokenForProcess();
        if (!token) {
            return this.withoutAmbientToken(baseEnvironment);
        }

        return {
            ...baseEnvironment,
            VAULT_ADDR: this.vaultAddress(),
            VAULT_TOKEN: token
        };
    }

    /**
     * Stops lease timers and drops the in-memory client token.
     */
    public dispose(): void {
        this.disposed = true;
        this.clearRenewalTimer();
        this.activeToken = undefined;
        this.lastLocalToken = undefined;
        this.cacheValidUntil = 0;
    }

    /**
     * Coalesces concurrent process starts into one AppRole login request.
     */
    private async tokenForProcess(): Promise<string | undefined> {
        if (this.activeToken && Date.now() < this.cacheValidUntil) {
            return this.activeToken;
        }

        if (!this.preparation) {
            this.preparation = this.loginWithStoredCredentials().finally(
                () => {
                    this.preparation = undefined;
                }
            );
        }

        return this.preparation;
    }

    /**
     * Loads AppRole credentials and exchanges them for a new client token.
     */
    private async loginWithStoredCredentials(): Promise<string | undefined> {
        const credentials = await this.loadAppRoleCredentials();
        if (!credentials) {
            const localToken = await this.loadLocalToken();
            if (localToken) {
                return localToken;
            }
            const migratedToken = await this.migrateLegacyToken();
            if (migratedToken) {
                return migratedToken;
            }
            this.logMissingCredentials();
            return undefined;
        }

        const issued = await this.login(credentials);
        this.cacheLease(issued.token, issued.lease);
        this.logIssuedToken(issued.lease);
        await this.notifyTokenChanged();
        return issued.token;
    }

    /**
     * Converts a token saved by version 0.6.24 into AppRole credentials.
     *
     * Migration uses the old value once as bootstrap authority and deletes it
     * after Vault returns a new AppRole-issued client token.
     */
    private async migrateLegacyToken(): Promise<string | undefined> {
        const legacyToken = (
            await this.secrets.get(LEGACY_VAULT_TOKEN_SECRET_KEY)
        )?.trim();
        if (!legacyToken) {
            return undefined;
        }

        this.options.log?.(
            '[Codetether] Migrating legacy Vault auth to AppRole.'
        );
        const lease = await this.bootstrapToken(legacyToken);
        this.options.log?.(
            '[Codetether] Legacy Vault auth migrated to AppRole.'
        );
        this.logIssuedToken(lease);
        return this.activeToken;
    }

    /**
     * Retrieves a RoleID and generates a SecretID using bootstrap authority.
     */
    private async createAppRoleCredentials(
        bootstrapToken: string
    ): Promise<VaultAppRoleCredentials> {
        const rolePath = this.encodedRolePath();
        const roleResponse = await this.request(
            'GET',
            `${rolePath}/role-id`,
            bootstrapToken
        );
        const secretResponse = await this.request(
            'POST',
            `${rolePath}/secret-id`,
            bootstrapToken,
            {}
        );
        const roleId = roleResponse.data?.role_id?.trim();
        const secretId = secretResponse.data?.secret_id?.trim();

        if (!roleId || !secretId) {
            throw new VaultRequestError(
                'Vault returned incomplete AppRole credentials.'
            );
        }

        return { roleId, secretId };
    }

    /**
     * Reads the native CLI credential when AppRole is not configured.
     *
     * A changed file token invalidates managed children because each child
     * inherits a credential snapshot when it starts.
     */
    private async loadLocalToken(): Promise<string | undefined> {
        const token = (await this.options.localToken?.())?.trim();
        if (!token) {
            return undefined;
        }

        if (!this.localTokenLoadedLogged) {
            this.localTokenLoadedLogged = true;
            this.options.log?.(
                '[Codetether] Loaded the native CLI Vault credential.'
            );
        }
        if (this.lastLocalToken !== token) {
            this.lastLocalToken = token;
            await this.notifyTokenChanged();
        }
        return token;
    }

    /**
     * Stores only reusable AppRole credentials, never the bootstrap token.
     */
    private async storeAppRoleCredentials(
        credentials: VaultAppRoleCredentials
    ): Promise<void> {
        await this.secrets.store(
            VAULT_SECRET_ID_SECRET_KEY,
            credentials.secretId
        );
        await this.secrets.store(
            VAULT_ROLE_ID_SECRET_KEY,
            credentials.roleId
        );
    }

    /**
     * Loads a complete AppRole credential pair from secure storage.
     */
    private async loadAppRoleCredentials(): Promise<
        VaultAppRoleCredentials | undefined
    > {
        const roleId = (
            await this.secrets.get(VAULT_ROLE_ID_SECRET_KEY)
        )?.trim();
        const secretId = (
            await this.secrets.get(VAULT_SECRET_ID_SECRET_KEY)
        )?.trim();

        if (!roleId || !secretId) {
            return undefined;
        }

        return { roleId, secretId };
    }

    /**
     * Calls the unauthenticated AppRole login endpoint for a new token.
     */
    private async login(
        credentials: VaultAppRoleCredentials
    ): Promise<IssuedVaultToken> {
        const response = await this.request(
            'POST',
            '/v1/auth/approle/login',
            undefined,
            {
                role_id: credentials.roleId,
                secret_id: credentials.secretId
            }
        );
        const token = response.auth?.client_token?.trim();
        if (!token) {
            throw new VaultRequestError(
                'Vault AppRole login returned no client token.'
            );
        }

        return {
            token,
            lease: this.leaseFromAuth(response)
        };
    }

    /**
     * Caches an issued token and renews it halfway through its active lease.
     */
    private cacheLease(token: string, lease: VaultTokenLease): void {
        this.activeToken = token;
        const renewalDelay = this.renewalDelay(lease.ttlSeconds);
        this.cacheValidUntil = Date.now()
            + this.tokenValidityDelay(lease.ttlSeconds);
        this.clearRenewalTimer();

        if (!lease.renewable || this.disposed) {
            return;
        }

        this.renewalTimer = setTimeout(() => {
            void this.renewActiveToken(token);
        }, renewalDelay);
    }

    /**
     * Extends the active token so inherited child environments stay valid.
     *
     * If Vault rejects that token, AppRole login obtains a replacement and
     * process owners are notified to recycle children with stale environments.
     */
    private async renewActiveToken(expectedToken: string): Promise<void> {
        if (this.disposed || this.activeToken !== expectedToken) {
            return;
        }

        try {
            const response = await this.request(
                'POST',
                '/v1/auth/token/renew-self',
                expectedToken,
                {}
            );
            const lease = this.leaseFromAuth(response);
            this.cacheLease(expectedToken, lease);
            this.options.log?.(
                '[Codetether] Renewed the active Vault client token.'
            );
        } catch (error) {
            this.logFailure('Vault client token renewal failed', error);
            if (this.isAuthenticationFailure(error)) {
                await this.replaceRejectedToken();
                return;
            }
            this.scheduleRenewalRetry(expectedToken);
        }
    }

    /**
     * Re-authenticates through AppRole after Vault rejects an active token.
     */
    private async replaceRejectedToken(): Promise<void> {
        this.activeToken = undefined;
        this.cacheValidUntil = 0;
        this.clearRenewalTimer();

        try {
            await this.loginWithStoredCredentials();
        } catch (error) {
            this.logFailure('Vault AppRole re-authentication failed', error);
            this.scheduleAuthenticationRetry();
        }
    }

    /**
     * Retries renewal after a transient Vault transport failure.
     */
    private scheduleRenewalRetry(token: string): void {
        this.clearRenewalTimer();
        if (this.disposed) {
            return;
        }

        this.cacheValidUntil = Date.now() + MINIMUM_RENEWAL_DELAY_MS;
        this.renewalTimer = setTimeout(() => {
            void this.renewActiveToken(token);
        }, MINIMUM_RENEWAL_DELAY_MS);
    }

    /**
     * Retries AppRole login when Vault was unavailable during replacement.
     */
    private scheduleAuthenticationRetry(): void {
        this.clearRenewalTimer();
        if (this.disposed) {
            return;
        }

        this.renewalTimer = setTimeout(() => {
            void this.replaceRejectedToken();
        }, MINIMUM_RENEWAL_DELAY_MS);
    }

    /**
     * Converts a login or renewal response into validated lease metadata.
     */
    private leaseFromAuth(response: VaultResponse): VaultTokenLease {
        const ttlSeconds = response.auth?.lease_duration;
        if (!Number.isFinite(ttlSeconds) || Number(ttlSeconds) <= 0) {
            throw new VaultRequestError(
                'Vault returned an invalid client token lease.'
            );
        }

        return {
            renewable: response.auth?.renewable === true,
            ttlSeconds: Number(ttlSeconds)
        };
    }

    /**
     * Calls a Vault endpoint and parses its bounded JSON response.
     */
    private async request(
        method: 'GET' | 'POST',
        requestPath: string,
        token?: string,
        body?: Record<string, unknown>
    ): Promise<VaultResponse> {
        const requestUrl = new URL(requestPath, this.vaultAddress());
        const transport = requestUrl.protocol === 'http:' ? http : https;
        const payload = body === undefined
            ? undefined
            : JSON.stringify(body);

        return new Promise<VaultResponse>((resolve, reject) => {
            const headers: http.OutgoingHttpHeaders = {
                Accept: 'application/json'
            };
            if (token) {
                headers['X-Vault-Token'] = token;
            }
            if (payload !== undefined) {
                headers['Content-Type'] = 'application/json';
                headers['Content-Length'] = Buffer.byteLength(payload);
            }

            const request = transport.request(
                requestUrl,
                { method, headers },
                response => {
                    this.readResponse(response, resolve, reject);
                }
            );

            request.setTimeout(VAULT_REQUEST_TIMEOUT_MS, () => {
                request.destroy(new VaultRequestError(
                    'Vault request timed out.'
                ));
            });
            request.on('error', error => {
                reject(this.safeRequestError(error));
            });

            if (payload !== undefined) {
                request.write(payload);
            }
            request.end();
        });
    }

    /**
     * Collects a bounded Vault response and converts HTTP errors safely.
     */
    private readResponse(
        response: http.IncomingMessage,
        resolve: (value: VaultResponse) => void,
        reject: (reason: Error) => void
    ): void {
        const chunks: Buffer[] = [];
        let byteLength = 0;

        response.on('data', chunk => {
            const buffer = Buffer.from(chunk);
            byteLength += buffer.length;
            if (byteLength <= 1_000_000) {
                chunks.push(buffer);
            }
        });
        response.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            try {
                const parsed = this.parseResponse(body);
                const statusCode = response.statusCode ?? 0;

                if (statusCode < 200 || statusCode >= 300) {
                    reject(this.httpError(statusCode, parsed));
                    return;
                }

                resolve(parsed);
            } catch (error) {
                reject(this.safeRequestError(error));
            }
        });
        response.on('error', error => {
            reject(this.safeRequestError(error));
        });
    }

    /**
     * Parses Vault JSON without exposing malformed response bodies.
     */
    private parseResponse(body: string): VaultResponse {
        try {
            return JSON.parse(body) as VaultResponse;
        } catch {
            throw new VaultRequestError(
                'Vault returned a malformed response.'
            );
        }
    }

    /**
     * Creates a concise HTTP failure from Vault's structured error list.
     */
    private httpError(
        statusCode: number,
        response: VaultResponse
    ): VaultRequestError {
        const detail = (response.errors ?? [])
            .map(error => error.trim())
            .filter(Boolean)
            .join('; ');
        const suffix = detail ? `: ${detail}` : '';
        return new VaultRequestError(
            `Vault request failed with HTTP ${statusCode}${suffix}`,
            statusCode
        );
    }

    /**
     * Removes request implementation details from network errors.
     */
    private safeRequestError(error: unknown): VaultRequestError {
        if (error instanceof VaultRequestError) {
            return error;
        }

        const message = error instanceof Error
            ? error.message
            : String(error);
        return new VaultRequestError(`Vault request failed: ${message}`);
    }

    /**
     * Returns whether Vault explicitly rejected a token credential.
     */
    private isAuthenticationFailure(error: unknown): boolean {
        return error instanceof VaultRequestError
            && (error.statusCode === 400 || error.statusCode === 403);
    }

    /**
     * Resolves and validates the configured Vault base address.
     */
    private vaultAddress(): string {
        const address = this.options.address().trim();
        const parsed = new URL(address);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            throw new Error('Vault address must use HTTP or HTTPS.');
        }

        return parsed.toString();
    }

    /**
     * Builds the API path for the configured AppRole name.
     */
    private encodedRolePath(): string {
        const roleName = this.options.roleName().trim();
        if (!roleName) {
            throw new Error('Vault AppRole name cannot be empty.');
        }

        return '/v1/auth/approle/role/' + encodeURIComponent(roleName);
    }

    /**
     * Chooses a safe timer duration at half of the active token lease.
     */
    private renewalDelay(ttlSeconds: number): number {
        const halfLease = Math.floor(ttlSeconds * 500);
        return Math.min(
            MAXIMUM_RENEWAL_DELAY_MS,
            Math.max(MINIMUM_RENEWAL_DELAY_MS, halfLease)
        );
    }

    /**
     * Keeps a cached token until shortly before its reported lease expires.
     */
    private tokenValidityDelay(ttlSeconds: number): number {
        const leaseMilliseconds = ttlSeconds * 1_000;
        return Math.max(
            MINIMUM_RENEWAL_DELAY_MS,
            leaseMilliseconds - MINIMUM_RENEWAL_DELAY_MS
        );
    }

    /**
     * Prevents an unrelated shell token from bypassing managed AppRole auth.
     */
    private withoutAmbientToken(
        baseEnvironment: NodeJS.ProcessEnv
    ): NodeJS.ProcessEnv {
        if (!baseEnvironment.VAULT_TOKEN) {
            return baseEnvironment;
        }

        const sanitized = { ...baseEnvironment };
        delete sanitized.VAULT_TOKEN;
        if (!this.ambientTokenIgnoredLogged) {
            this.ambientTokenIgnoredLogged = true;
            this.options.log?.(
                '[Codetether] Ignored unmanaged ambient VAULT_TOKEN.'
            );
        }
        return sanitized;
    }

    /**
     * Logs missing remote-host credentials once without blocking other auth.
     */
    private logMissingCredentials(): void {
        if (this.missingCredentialsLogged) {
            return;
        }

        this.missingCredentialsLogged = true;
        this.options.log?.(
            '[Codetether] Vault AppRole is not configured in this '
            + 'extension host. Run the Vault bootstrap command here.'
        );
    }

    /**
     * Logs safe lease metadata after Vault issues a fresh client token.
     */
    private logIssuedToken(lease: VaultTokenLease): void {
        this.missingCredentialsLogged = false;
        this.options.log?.(
            `[Codetether] Vault AppRole login issued a new `
            + `${lease.ttlSeconds} second client token.`
        );
    }

    /**
     * Lets process owners retire sessions created with an older credential.
     */
    private async notifyTokenChanged(): Promise<void> {
        await this.options.onTokenChanged?.();
    }

    /**
     * Cancels the active renewal timer without changing stored credentials.
     */
    private clearRenewalTimer(): void {
        if (!this.renewalTimer) {
            return;
        }

        clearTimeout(this.renewalTimer);
        this.renewalTimer = undefined;
    }

    /**
     * Writes credential-free failure details to the extension output channel.
     */
    private logFailure(prefix: string, error: unknown): void {
        const message = error instanceof Error
            ? error.message
            : String(error);
        this.options.log?.(`[Codetether] ${prefix}: ${message}`);
    }
}
