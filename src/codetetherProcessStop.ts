import { ChildProcess, spawn } from 'child_process';

const PROCESS_EXIT_TIMEOUT_MS = 2_000;

/**
 * Force-stops a managed CodeTether process and every descendant it spawned.
 *
 * POSIX managed servers are process-group leaders. Windows uses `taskkill`
 * because Node cannot signal a process tree directly there. The returned
 * promise is bounded so an uncooperative OS process cannot block a new turn.
 */
export async function forceStopCodetetherProcess(
    child: ChildProcess
): Promise<void> {
    const exited = waitForProcessExit(child);
    if (process.platform === 'win32') {
        forceStopWindowsTree(child);
    } else {
        forceStopPosixGroup(child);
    }
    await exited;
}

/**
 * Resolves after process exit or a bounded fallback timeout.
 */
function waitForProcessExit(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) {
        return Promise.resolve();
    }
    return new Promise(resolve => {
        let settled = false;
        const finish = (): void => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            child.removeListener('exit', finish);
            resolve();
        };
        const timer = setTimeout(finish, PROCESS_EXIT_TIMEOUT_MS);
        timer.unref();
        child.once('exit', finish);
    });
}

/**
 * Kills the detached POSIX process group, falling back to its leader.
 */
function forceStopPosixGroup(child: ChildProcess): void {
    if (!child.pid) {
        child.kill('SIGKILL');
        return;
    }
    try {
        process.kill(-child.pid, 'SIGKILL');
    } catch {
        child.kill('SIGKILL');
    }
}

/**
 * Uses the Windows tree-aware process terminator without opening a console.
 */
function forceStopWindowsTree(child: ChildProcess): void {
    if (!child.pid) {
        child.kill('SIGKILL');
        return;
    }
    const killer = spawn(
        'taskkill.exe',
        ['/pid', String(child.pid), '/t', '/f'],
        { stdio: 'ignore', windowsHide: true }
    );
    killer.unref();
}