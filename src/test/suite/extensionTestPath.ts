import * as path from 'path';

const extensionRoot = path.resolve(__dirname, '..', '..', '..');

/**
 * Resolves a repository asset without depending on the test host directory.
 *
 * VS Code starts extension tests from its installation directory, so test
 * fixtures must be anchored to the compiled suite location.
 */
export function extensionTestPath(...segments: string[]): string {
    return path.join(extensionRoot, ...segments);
}
