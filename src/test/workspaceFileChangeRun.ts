import * as path from 'path';

import Mocha from 'mocha';

/**
 * Resolves or rejects one focused Mocha run from its failure count.
 */
function runMocha(mocha: Mocha): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        mocha.run(failures => {
            if (failures > 0) {
                reject(new Error(`${failures} tests failed.`));
                return;
            }
            resolve();
        });
    });
}

/**
 * Runs only the real VS Code workspace file-watcher integration test.
 */
export async function run(): Promise<void> {
    const mocha = new Mocha({
        ui: 'tdd',
        color: true,
        timeout: 10_000
    });
    mocha.addFile(path.resolve(
        __dirname,
        'suite/workspaceFileChangeService.test.js'
    ));
    await runMocha(mocha);
}
