const path = require('path');
const { spawnSync } = require('child_process');

const scriptsDirectory = __dirname;

/**
 * Runs one package script and preserves its terminal output and exit code.
 */
function run(scriptName) {
    const result = spawnSync(
        process.execPath,
        [path.join(scriptsDirectory, scriptName)],
        { stdio: 'inherit' }
    );
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        process.exit(result.status || 1);
    }
}

run('package-dev.js');
run('package-audio-companion.js');
