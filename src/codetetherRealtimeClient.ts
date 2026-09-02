import { codetetherSessionTitle } from './codetetherSessionTitle';
import { CodetetherRealtimeSessionApi } from
    './codetetherRealtimeSessionApi';
import { CodetetherRealtimeSocket } from './codetetherRealtimeSocket';
import type {
    CodetetherRealtimeOptions,
    CodetetherRealtimeResult
} from './codetetherRealtimeTypes';

/**
 * Creates sessions and runs their authenticated realtime turns.
 */
export class CodetetherRealtimeClient {
    private active?: CodetetherRealtimeSocket;

    /**
     * Creates a client bound to one managed CodeTether server.
     */
    public constructor(
        private readonly hostname: string,
        private readonly port: number,
        private readonly token: string
    ) {}

    /**
     * Starts one prompt, creating a durable session when needed.
     */
    public async complete(
        prompt: string,
        options: CodetetherRealtimeOptions
    ): Promise<CodetetherRealtimeResult> {
        const sessionId = options.sessionId
            || await new CodetetherRealtimeSessionApi(
                this.hostname,
                this.port,
                this.token
            ).create(codetetherSessionTitle(
                options.sessionTitle || prompt
            ));
        const socket = new CodetetherRealtimeSocket(
            this.hostname,
            this.port,
            this.token,
            sessionId
        );
        this.active = socket;
        try {
            return await socket.run(prompt, options);
        } finally {
            if (this.active === socket) {
                this.active = undefined;
            }
        }
    }

    /**
     * Steers the active turn without starting another model request.
     */
    public steer(message: string): Promise<boolean> {
        return this.active?.steer(message) || Promise.resolve(false);
    }
}