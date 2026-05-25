const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const sourcePath = path.join(
    rootDir,
    'webview-src',
    'codetether-chat',
    'state.tether',
);

/**
 * Resolves the TetherScript executable used for chat state generation.
 *
 * @returns {string} Executable path or command name to run.
 */
function tetherscriptBin() {
    return process.env.TETHERSCRIPT_BIN || 'tetherscript';
}

/**
 * Runs the repository-local TetherScript chat state generator.
 *
 * @returns {void}
 */
function generateChatState() {
    const result = spawnSync(
        tetherscriptBin(),
        ['run', '--grant-fs', rootDir, sourcePath],
        {
            cwd: rootDir,
            stdio: 'inherit',
            shell: false,
        },
    );

    if (result.error) {
        throw result.error;
    }

    if (typeof result.status === 'number' && result.status !== 0) {
        process.exit(result.status);
    }
}

generateChatState();
