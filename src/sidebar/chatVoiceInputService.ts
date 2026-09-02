import {
    ChatVoiceInputProcess,
    ChatVoiceInputProcessResult
} from './chatVoiceInputProcess';
import { ChatVoiceInputCommand } from './chatVoiceInputCommand';
import {
    compactVoiceInputError,
    isVoiceInputCancellation
} from './chatVoiceInputError';
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
    private commandActive = false;
    private commandSupported = false;
    private selectedInputId = defaultInputSource.id;

    /**
     * Creates a service that reports speech state and recognized text.
     */
    public constructor(
        private readonly workerPath: string | undefined,
        private readonly stateSink: ChatVoiceInputStateSink,
        private readonly resultSink: ChatVoiceInputResultSink,
        private readonly command: Pick<
            ChatVoiceInputCommand,
            'isSupported' | 'capture' | 'cancel'
        > = new ChatVoiceInputCommand()
    ) {}

    /**
     * Returns whether this platform has a known local speech command.
     */
    public isSupported(): boolean {
        return this.nativeSupported() || this.commandSupported;
    }

    /**
     * Starts one microphone recognition attempt.
     */
    public async start(): Promise<void> {
        if (this.process || this.commandActive) {
            return;
        }

        const worker = this.workerPath;
        if (this.nativeSupported() && worker) {
            this.startNative(worker);
            return;
        }

        this.commandSupported = await this.command.isSupported();
        if (!this.commandSupported) {
            this.emitStopped('Voice input is unsupported here.');
            return;
        }

        await this.startCommand();
    }

    /**
     * Starts a Windows worker in the current extension host.
     */
    private startNative(worker: string): void {
        this.emit({ listening: true, supported: true });
        this.process = new ChatVoiceInputProcess(worker, result => {
            this.handleProcessResult(result);
        });
    }

    /**
     * Stops active microphone recognition if it is still running.
     */
    public async stop(): Promise<void> {
        const activeProcess = this.process;
        this.process = undefined;
        activeProcess?.stop();

        if (this.commandActive) {
            this.commandActive = false;
            try {
                await this.command.cancel();
            } catch {
                // Cancellation is best-effort across extension hosts.
            }
        }

        this.emitStopped();
    }

    /**
     * Updates the input source that future recognition attempts should use.
     */
    public setInput(inputId: string): void {
        this.selectedInputId = this.normalizedInputId(inputId);
        void this.emitSupportStatus();
    }

    /**
     * Emits the current platform support status to the webview.
     */
    public async emitSupportStatus(): Promise<void> {
        this.commandSupported = await this.command.isSupported();
        this.emit({
            listening: Boolean(this.process) || this.commandActive,
            supported: this.isSupported(),
        });
    }

    /**
     * Waits for one capture from the local Windows UI companion.
     */
    private async startCommand(): Promise<void> {
        this.commandActive = true;
        this.emit({ listening: true, supported: true });

        try {
            const result = await this.command.capture();
            if (this.commandActive) {
                this.resultSink(result);
            }
        } catch (error) {
            if (this.commandActive) {
                this.commandActive = false;
                this.emitStopped(
                    isVoiceInputCancellation(error)
                        ? undefined
                        : compactVoiceInputError(error)
                );
            }
            return;
        }

        this.commandActive = false;
        this.emitStopped();
    }

    /**
     * Converts a completed worker process into webview notifications.
     */
    private handleProcessResult(result: ChatVoiceInputProcessResult): void {
        this.process = undefined;
        if (result.error && isVoiceInputCancellation(result.error)) {
            this.emitStopped();
            return;
        }

        const error = result.error
            ? compactVoiceInputError(result.error)
            : this.emptyResultError(result);
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

    /**
     * Returns whether this extension host can launch the Windows worker.
     */
    private nativeSupported(): boolean {
        return process.platform === 'win32' && Boolean(this.workerPath);
    }

}
