import WebSocket from 'ws';

const CANCEL_CLOSE_TIMEOUT_MS = 2_000;

/**
 * Receives notification after a cancelled socket has stopped locally.
 */
export type CodetetherCancellationSink = () => void;

/**
 * Delivers cancellation without allowing a queued prompt to start later.
 */
export class CodetetherRealtimeCancellation {
    private cancelTimer: NodeJS.Timeout | undefined;
    private cancelling = false;
    private sink: CodetetherCancellationSink | undefined;

    /**
     * Creates cancellation state for one socket and optional abort signal.
     */
    public constructor(
        private readonly socket: WebSocket,
        private readonly signal?: AbortSignal
    ) {}

    /**
     * Starts observing aborts and reports when local transport work has ended.
     */
    public start(sink: CodetetherCancellationSink): void {
        this.sink = sink;
        this.signal?.addEventListener('abort', this.abort, { once: true });
        if (this.signal?.aborted) {
            this.abort();
        }
    }

    /**
     * Returns whether the user has requested cancellation for this turn.
     */
    public requested(): boolean {
        return this.cancelling;
    }

    /**
     * Terminates a socket that cannot complete the cancellation handshake.
     */
    public forceStop(): void {
        if (this.socket.readyState !== WebSocket.CLOSED) {
            this.socket.terminate();
        }
        this.notifyStopped();
    }

    /**
     * Releases the signal listener and bounded cancellation timer.
     */
    public dispose(): void {
        if (this.cancelTimer) {
            clearTimeout(this.cancelTimer);
            this.cancelTimer = undefined;
        }
        this.signal?.removeEventListener('abort', this.abort);
        this.sink = undefined;
    }

    /**
     * Chooses safe cancellation based on the current socket state.
     */
    private readonly abort = (): void => {
        if (this.cancelling) {
            return;
        }
        this.cancelling = true;
        if (this.socket.readyState === WebSocket.OPEN) {
            this.sendCancel();
            return;
        }
        this.forceStop();
    };

    /**
     * Flushes the server cancel frame before waiting for server closure.
     */
    private sendCancel(): void {
        this.cancelTimer = setTimeout(
            () => this.forceStop(),
            CANCEL_CLOSE_TIMEOUT_MS
        );
        this.socket.send(
            JSON.stringify({ type: 'cancel' }),
            error => {
                if (error) {
                    this.forceStop();
                }
            }
        );
    }

    /**
     * Notifies the owner once while preserving cancellation state.
     */
    private notifyStopped(): void {
        const sink = this.sink;
        this.sink = undefined;
        sink?.();
    }
}