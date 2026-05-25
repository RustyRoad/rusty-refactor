import * as path from 'path';

import { runTests } from '@vscode/test-electron';

/**
 * Launches the VS Code extension host and runs integration tests.
 */
async function main(): Promise<void> {
    try {
        const extensionDevelopmentPath = path.resolve(__dirname, '../..');
        const extensionTestsPath = path.resolve(__dirname, './suite/index');

        await runTests({
            version: 'insiders',
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [
                extensionDevelopmentPath,
                '--disable-extensions',
            ],
        });
    } catch (error) {
        console.error(error);
        console.error('Failed to run extension integration tests.');
        process.exit(1);
    }
}

void main();
