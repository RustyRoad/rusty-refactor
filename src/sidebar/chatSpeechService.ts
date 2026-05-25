import { ChildProcess, spawn } from 'child_process';

import { ChatWorkerLocator } from './chatWorkerLocator';

/**
 * Installed voice exposed by the Rust speech worker.
 */
export interface ChatSpeechVoice {
    id: string;
    name: string;
    natural: boolean;
}

/**
 * State update emitted when speech starts, stops, or fails.
 */
export interface ChatSpeechState {
    messageId: string;
    speaking: boolean;
    supported: boolean;
    error?: string;
}

/**
 * Callback used to publish speech state changes to the chat webview.
 */
export type ChatSpeechStateSink = (state: ChatSpeechState) => void;

/**
 * Runs text-to-speech from the extension host process.
 */
export class ChatSpeechService {
    private child: ChildProcess | undefined;
    private activeMessageId = '';
    private readonly workerLocator: ChatWorkerLocator;

    public constructor(
        extensionPath: string,
        private readonly sink: ChatSpeechStateSink
    ) {
        this.workerLocator = new ChatWorkerLocator(extensionPath);
    }

    /**
     * Returns whether this platform has a known local speech command.
     */
    public isSupported(): boolean {
        return process.platform === 'win32'
            && Boolean(this.workerPath());
    }

    /**
     * Starts reading one assistant response aloud.
     */
    public speak(messageId: string, text: string, voiceId = ''): void {
        const prepared = this.prepareText(text);
        if (!messageId || !prepared) {
            this.emitStopped(messageId, 'No response text to read.');
            return;
        }

        if (!this.isSupported()) {
            this.emitStopped(messageId, 'Text to speech is unsupported here.');
            return;
        }

        this.stop();
        this.activeMessageId = messageId;
        this.emit({ messageId, speaking: true, supported: true });

        try {
            this.child = this.spawnSpeechProcess(prepared, voiceId);
            this.child.once('exit', () => this.handleExit(messageId));
            this.child.once('error', error => {
                this.handleError(messageId, error);
            });
        } catch (error) {
            this.handleError(messageId, error);
        }
    }

    /**
     * Stops any active speech process.
     */
    public stop(): void {
        if (!this.child) {
            this.emitStopped(this.activeMessageId);
            return;
        }

        const child = this.child;
        this.child = undefined;
        this.activeMessageId = '';
        try {
            child.kill();
        } catch {
            // Best-effort cancellation; the exit handler also clears state.
        }
        this.emitStopped('');
    }

    /**
     * Stops speech and releases process state during extension disposal.
     */
    public dispose(): void {
        this.stop();
    }

    /**
     * Emits the current platform support status to the webview.
     */
    public emitSupportStatus(): void {
        this.emit({
            messageId: this.activeMessageId,
            speaking: Boolean(this.child),
            supported: this.isSupported(),
        });
    }

    /**
     * Lists installed voices from the native Rust worker.
     */
    public async listVoices(): Promise<ChatSpeechVoice[]> {
        if (!this.isSupported()) {
            return [];
        }

        try {
            const raw = await this.runWorkerJson(['tts-voices']);
            const parsed = JSON.parse(raw) as ChatSpeechVoice[];
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    /**
     * Creates the Rust speech worker process and writes text to stdin.
     */
    private spawnSpeechProcess(text: string, voiceId: string): ChildProcess {
        const command = this.workerCommand(voiceId);
        const child = spawn(command.exe, command.args, {
            stdio: ['pipe', 'ignore', 'pipe'],
            windowsHide: true,
        });

        child.stderr?.on('data', () => {
            // Stderr is intentionally ignored here; spawn errors are handled
            // through the process error and exit events.
        });
        child.stdin?.end(text);
        return child;
    }

    /**
     * Returns the executable and args for the Rust speech worker.
     */
    private workerCommand(voiceId = ''): { exe: string; args: string[] } {
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
     * Runs the Rust worker and resolves with stdout text.
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
                reject(new Error(stderr.trim() || `worker exited ${code}`));
            });
        });
    }

    /**
     * Returns the packaged Rust worker executable path when it exists.
     */
    private workerPath(): string | undefined {
        return this.workerLocator.workerPath();
    }

    /**
     * Normalizes large assistant responses before sending them to TTS.
     */
    private prepareText(text: string): string {
        return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 20000);
    }

    /**
     * Clears active state after a speech process exits.
     */
    private handleExit(messageId: string): void {
        if (messageId !== this.activeMessageId) {
            return;
        }

        this.child = undefined;
        this.activeMessageId = '';
        this.emitStopped(messageId);
    }

    /**
     * Reports a speech process failure to the webview.
     */
    private handleError(messageId: string, error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        this.child = undefined;
        this.activeMessageId = '';
        this.emitStopped(messageId, message);
    }

    /**
     * Emits a non-speaking state, optionally with an error.
     */
    private emitStopped(messageId: string, error?: string): void {
        this.emit({
            messageId,
            speaking: false,
            supported: this.isSupported(),
            error,
        });
    }

    /**
     * Sends one speech state update to the configured sink.
     */
    private emit(state: ChatSpeechState): void {
        this.sink(state);
    }
}
