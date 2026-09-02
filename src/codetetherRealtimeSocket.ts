import type { IncomingMessage } from 'http';
import WebSocket, { RawData } from 'ws';

import {
    codetetherCancelledError
} from './codetetherChatProgress';
import { CodetetherRealtimeCancellation } from
    './codetetherRealtimeCancellation';
import { CodetetherRealtimeEvents } from './codetetherRealtimeEvents';
import { realtimeHandshakeError } from './codetetherRealtimeHandshake';
import { CodetetherRealtimeSteering } from './codetetherRealtimeSteering';
import type {
    CodetetherRealtimeOptions,
    CodetetherRealtimeResult,
    CodetetherRealtimeServerFrame
} from './codetetherRealtimeTypes';

type RealtimeFinish = (
    error?: Error,
    result?: CodetetherRealtimeResult
) => void;

/**
 * Owns one authenticated WebSocket for one active session turn.
 */
export class CodetetherRealtimeSocket {
    private socket?: WebSocket;
    private steering?: CodetetherRealtimeSteering;

    /**
     * Creates a socket endpoint for one existing session.
     */
    public constructor(
        private readonly hostname: string,
        private readonly port: number,
        private readonly token: string,
        private readonly sessionId: string
    ) {}

    /**
     * Runs one prompt until a terminal result or transport failure arrives.
     */
    public run(
        prompt: string,
        options: CodetetherRealtimeOptions
    ): Promise<CodetetherRealtimeResult> {
        if (options.signal?.aborted) {
            return Promise.reject(codetetherCancelledError());
        }
        const events = new CodetetherRealtimeEvents(options.sink);
        const socket = this.openSocket();
        this.socket = socket;
        this.steering = new CodetetherRealtimeSteering(socket);
        options.onSteeringReady?.(message => this.steer(message));
        return this.awaitResult(socket, prompt, events, options);
    }

    /**
     * Sends one instruction through the active turn's steering channel.
     */
    public steer(message: string): Promise<boolean> {
        return this.steering?.send(message) || Promise.resolve(false);
    }

    /**
     * Opens the authenticated WebSocket without putting its token in the URL.
     */
    private openSocket(): WebSocket {
        const path = `/api/realtime/session/`
            + encodeURIComponent(this.sessionId);
        return new WebSocket(
            `ws://${this.hostname}:${this.port}${path}`,
            { headers: { Authorization: `Bearer ${this.token}` } }
        );
    }

    /**
     * Connects socket callbacks to one terminal result promise.
     */
    private awaitResult(
        socket: WebSocket,
        prompt: string,
        events: CodetetherRealtimeEvents,
        options: CodetetherRealtimeOptions
    ): Promise<CodetetherRealtimeResult> {
        return new Promise((resolve, reject) => {
            const cancellation = new CodetetherRealtimeCancellation(
                socket,
                options.signal
            );
            let settled = false;
            /**
             * Resolves one terminal result and releases all socket listeners.
             */
            const finish: RealtimeFinish = (error, result): void => {
                if (settled) {
                    return;
                }
                settled = true;
                cancellation.dispose();
                this.steering?.close();
                if (!cancellation.requested()
                    && socket.readyState === WebSocket.OPEN) {
                    socket.close(1000);
                } else if (socket.readyState === WebSocket.CONNECTING) {
                    socket.terminate();
                }
                if (error) {
                    reject(error);
                    return;
                }
                resolve(result!);
            };
            cancellation.start(() => {
                finish(codetetherCancelledError());
            });
            this.bindSocketEvents(
                socket,
                prompt,
                events,
                options,
                cancellation,
                finish
            );
        });
    }

    /**
     * Binds one socket to prompt, progress, and terminal lifecycle handlers.
     */
    private bindSocketEvents(
        socket: WebSocket,
        prompt: string,
        events: CodetetherRealtimeEvents,
        options: CodetetherRealtimeOptions,
        cancellation: CodetetherRealtimeCancellation,
        finish: RealtimeFinish
    ): void {
        this.bindHandshakeRejection(socket, cancellation, finish);
        socket.once('open', () => {
            this.sendPrompt(socket, prompt, cancellation, finish);
        });
        socket.on('message', (data: RawData) => {
            if (!cancellation.requested()) {
                this.consumeFrame(data, events, options, finish);
            }
        });
        socket.once('error', error => {
            if (cancellation.requested()) {
                cancellation.forceStop();
                return;
            }
            finish(error);
        });
        socket.once('close', () => {
            finish(cancellation.requested()
                ? codetetherCancelledError()
                : new Error(
                    'CodeTether realtime socket closed early.'
                ));
        });
    }

    /**
     * Replaces the opaque `ws` handshake failure with a diagnosable error.
     *
     * Listening for `unexpected-response` suppresses the generic
     * "Unexpected server response" error, so the status is explained here
     * and the half-open request is released explicitly.
     */
    private bindHandshakeRejection(
        socket: WebSocket,
        cancellation: CodetetherRealtimeCancellation,
        finish: RealtimeFinish
    ): void {
        socket.once(
            'unexpected-response',
            (request, response: IncomingMessage) => {
                request.destroy();
                if (cancellation.requested()) {
                    cancellation.forceStop();
                    return;
                }
                finish(realtimeHandshakeError(
                    response.statusCode,
                    this.hostname,
                    this.port
                ));
            }
        );
    }

    /**
     * Sends the prompt only when cancellation has not won the connection race.
     */
    private sendPrompt(
        socket: WebSocket,
        prompt: string,
        cancellation: CodetetherRealtimeCancellation,
        finish: RealtimeFinish
    ): void {
        if (cancellation.requested()) {
            cancellation.forceStop();
            return;
        }
        socket.send(
            JSON.stringify({
                type: 'prompt',
                message: prompt
            }),
            error => {
                if (error) {
                    finish(error);
                }
            }
        );
    }

    /**
     * Applies one server frame and resolves terminal results.
     */
    private consumeFrame(
        data: RawData,
        events: CodetetherRealtimeEvents,
        options: CodetetherRealtimeOptions,
        finish: RealtimeFinish
    ): void {
        try {
            const frame = JSON.parse(
                data.toString()
            ) as CodetetherRealtimeServerFrame;
            if (frame.type === 'ready') {
                options.sink?.({
                    phase: 'thinking',
                    message: 'CodeTether session connected.',
                    sessionId: frame.session_id
                });
            } else if (frame.type === 'event') {
                const failure = events.failure(frame.event);
                if (failure) {
                    finish(new Error(failure));
                } else {
                    events.apply(frame.event);
                }
            } else if (frame.type === 'steering') {
                this.steering?.acknowledge(
                    frame.request_id,
                    frame.accepted
                );
            } else if (frame.type === 'error') {
                finish(new Error(frame.message));
            } else if (frame.type === 'result') {
                finish(undefined, {
                    text: frame.result.text,
                    sessionId: frame.result.session_id,
                    toolEvents: events.toolEvents()
                });
            }
        } catch (error) {
            finish(error instanceof Error ? error : new Error(String(error)));
        }
    }
}