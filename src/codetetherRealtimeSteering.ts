import WebSocket from 'ws';

interface PendingSteering {
    resolve(accepted: boolean): void;
    timer: NodeJS.Timeout;
}

/**
 * Correlates steering commands with acknowledgements on one socket.
 */
export class CodetetherRealtimeSteering {
    private sequence = 0;
    private readonly pending = new Map<string, PendingSteering>();

    /**
     * Creates a steering channel around one active WebSocket.
     */
    public constructor(private readonly socket: WebSocket) {}

    /**
     * Sends one instruction and resolves when the server accepts it.
     */
    public send(message: string): Promise<boolean> {
        if (this.socket.readyState !== WebSocket.OPEN) {
            return Promise.resolve(false);
        }
        this.sequence += 1;
        const requestId = `steer-${this.sequence}`;
        return new Promise(resolve => {
            const timer = setTimeout(() => {
                this.pending.delete(requestId);
                resolve(false);
            }, 5_000);
            this.pending.set(requestId, { resolve, timer });
            this.socket.send(JSON.stringify({
                type: 'steer',
                request_id: requestId,
                message
            }));
        });
    }

    /**
     * Resolves the steering request named by one server acknowledgement.
     */
    public acknowledge(requestId: string, accepted: boolean): void {
        const pending = this.pending.get(requestId);
        if (!pending) {
            return;
        }
        clearTimeout(pending.timer);
        this.pending.delete(requestId);
        pending.resolve(accepted);
    }

    /**
     * Releases every request when its socket can no longer acknowledge it.
     */
    public close(): void {
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.resolve(false);
        }
        this.pending.clear();
    }
}
