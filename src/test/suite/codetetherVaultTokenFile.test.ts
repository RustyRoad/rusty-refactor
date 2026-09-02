import * as assert from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
    readCodetetherVaultTokenFile
} from '../../codetetherVaultTokenFile';

/**
 * Creates one isolated path for native Vault token file tests.
 */
async function createTestDirectory(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'codetether-vault-'));
}

/**
 * Verifies surrounding whitespace never enters a child environment.
 */
async function trimsNativeToken(): Promise<void> {
    const directory = await createTestDirectory();
    const tokenPath = path.join(directory, 'vault-token');
    try {
        await fs.writeFile(tokenPath, '  native-token\r\n', 'utf8');
        const token = await readCodetetherVaultTokenFile(tokenPath);
        assert.strictEqual(token, 'native-token');
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
}

/**
 * Verifies first-time installations can run without a token file.
 */
async function allowsMissingNativeToken(): Promise<void> {
    const directory = await createTestDirectory();
    try {
        const token = await readCodetetherVaultTokenFile(
            path.join(directory, 'missing-token')
        );
        assert.strictEqual(token, undefined);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
}

/**
 * Registers native Vault token file tests with Mocha's TDD interface.
 */
function defineVaultTokenFileTests(): void {
    test('trims the native CLI token', trimsNativeToken);
    test('allows a missing native CLI token', allowsMissingNativeToken);
}

suite('Codetether Vault token file', defineVaultTokenFileTests);
