import * as assert from 'assert';

import {
    CodetetherManagedSessionSecretStore,
    CodetetherManagedSessionStore,
    CODE_TETHER_SERVER_SECRET_KEY,
    CODE_TETHER_TOKEN_SECRET_KEY
} from '../../codetetherManagedSession';
import {
    CodetetherVaultTokenManager,
    VaultTokenSecretStore
} from '../../codetetherVaultToken';

const LEGACY_SERVER_SECRET_KEY =
    'rustyRefactor.codetetherServer';
const LEGACY_TOKEN_SECRET_KEY =
    'rustyRefactor.codetetherToken';

/**
 * Records session mutations without depending on VS Code SecretStorage.
 */
interface TestIssuedVaultToken {
    token: string;
    lease: {
        renewable: boolean;
        ttlSeconds: number;
    };
}

interface MutableVaultTokenManager {
    login(credentials: unknown): Promise<TestIssuedVaultToken>;
}

class MemorySecretStore implements
    CodetetherManagedSessionSecretStore,
    VaultTokenSecretStore {
    public readonly values = new Map<string, string>();

    /**
     * Retrieves one stored value for AppRole credential loading.
     */
    public async get(key: string): Promise<string | undefined> {
        return this.values.get(key);
    }

    /**
     * Records one stored secret value for assertions.
     */
    public async store(key: string, value: string): Promise<void> {
        this.values.set(key, value);
    }

    /**
     * Removes one stored secret value for assertions.
     */
    public async delete(key: string): Promise<void> {
        this.values.delete(key);
    }
}

/**
 * Supplies an inert address because the login request is replaced in tests.
 */
function testVaultAddress(): string {
    return 'https://vault.invalid';
}

/**
 * Supplies the AppRole name used by the test manager.
 */
function testVaultRole(): string {
    return 'rusty-refactor-test';
}

/**
 * Issues deterministic lease metadata without contacting a Vault server.
 */
async function issueTestVaultToken(): Promise<TestIssuedVaultToken> {
    return {
        token: 'test-vault-token',
        lease: {
            renewable: false,
            ttlSeconds: 3_600
        }
    };
}

/**
 * Supplies the credential maintained by a local Codetether installation.
 */
async function readTestNativeVaultToken(): Promise<string> {
    return 'native-vault-token';
}

/**
 * Verifies that current and compatibility consumers see one session.
 */
async function storesAllSessionKeys(): Promise<void> {
    const secrets = new MemorySecretStore();
    const sessions = new CodetetherManagedSessionStore(secrets);

    await sessions.store('http://127.0.0.1:4203', 'bearer-token');

    assert.strictEqual(
        secrets.values.get(CODE_TETHER_SERVER_SECRET_KEY),
        'http://127.0.0.1:4203'
    );
    assert.strictEqual(
        secrets.values.get(CODE_TETHER_TOKEN_SECRET_KEY),
        'bearer-token'
    );
    assert.strictEqual(
        secrets.values.get(LEGACY_SERVER_SECRET_KEY),
        'http://127.0.0.1:4203'
    );
    assert.strictEqual(
        secrets.values.get(LEGACY_TOKEN_SECRET_KEY),
        'bearer-token'
    );
}

/**
 * Verifies that invalidation removes every managed discovery candidate.
 */
async function clearsAllSessionKeys(): Promise<void> {
    const secrets = new MemorySecretStore();
    const sessions = new CodetetherManagedSessionStore(secrets);

    await sessions.store('http://127.0.0.1:4203', 'bearer-token');
    await sessions.clear();

    assert.deepStrictEqual([...secrets.values.entries()], []);
}

/**
 * Verifies initial AppRole login retires the previous managed endpoint.
 */
async function clearsSessionAfterInitialVaultLogin(): Promise<void> {
    const secrets = new MemorySecretStore();
    const sessions = new CodetetherManagedSessionStore(secrets);
    await secrets.store(
        'rustyRefactor.codetetherVaultRoleId',
        'test-role-id'
    );
    await secrets.store(
        'rustyRefactor.codetetherVaultSecretId',
        'test-secret-id'
    );
    await sessions.store('http://127.0.0.1:4203', 'stale-token');

    const manager = new CodetetherVaultTokenManager(secrets, {
        address: testVaultAddress,
        roleName: testVaultRole,
        onTokenChanged: sessions.clear.bind(sessions)
    });
    const mutable = manager as unknown as MutableVaultTokenManager;
    mutable.login = issueTestVaultToken;

    await manager.initialize();
    const environment = await manager.environment({});
    manager.dispose();

    assert.strictEqual(environment.VAULT_TOKEN, 'test-vault-token');
    assert.strictEqual(
        secrets.values.has(CODE_TETHER_SERVER_SECRET_KEY),
        false
    );
    assert.strictEqual(
        secrets.values.has(CODE_TETHER_TOKEN_SECRET_KEY),
        false
    );
}

/**
 * Verifies the native CLI credential replaces a stale inherited token.
 */
async function usesNativeTokenWithoutAppRole(): Promise<void> {
    const secrets = new MemorySecretStore();
    const sessions = new CodetetherManagedSessionStore(secrets);
    await sessions.store('http://127.0.0.1:4203', 'stale-token');
    const manager = new CodetetherVaultTokenManager(secrets, {
        address: testVaultAddress,
        roleName: testVaultRole,
        localToken: readTestNativeVaultToken,
        onTokenChanged: sessions.clear.bind(sessions)
    });

    const environment = await manager.environment({
        VAULT_TOKEN: 'stale-ambient-token'
    });
    manager.dispose();

    assert.strictEqual(environment.VAULT_TOKEN, 'native-vault-token');
    assert.strictEqual(
        secrets.values.has(CODE_TETHER_SERVER_SECRET_KEY),
        false
    );
}

/**
 * Registers managed-session regression tests with Mocha's TDD interface.
 */
function defineManagedSessionTests(): void {
    test(
        'stores current and compatibility session keys',
        storesAllSessionKeys
    );
    test('clears every managed session key', clearsAllSessionKeys);
    test(
        'clears a stale session after initial Vault login',
        clearsSessionAfterInitialVaultLogin
    );
    test(
        'uses the native CLI token without AppRole credentials',
        usesNativeTokenWithoutAppRole
    );
}

suite('Codetether managed session store', defineManagedSessionTests);
