import {
    ChatVoiceInputProcess,
    ChatVoiceInputProcessResult
} from './chatVoiceInputProcess';
import {
    ChatVoiceInputResultSink,
    ChatVoiceInputSource,
    ChatVoiceInputState,
    ChatVoiceInputStateSink
} from './chatVoiceInputTypes';

const defaultInputSource: ChatVoiceInputSource = {
    id: 'windows-default',
    label: 'Default Windows microphone',
};

/**
 * Runs one-shot speech-to-text from the extension host process.
 */
export class ChatVoiceInputService {
    private process: ChatVoiceInputProcess | undefined;
    private selectedInputId = defaultInputSource.id;

    /**
     * Creates a service that reports speech state and recognized text.
     */
    public constructor(
        private readonly workerPath: string | undefined,
        private readonly stateSink: ChatVoiceInputStateSink,
        private readonly resultSink: ChatVoiceInputResultSink
    ) {}

    /**
     * Returns whether this platform has a known local speech command.
     */
    public isSupported(): boolean {
        return process.platform === 'win32' && Boolean(this.workerPath);
    }

    /**
     * Starts one microphone recognition attempt.
     */
    public start(): void {
        if (this.process) {
            return;
        }

        const worker = this.workerPath;
        if (!this.isSupported() || !worker) {
            this.emitStopped('Voice input is unsupported here.');
            return;
        }

        this.emit({ listening: true, supported: true });
        this.process = new ChatVoiceInputProcess(worker, result => {
            this.handleProcessResult(result);
        });
    }

    /**
     * Stops active microphone recognition if it is still running.
     */
    public stop(): void {
        const activeProcess = this.process;
        if (!activeProcess) {
            this.emitStopped();
            return;
        }

        this.process = undefined;
        activeProcess.stop();
        this.emitStopped();
    }

    /**
     * Updates the input source that future recognition attempts should use.
     */
    public setInput(inputId: string): void {
        this.selectedInputId = this.normalizedInputId(inputId);
        this.emitSupportStatus();
    }

    /**
     * Emits the current platform support status to the webview.
     */
    public emitSupportStatus(): void {
        this.emit({
            listening: Boolean(this.process),
            supported: this.isSupported(),
        });
    }

    /**
     * Converts a completed worker process into webview notifications.
     */
    private handleProcessResult(result: ChatVoiceInputProcessResult): void {
        this.process = undefined;
        const error = result.error || this.emptyResultError(result);
        if (error) {
            this.emitStopped(error);
            return;
        }

        this.resultSink(result.result!);
        this.emitStopped();
    }

    /**
     * Returns an error when the worker completed without recognized text.
     */
    private emptyResultError(result: ChatVoiceInputProcessResult): string {
        return result.result?.text ? '' : 'Voice input returned no text.';
    }

    /**
     * Emits a non-listening state, optionally with an error.
     */
    private emitStopped(error?: string): void {
        this.emit({
            listening: false,
            supported: this.isSupported(),
            error,
        });
    }

    /**
     * Sends one microphone state update to the configured sink.
     */
    private emit(state: ChatVoiceInputState): void {
        this.stateSink({
            ...state,
            sources: this.inputSources(),
            selectedInputId: this.selectedInputId,
        });
    }

    /**
     * Returns the microphone sources supported by this backend.
     */
    private inputSources(): ChatVoiceInputSource[] {
        return [defaultInputSource];
    }

    /**
     * Falls back to the Windows default microphone for unknown ids.
     */
    private normalizedInputId(inputId: string): string {
        const value = inputId.trim();
        return this.inputSources().some(source => source.id === value)
            ? value
            : defaultInputSource.id;
    }
}
