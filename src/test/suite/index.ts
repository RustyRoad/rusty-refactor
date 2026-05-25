import * as path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';

/**
 * Discovers and runs compiled extension integration tests with Mocha.
 */
export async function run(): Promise<void> {
    const mocha = new Mocha({
        ui: 'tdd',
        color: true,
        timeout: 30_000,
    });
    const testsRoot = path.resolve(__dirname, '..');
    const files = await glob('**/*.test.js', { cwd: testsRoot });

    for (const file of files) {
        mocha.addFile(path.resolve(testsRoot, file));
    }

    await new Promise<void>((resolve, reject) => {
        try {
            mocha.run((failures) => {
                if (failures > 0) {
                    reject(new Error(`${failures} tests failed.`));
                    return;
                }

                resolve();
            });
        } catch (error) {
            reject(error);
        }
    });
}
