import * as path from 'path';

import { runTests } from '@vscode/test-electron';

/**
 * Launches a real VS Code extension host and runs integration tests.
 *
 * The parent terminal may itself run inside Electron. Removing its Node-mode
 * flag ensures the child executable starts VS Code instead of plain Node.
 */
async function main(): Promise<void> {
    try {
        delete process.env.ELECTRON_RUN_AS_NODE;

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
