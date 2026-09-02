import { createServer, IncomingMessage, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import type { Duplex } from 'stream';
import WebSocket, { RawData, WebSocketServer } from 'ws';

interface Deferred<T> {
    promise: Promise<T>;
    resolve(value: T): void;
}

/**
 * Configures transport timing needed by realtime protocol tests.
 */
export interface CodetetherRealtimeTestServerOptions {
    deferUpgrade?: boolean;
    closeOnCancel?: boolean;
    rejectUpgradeStatus?: number;
}

interface PendingUpgrade {
    request: IncomingMessage;
    socket: Duplex;
    head: Buffer;
}

/**
 * Provides a deterministic authenticated HTTP and WebSocket test endpoint.
 */
export class CodetetherRealtimeTestServer {
    public readonly token = 'test-token';
    public prompt = '';
    public steering = '';
    public authorization = '';
    public sessionTitle = '';
    public readonly clientFrames: string[] = [];
    public upgradeCount = 0;
    public connectionCount = 0;
    private readonly promptReceived = deferred<void>();
    private readonly cancelReceived = deferred<void>();
    private readonly clientClosed = deferred<void>();
    private readonly upgradeReceived = deferred<void>();
    private readonly clients = new Set<WebSocket>();
    private readonly websocket = new WebSocketServer({ noServer: true });
    private readonly server = createServer((request, response) => {
        this.handleHttp(request, response);
    });
    private pendingUpgrade?: PendingUpgrade;

    /**
     * Connects HTTP upgrades to the deterministic WebSocket script.
     */
    public constructor(
        private readonly options: CodetetherRealtimeTestServerOptions = {}
    ) {
        this.server.on('upgrade', (request, socket, head) => {
            this.upgradeCount += 1;
            this.authorization = request.headers.authorization || '';
            this.upgradeReceived.resolve();
            if (this.options.rejectUpgradeStatus) {
                this.rejectUpgrade(socket, this.options.rejectUpgradeStatus);
                return;
            }
            if (this.options.deferUpgrade) {
                this.pendingUpgrade = { request, socket, head };
                return;
            }
            this.acceptUpgrade({ request, socket, head });
        });
    }

    /**
     * Starts the server and returns its ephemeral port.
     */
    public async listen(): Promise<number> {
        await new Promise<void>(resolve => {
            this.server.listen(0, '127.0.0.1', resolve);
        });
        return (this.server.address() as AddressInfo).port;
    }

    /**
     * Waits until the client has started its prompt turn.
     */
    public waitForPrompt(): Promise<void> {
        return this.promptReceived.promise;
    }

    /**
     * Waits until a client reaches the HTTP upgrade boundary.
     */
    public waitForUpgrade(): Promise<void> {
        return this.upgradeReceived.promise;
    }

    /**
     * Waits until the server receives an explicit cancellation frame.
     */
    public waitForCancel(): Promise<void> {
        return this.cancelReceived.promise;
    }

    /**
     * Waits until the active client transport has closed.
     */
    public waitForClientClose(): Promise<void> {
        return this.clientClosed.promise;
    }

    /**
     * Releases a deliberately delayed upgrade when its socket remains usable.
     */
    public releaseUpgrade(): boolean {
        const pending = this.pendingUpgrade;
        this.pendingUpgrade = undefined;
        if (!pending || pending.socket.destroyed) {
            return false;
        }
        this.acceptUpgrade(pending);
        return true;
    }

    /**
     * Closes both protocol listeners after one test.
     */
    public async close(): Promise<void> {
        this.pendingUpgrade?.socket.destroy();
        this.pendingUpgrade = undefined;
        for (const client of this.clients) {
            client.terminate();
        }
        this.websocket.close();
        await new Promise<void>((resolve, reject) => {
            this.server.close(error => error ? reject(error) : resolve());
        });
    }

    /**
     * Completes one HTTP upgrade and installs the deterministic frame script.
     */
    private acceptUpgrade(upgrade: PendingUpgrade): void {
        this.websocket.handleUpgrade(
            upgrade.request,
            upgrade.socket,
            upgrade.head,
            client => this.handleSocket(client)
        );
    }

    /**
     * Refuses one upgrade the way an unmapped policy route does.
     *
     * Mirrors CodeTether servers that predate the realtime route: the
     * request is answered with a plain HTTP status and no body.
     */
    private rejectUpgrade(socket: Duplex, status: number): void {
        socket.end(
            `HTTP/1.1 ${status} Rejected\r\n`
            + 'Content-Length: 0\r\n'
            + 'Connection: close\r\n\r\n'
        );
    }

    /**
     * Returns the persisted session created before the socket upgrade.
     */
    private handleHttp(
        request: IncomingMessage,
        response: ServerResponse
    ): void {
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer | string) => {
            chunks.push(Buffer.isBuffer(chunk)
                ? chunk
                : Buffer.from(chunk));
        });
        request.on('end', () => {
            this.captureSessionTitle(Buffer.concat(chunks).toString('utf8'));
            const body = JSON.stringify({ id: 'session-1' });
            response.writeHead(200, {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(body)
            });
            response.end(body);
        });
    }

    /**
     * Captures the title from one session-creation request for assertions.
     */
    private captureSessionTitle(body: string): void {
        const parsed = JSON.parse(body) as { title?: unknown };
        this.sessionTitle = typeof parsed.title === 'string'
            ? parsed.title
            : '';
    }

    /**
     * Dispatches client prompt and steering frames in arrival order.
     */
    private handleSocket(socket: WebSocket): void {
        this.connectionCount += 1;
        this.clients.add(socket);
        socket.once('close', () => {
            this.clients.delete(socket);
            this.clientClosed.resolve();
        });
        socket.on('message', (data: RawData) => {
            const frame = JSON.parse(data.toString()) as {
                type?: unknown;
                message?: unknown;
                request_id?: unknown;
            };
            this.clientFrames.push(String(frame.type || ''));
            if (frame.type === 'prompt') {
                this.startTurn(socket, String(frame.message || ''));
            } else if (frame.type === 'steer') {
                this.finishTurn(
                    socket,
                    String(frame.request_id || ''),
                    String(frame.message || '')
                );
            } else if (frame.type === 'cancel') {
                this.cancelReceived.resolve();
                if (this.options.closeOnCancel !== false) {
                    socket.close(1000);
                }
            }
        });
    }

    /**
     * Sends cumulative progress text and a tool before waiting for steering.
     */
    private startTurn(socket: WebSocket, prompt: string): void {
        this.prompt = prompt;
        this.send(socket, { type: 'ready', session_id: 'session-1' });
        this.sendEvent(socket, 'item.started', {
            item_id: 'item-1',
            item_type: 'assistant_text'
        });
        this.sendEvent(socket, 'item.delta', {
            item_id: 'item-1',
            text: 'hel'
        });
        this.sendEvent(socket, 'item.delta', {
            item_id: 'item-1',
            text: 'hello'
        });
        this.sendEvent(socket, 'item.completed', {
            item_id: 'item-1',
            text: 'hello'
        });
        this.sendEvent(socket, 'tool.started', {
            tool_call_id: 'tool-1',
            name: 'inspect',
            arguments: '{}'
        });
        this.promptReceived.resolve();
    }

    /**
     * Acknowledges steering and completes the active turn.
     */
    private finishTurn(
        socket: WebSocket,
        requestId: string,
        message: string
    ): void {
        this.steering = message;
        this.send(socket, {
            type: 'steering',
            request_id: requestId,
            accepted: true
        });
        this.sendEvent(socket, 'tool.completed', {
            tool_call_id: 'tool-1',
            name: 'inspect',
            output: 'done',
            success: true
        });
        this.sendEvent(socket, 'item.started', {
            item_id: 'item-2',
            item_type: 'assistant_text'
        });
        this.sendEvent(socket, 'item.delta', {
            item_id: 'item-2',
            text: 'final'
        });
        this.sendEvent(socket, 'item.delta', {
            item_id: 'item-2',
            text: 'final answer'
        });
        this.sendEvent(socket, 'item.completed', {
            item_id: 'item-2',
            text: 'final answer'
        });
        this.sendEvent(socket, 'turn.done', {});
        this.send(socket, {
            type: 'result',
            result: {
                text: 'final answer',
                session_id: 'session-1'
            }
        });
    }

    /**
     * Wraps one thread event in the server frame contract.
     */
    private sendEvent(
        socket: WebSocket,
        kind: string,
        payload: Record<string, unknown>
    ): void {
        this.send(socket, {
            type: 'event',
            event: {
                event_id: `event-${kind}`,
                session_id: 'session-1',
                turn_id: 'turn-1',
                kind,
                payload
            }
        });
    }

    /**
     * Serializes one deterministic server frame.
     */
    private send(socket: WebSocket, frame: object): void {
        socket.send(JSON.stringify(frame));
    }
}

/**
 * Creates one externally resolvable promise for protocol synchronization.
 */
function deferred<T>(): Deferred<T> {
    let resolver: (value: T) => void = () => undefined;
    const promise = new Promise<T>(resolve => {
        resolver = resolve;
    });
    return { promise, resolve: resolver };
}