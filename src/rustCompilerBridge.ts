import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';
import * as vscode from 'vscode';

const execFile = util.promisify(cp.execFile);

export interface WorkerResult {
    file: string;
    suggested_imports: string[];
    external_crates: Array<{ name: string; version: string }>;
    diagnostics: Array<{
        level: string;
        message: string;
        span?: {
            line_start: number;
            line_end: number;
            column_start: number;
            column_end: number;
        };
    }>;
    unresolved_types: string[];
}

async function buildWorker(workspaceRoot: string): Promise<void> {
    const rustFolder = path.join(workspaceRoot, 'rust-backend');

    if (!fs.existsSync(rustFolder)) {
        throw new Error('Rust backend folder not found in workspace');
    }

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Building Rust analysis worker...',
        cancellable: false
    }, async () => {
        return new Promise<void>((resolve, reject) => {
            const cargo = cp.spawn('cargo', ['build', '--release'], {
                cwd: rustFolder,
                env: process.env
            });

            cargo.stdout?.on('data', (chunk) => {
                console.log('[cargo]', chunk.toString());
            });
            cargo.stderr?.on('data', (chunk) => {
                console.error('[cargo]', chunk.toString());
            });

            cargo.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`cargo build failed with exit code ${code}`));
                }
            });

            cargo.on('error', (err) => {
                reject(err);
            });
        });
    });
}

function getBinaryPath(workspaceRoot: string): string | null {
    const binName = process.platform === 'win32' ? 'rusty_refactor_worker.exe' : 'rusty_refactor_worker';
    const releasePath = path.join(workspaceRoot, 'rust-backend', 'target', 'release', binName);
    const debugPath = path.join(workspaceRoot, 'rust-backend', 'target', 'debug', binName);

    if (fs.existsSync(releasePath)) {
        return releasePath;
    }
    if (fs.existsSync(debugPath)) {
        return debugPath;
    }
    return null;
}

export async function suggestImportsForFile(filePath: string): Promise<string[] | null> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        throw new Error('No workspace folder found');
    }
    const workspaceRoot = workspaceFolder.uri.fsPath;

    let binary = getBinaryPath(workspaceRoot);
    if (!binary) {
        try {
            await buildWorker(workspaceRoot);
        } catch (err) {
            console.error('Failed to build Rust worker:', err);
            vscode.window.showErrorMessage('Failed to build Rust analysis worker. Ensure Rust toolchain is installed.');
            return null;
        }
        binary = getBinaryPath(workspaceRoot);
        if (!binary) {
            return null;
        }
    }

    try {
        const { stdout, stderr } = await execFile(binary, ['--workspace-root', workspaceRoot, '--file', filePath], { timeout: 1000 * 60 * 2 });
        if (stderr && stderr.trim().length > 0) {
            console.error('Rust worker stderr:', stderr);
        }

        const parsed: WorkerResult = JSON.parse(stdout || '{}');
        
        // Log additional information
        if (parsed.external_crates && parsed.external_crates.length > 0) {
            console.log('External crates detected:', parsed.external_crates.map(c => c.name).join(', '));
        }
        if (parsed.unresolved_types && parsed.unresolved_types.length > 0) {
            console.log('Unresolved types found:', parsed.unresolved_types.join(', '));
        }
        if (parsed.diagnostics && parsed.diagnostics.length > 0) {
            const errorCount = parsed.diagnostics.filter(d => d.level === 'error').length;
            const warningCount = parsed.diagnostics.filter(d => d.level === 'warning').length;
            console.log(`Compiler diagnostics: ${errorCount} errors, ${warningCount} warnings`);
        }

        return parsed.suggested_imports || null;

    } catch (err) {
        console.error('Error executing Rust worker:', err);
        vscode.window.showErrorMessage('Error running Rust analysis worker. Check the developer console for details.');
        return null;
    }
}
