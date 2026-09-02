const path = require('path');
const Mocha = require('mocha');

/**
 * Runs only the compiled open-chat command integration suite.
 *
 * @returns {Promise<void>} Resolves after Mocha reports zero failures.
 */
async function run() {
    const mocha = new Mocha({
        ui: 'tdd',
        color: true,
        timeout: 30_000,
    });
    mocha.addFile(path.resolve(
        __dirname,
        '..',
        'out',
        'test',
        'suite',
        'openChatCommand.test.js',
    ));

    await new Promise((resolve, reject) => {
        mocha.run((failures) => {
            if (failures > 0) {
                reject(new Error(`${failures} focused tests failed.`));
                return;
            }

            resolve();
        });
    });
}

module.exports = { run };