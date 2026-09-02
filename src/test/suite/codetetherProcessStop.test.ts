import * as assert from 'assert';
import { ChildProcess, spawn } from 'child_process';

import { forceStopCodetetherProcess } from '../../codetetherProcessStop';

interface TestProcessTree {
    childPid: number;
    parent: ChildProcess;
}

/**
 * Starts a disposable Node process with one long-running descendant.
 */
async function startTestProcessTree(): Promise<TestProcessTree> {
    const script = [
        "const { spawn } = require('child_process');",
        'const child = spawn(process.execPath,',
        "['-e', 'setInterval(() => {}, 1000)'],",
        "{ stdio: 'ignore' });",
        "process.stdout.write(String(child.pid) + '\\n');",
        'setInterval(() => {}, 1000);'
    ].join('');
    const parent = spawn(process.execPath, ['-e', script], {
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true
    });
    const childPid = await readChildPid(parent);
    return { childPid, parent };
}

/**
 * Reads the descendant pid announced by the disposable parent process.
 */
function readChildPid(parent: ChildProcess): Promise<number> {
    return new Promise((resolve, reject) => {
        const output = parent.stdout;
        if (!output) {
            reject(new Error('Test process did not expose stdout.'));
            return;
        }
        output.once('data', chunk => {
            const pid = Number(String(chunk).trim());
            if (!Number.isInteger(pid) || pid <= 0) {
                reject(new Error('Test process returned an invalid pid.'));
                return;
            }
            resolve(pid);
        });
        parent.once('error', reject);
    });
}

/**
 * Returns whether an operating-system process still accepts signal probes.
 */
function processIsAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/**
 * Waits for a process to disappear from the operating-system process table.
 */
async function waitForProcessStop(pid: number): Promise<void> {
    const deadline = Date.now() + 2_000;
    while (processIsAlive(pid) && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 25));
    }
}

/**
 * Best-effort cleanup protects later tests if an assertion fails.
 */
function cleanTestProcess(pid: number): void {
    if (!processIsAlive(pid)) {
        return;
    }
    try {
        process.kill(pid, 'SIGKILL');
    } catch {
        // The process stopped between the liveness probe and cleanup signal.
    }
}

/**
 * Verifies hard cancellation removes both server and descendant work.
 */
async function stopsCompleteProcessTree(): Promise<void> {
    const tree = await startTestProcessTree();
    const parentPid = tree.parent.pid || 0;
    try {
        await forceStopCodetetherProcess(tree.parent);
        await waitForProcessStop(tree.childPid);
        assert.strictEqual(processIsAlive(parentPid), false);
        assert.strictEqual(processIsAlive(tree.childPid), false);
    } finally {
        cleanTestProcess(parentPid);
        cleanTestProcess(tree.childPid);
    }
}

/**
 * Registers managed CodeTether process-tree cancellation tests.
 */
function defineCodetetherProcessStopTests(): void {
    test('stops the complete process tree', stopsCompleteProcessTree);
}

suite('Codetether process stop', defineCodetetherProcessStopTests);