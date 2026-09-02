const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const companionDir = path.join(rootDir, 'audio-companion');
const packagePath = path.join(companionDir, 'package.json');
const timestampPattern = /(?:\.\d{8}T\d{6})+$/;

/**
 * Returns a UTC package suffix that remains valid SemVer metadata.
 */
function timestamp() {
    const now = new Date();
    const pad = value => String(value).padStart(2, '0');
    const day = [
        now.getUTCFullYear(),
        pad(now.getUTCMonth() + 1),
        pad(now.getUTCDate()),
    ].join('');
    const time = [
        pad(now.getUTCHours()),
        pad(now.getUTCMinutes()),
        pad(now.getUTCSeconds()),
    ].join('');
    return `${day}T${time}`;
}

/**
 * Copies the current Windows worker into the isolated companion package.
 */
function copyWorker() {
    const source = path.join(
        rootDir,
        'rust-backend',
        'target',
        'release',
        'rusty_refactor_worker.exe'
    );
    const target = path.join(
        companionDir,
        'rust-backend',
        'target',
        'release',
        'rusty_refactor_worker.exe'
    );
    if (!fs.existsSync(source)) {
        throw new Error('Build the Windows Rust worker before packaging.');
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
}

/**
 * Runs VSCE from the repository dependency while isolating package files.
 */
function packageCompanion(version) {
    const executable = process.platform === 'win32'
        ? 'vsce.cmd'
        : 'vsce';
    const vsce = path.join(rootDir, 'node_modules', '.bin', executable);
    const output = path.join(
        rootDir,
        `rusty-refactor-audio-${version}.vsix`
    );
    const result = spawnSync(vsce, ['package', '--out', output], {
        cwd: companionDir,
        stdio: 'inherit',
        shell: process.platform === 'win32',
    });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        process.exit(result.status || 1);
    }
}

/**
 * Stamps, packages, and restores the companion manifest atomically.
 */
function main() {
    const original = fs.readFileSync(packagePath, 'utf8');
    const manifest = JSON.parse(original);
    const base = manifest.version.replace(timestampPattern, '');
    const version = `${base}-alpha-dev.${timestamp()}`;
    manifest.version = version;
    copyWorker();

    try {
        fs.writeFileSync(
            packagePath,
            `${JSON.stringify(manifest, null, 2)}\n`
        );
        packageCompanion(version);
    } finally {
        fs.writeFileSync(packagePath, original);
    }
}

main();
