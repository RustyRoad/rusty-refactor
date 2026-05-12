const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const packageJsonPath = path.join(rootDir, 'package.json');
const timestampSuffixPattern = /(?:\.\d{8}T\d{6})+$/;

function getTimestamp() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');

    return [
        now.getUTCFullYear(),
        pad(now.getUTCMonth() + 1),
        pad(now.getUTCDate())
    ].join('') + 'T' + [
        pad(now.getUTCHours()),
        pad(now.getUTCMinutes()),
        pad(now.getUTCSeconds())
    ].join('');
}

function normalizeBaseVersion(version) {
    return version.replace(timestampSuffixPattern, '');
}

function isValidSemVer(version) {
    return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version);
}

function runPackaging() {
    const vsceBin = path.join(rootDir, 'node_modules', '.bin', process.platform === 'win32' ? 'vsce.cmd' : 'vsce');
    const result = spawnSync(vsceBin, ['package'], {
        cwd: rootDir,
        stdio: 'inherit',
        shell: process.platform === 'win32'
    });

    if (result.error) {
        throw result.error;
    }

    if (typeof result.status === 'number' && result.status !== 0) {
        process.exit(result.status);
    }
}

const originalText = fs.readFileSync(packageJsonPath, 'utf8');
const packageJson = JSON.parse(originalText);
const baseVersion = normalizeBaseVersion(packageJson.version);

if (!isValidSemVer(baseVersion)) {
    throw new Error(`package.json version must be a valid SemVer base version. Found: ${baseVersion}`);
}

const stampedVersion = `${baseVersion}-alpha-dev.${getTimestamp()}`;
let restored = false;

function restorePackageJson() {
    if (restored) {
        return;
    }

    restored = true;
    fs.writeFileSync(packageJsonPath, originalText);
    console.log(`Restored package.json version to ${baseVersion}`);
}

process.on('SIGINT', () => {
    restorePackageJson();
    process.exit(130);
});

process.on('SIGTERM', () => {
    restorePackageJson();
    process.exit(143);
});

process.on('uncaughtException', (error) => {
    restorePackageJson();
    throw error;
});

process.on('exit', () => {
    restorePackageJson();
});

try {
    packageJson.version = stampedVersion;
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
    if (process.argv.includes('--dry-run')) {
        console.log(`Dry run version: ${stampedVersion}`);
    } else {
        console.log(`Packaging dev build with version ${stampedVersion}`);
        runPackaging();
    }
} finally {
    restorePackageJson();
}