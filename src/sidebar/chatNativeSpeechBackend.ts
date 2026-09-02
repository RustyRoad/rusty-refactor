import { ChildProcess, spawn } from 'child_process';

import { ChatWorkerLocator } from './chatWorkerLocator';
import type { ChatSpeechVoice } from './chatSpeechTypes';

/**
 * Runs native speech through the packaged Windows worker.
 */
export class ChatNativeSpeechBackend {
    private child: ChildProcess | undefined;
    private readonly workerLocator: ChatWorkerLocator;

    /**
     * Binds worker discovery to one installed extension directory.
     */
    public constructor(extensionPath: string) {
        this.workerLocator = new ChatWorkerLocator(extensionPath);
    }

    /**
     * Returns whether this host can execute the packaged speech worker.
     */
    public isSupported(): boolean {
        return process.platform === 'win32'
            && Boolean(this.workerPath());
    }

    /**
     * Lists Windows voices reported by the packaged speech worker.
     */
    public async listVoices(): Promise<ChatSpeechVoice[]> {
        if (!this.isSupported()) {
            return [];
        }

        const raw = await this.runWorkerJson(['tts-voices']);
        const parsed = JSON.parse(raw) as ChatSpeechVoice[];
        return Array.isArray(parsed) ? parsed : [];
    }

    /**
     * Reads text aloud and resolves after native playback finishes.
     */
    public speak(text: string, voiceId: string): Promise<void> {
        this.stop();
        const command = this.workerCommand(voiceId);

        return new Promise((resolve, reject) => {
            const child = spawn(command.exe, command.args, {
                stdio: ['pipe', 'ignore', 'pipe'],
                windowsHide: true,
            });
            this.child = child;
            let stderr = '';
            child.stderr?.on('data', data => {
                stderr += data.toString();
            });
            child.once('error', reject);
            child.once('exit', code => {
                if (this.child === child) {
                    this.child = undefined;
                }
                if (code === 0) {
                    resolve();
                    return;
                }
                reject(new Error(
                    stderr.trim() || `speech worker exited ${code}`
                ));
            });
            child.stdin?.end(text);
        });
    }

    /**
     * Stops native playback without publishing presentation state.
     */
    public stop(): void {
        const child = this.child;
        this.child = undefined;
        if (!child) {
            return;
        }

        try {
            child.kill();
        } catch {
            // Cancellation is best effort because exit may race with stop.
        }
    }

    /**
     * Returns the executable and arguments for one speech request.
     */
    private workerCommand(
        voiceId: string
    ): { exe: string; args: string[] } {
        const worker = this.workerPath();
        if (!worker) {
            throw new Error('Rust TTS worker is missing from the extension.');
        }

        const args = ['tts'];
        if (voiceId) {
            args.push('--voice', voiceId);
        }
        return { exe: worker, args };
    }

    /**
     * Runs a worker metadata command and resolves with its JSON output.
     */
    private runWorkerJson(args: string[]): Promise<string> {
        const worker = this.workerPath();
        if (!worker) {
            return Promise.reject(
                new Error('Rust TTS worker is missing from the extension.')
            );
        }

        return new Promise((resolve, reject) => {
            const child = spawn(worker, args, {
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true,
            });
            let stdout = '';
            let stderr = '';
            child.stdout?.on('data', data => {
                stdout += data.toString();
            });
            child.stderr?.on('data', data => {
                stderr += data.toString();
            });
            child.once('error', reject);
            child.once('exit', code => {
                if (code === 0) {
                    resolve(stdout.trim());
                    return;
                }
                reject(new Error(
                    stderr.trim() || `speech worker exited ${code}`
                ));
            });
        });
    }

    /**
     * Returns the packaged worker path when the executable exists.
     */
    private workerPath(): string | undefined {
        return this.workerLocator.workerPath();
    }
}
