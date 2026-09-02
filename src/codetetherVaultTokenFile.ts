/**
 * Reads the Vault credential maintained for the local Codetether CLI.
 */

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Resolves the cross-platform location used by the Codetether CLI.
 */
export function codetetherVaultTokenFilePath(): string {
    return path.join(
        os.homedir(),
        '.config',
        'codetether',
        'vault-token'
    );
}

/**
 * Loads the native CLI token without treating a missing file as an error.
 *
 * Read failures other than a missing file remain visible because silently
 * dropping a configured credential would make child-process failures opaque.
 */
export async function readCodetetherVaultTokenFile(
    tokenPath: string = codetetherVaultTokenFilePath()
): Promise<string | undefined> {
    try {
        const token = (await fs.readFile(tokenPath, 'utf8')).trim();
        return token || undefined;
    } catch (error) {
        if (isMissingFileError(error)) {
            return undefined;
        }
        throw error;
    }
}

/**
 * Identifies the expected error when Codetether has no native token file.
 */
function isMissingFileError(error: unknown): boolean {
    return error instanceof Error
        && 'code' in error
        && error.code === 'ENOENT';
}
