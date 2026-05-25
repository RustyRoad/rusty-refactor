import { ChildProcess, spawn } from 'child_process';

import { ChatVoiceInputResult } from './chatVoiceInputTypes';

/**
 * Result produced after the native speech worker exits.
 */
export interface ChatVoiceInputProcessResult {
    result?: ChatVoiceInputResult;
    error?: string;
}

/**
 * Owns one spawned native speech recognition process.
 */
export class ChatVoiceInputProcess {
    private readonly child: ChildProcess;
    private stdout = '';
    private stderr = '';
    private completed = false;

    public constructor(
        workerPath: string,
        private readonly onDone: (
            result: ChatVoiceInputProcessResult
        ) => void
    ) {
        this.child = spawn(workerPath, ['stt'], {
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        this.bindEvents();
    }

    /**
     * Stops the worker when the user cancels recognition.
     */
    public stop(): void {
        try {
            this.child.kill();
        } catch {
            // Recognition cancellation is best-effort.
        }
    }

    /**
     * Captures output and completion events from the worker.
     */
    private bindEvents(): void {
        this.child.stdout?.on('data', data => {
            this.stdout += data.toString();
        });
        this.child.stderr?.on('data', data => {
            this.stderr += data.toString();
        });
        this.child.once('error', error => {
            this.finish({ error: this.errorMessage(error) });
        });
        this.child.once('exit', code => this.handleExit(code));
    }

    /**
     * Converts worker exit output into a state-independent result.
     */
    private handleExit(code: number | null): void {
        if (code !== 0) {
            this.finish({ error: this.exitError(code) });
            return;
        }

        try {
            this.finish({ result: this.parseResult() });
        } catch (error) {
            this.finish({ error: this.errorMessage(error) });
        }
    }

    /**
     * Delivers the process result once even if multiple child events fire.
     */
    private finish(result: ChatVoiceInputProcessResult): void {
        if (this.completed) {
            return;
        }

        this.completed = true;
        this.onDone(result);
    }

    /**
     * Returns stderr or a generic worker exit message.
     */
    private exitError(code: number | null): string {
        const raw = this.stderr.trim() || `worker exited ${code}`;
        return this.compactError(raw);
    }

    /**
     * Converts native worker stderr into a concise user-facing message.
     */
    private compactError(raw: string): string {
        if (raw.includes('speech privacy policy')) {
            return 'Enable Windows speech privacy before using voice input.';
        }

        return raw
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line && !this.isBacktraceLine(line))
            .slice(0, 4)
            .join(' ');
    }

    /**
     * Returns true for stack trace lines that should not reach the UI.
     */
    private isBacktraceLine(line: string): boolean {
        return line === 'Stack backtrace:' || /^\d+:/.test(line);
    }

    /**
     * Parses the worker JSON result into a stable object shape.
     */
    private parseResult(): ChatVoiceInputResult {
        const parsed = JSON.parse(this.stdout.trim()) as ChatVoiceInputResult;
        return {
            text: String(parsed.text || '').trim(),
            confidence: String(parsed.confidence || ''),
            status: String(parsed.status || ''),
        };
    }

    /**
     * Extracts a readable error from unknown thrown values.
     */
    private errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
