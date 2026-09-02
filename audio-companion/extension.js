const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

const cancelCommand = 'rustyRefactor.audio.cancel';
const captureCommand = 'rustyRefactor.audio.capture';
const statusCommand = 'rustyRefactor.audio.status';

/**
 * Owns the Windows speech worker used by one microphone capture.
 */
class AudioCapture {
    /**
     * Creates an idle capture coordinator rooted in this UI extension.
     */
    constructor(extensionPath, output) {
        this.extensionPath = extensionPath;
        this.output = output;
        this.child = undefined;
        this.resolve = undefined;
        this.reject = undefined;
        this.stdout = '';
        this.stderr = '';
        this.cancelled = false;
    }

    /**
     * Reports whether the packaged Windows speech worker is available.
     */
    status() {
        return process.platform === 'win32'
            && fs.existsSync(this.workerPath());
    }

    /**
     * Starts one default-microphone recognition attempt.
     */
    capture() {
        if (!this.status()) {
            return Promise.reject(new Error(
                'The Windows audio companion is unavailable.'
            ));
        }
        if (this.child) {
            return Promise.reject(new Error(
                'Windows voice input is already listening.'
            ));
        }

        return new Promise(this.startProcess.bind(this));
    }

    /**
     * Cancels an active worker without treating user cancellation as failure.
     */
    cancel() {
        this.cancelled = true;
        this.child?.kill();
    }

    /**
     * Stops active capture when the UI extension is disposed.
     */
    dispose() {
        this.cancel();
    }

    /**
     * Spawns the worker after Promise callbacks have been installed.
     */
    startProcess(resolve, reject) {
        this.resolve = resolve;
        this.reject = reject;
        this.stdout = '';
        this.stderr = '';
        this.cancelled = false;
        this.output.appendLine('Starting default Windows microphone.');
        this.child = spawn(this.workerPath(), ['stt'], {
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        this.child.stdout.on('data', this.appendStdout.bind(this));
        this.child.stderr.on('data', this.appendStderr.bind(this));
        this.child.once('error', this.handleError.bind(this));
        this.child.once('exit', this.handleExit.bind(this));
    }

    /**
     * Buffers structured worker output until recognition completes.
     */
    appendStdout(data) {
        this.stdout += data.toString();
    }

    /**
     * Buffers native diagnostics for a concise command failure.
     */
    appendStderr(data) {
        this.stderr += data.toString();
    }

    /**
     * Rejects capture when the worker cannot be launched.
     */
    handleError(error) {
        this.finish(undefined, error);
    }

    /**
     * Converts a successful worker exit into the cross-host command result.
     */
    handleExit(code) {
        if (this.cancelled) {
            this.finish(undefined, new Error('Voice input was cancelled.'));
            return;
        }
        if (code !== 0) {
            const detail = this.stderr.trim() || `worker exited ${code}`;
            this.finish(undefined, new Error(detail));
            return;
        }

        try {
            const result = JSON.parse(this.stdout.trim());
            this.output.appendLine('Windows microphone recognized speech.');
            this.finish(result);
        } catch (error) {
            this.finish(undefined, error);
        }
    }

    /**
     * Settles capture once and clears process-owned state.
     */
    finish(result, error) {
        const resolve = this.resolve;
        const reject = this.reject;
        this.child = undefined;
        this.resolve = undefined;
        this.reject = undefined;
        if (error) {
            this.output.appendLine(`Voice input failed: ${error.message}`);
            reject?.(error);
            return;
        }
        resolve?.(result);
    }

    /**
     * Locates the Windows worker bundled inside this companion VSIX.
     */
    workerPath() {
        return path.join(
            this.extensionPath,
            'rust-backend',
            'target',
            'release',
            'rusty_refactor_worker.exe'
        );
    }
}

/**
 * Registers commands that bridge the workspace host to Windows speech.
 */
function activate(context) {
    const output = vscode.window.createOutputChannel(
        'Rusty Refactor Audio'
    );
    const capture = new AudioCapture(context.extensionPath, output);
    context.subscriptions.push(
        output,
        capture,
        vscode.commands.registerCommand(
            statusCommand,
            capture.status.bind(capture)
        ),
        vscode.commands.registerCommand(
            captureCommand,
            capture.capture.bind(capture)
        ),
        vscode.commands.registerCommand(
            cancelCommand,
            capture.cancel.bind(capture)
        )
    );
}

/**
 * Leaves disposal to the subscriptions owned by the extension context.
 */
function deactivate() {}

module.exports = { activate, deactivate };
