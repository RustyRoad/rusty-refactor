/**
 * Persists connection details for extension-managed Codetether servers.
 */

export const CODE_TETHER_SERVER_SECRET_KEY =
    'rustyRefactor.codeTether.serverUrl';
export const CODE_TETHER_TOKEN_SECRET_KEY =
    'rustyRefactor.codeTether.token';

const LEGACY_SERVER_SECRET_KEY =
    'rustyRefactor.codetetherServer';
const LEGACY_TOKEN_SECRET_KEY =
    'rustyRefactor.codetetherToken';

/**
 * Describes the secure storage operations needed for managed sessions.
 */
export interface CodetetherManagedSessionSecretStore {
    store(key: string, value: string): Thenable<void>;
    delete(key: string): Thenable<void>;
}

/**
 * Owns the current and legacy secret keys for one managed server session.
 */
export class CodetetherManagedSessionStore {
    /**
     * Creates a managed-session store around extension SecretStorage.
     */
    public constructor(
        private readonly secrets: CodetetherManagedSessionSecretStore
    ) {}

    /**
     * Stores one URL/token pair under current and compatibility keys.
     */
    public async store(serverUrl: string, token: string): Promise<void> {
        await Promise.all([
            this.secrets.store(
                CODE_TETHER_SERVER_SECRET_KEY,
                serverUrl
            ),
            this.secrets.store(
                CODE_TETHER_TOKEN_SECRET_KEY,
                token
            ),
            this.secrets.store(LEGACY_SERVER_SECRET_KEY, serverUrl),
            this.secrets.store(LEGACY_TOKEN_SECRET_KEY, token)
        ]);
    }

    /**
     * Removes managed connection details after provider auth changes.
     *
     * Explicit URLs and tokens in settings or environment variables are not
     * stored here and remain untouched.
     */
    public async clear(): Promise<void> {
        await Promise.all([
            this.secrets.delete(CODE_TETHER_SERVER_SECRET_KEY),
            this.secrets.delete(CODE_TETHER_TOKEN_SECRET_KEY),
            this.secrets.delete(LEGACY_SERVER_SECRET_KEY),
            this.secrets.delete(LEGACY_TOKEN_SECRET_KEY)
        ]);
    }
}
