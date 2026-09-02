import * as http from 'http';

/**
 * Creates authenticated sessions before their WebSocket turn begins.
 */
export class CodetetherRealtimeSessionApi {
    /**
     * Creates a session API bound to one CodeTether server.
     */
    public constructor(
        private readonly hostname: string,
        private readonly port: number,
        private readonly token: string
    ) {}

    /**
     * Creates one persisted session and returns its durable identifier.
     *
     * @param title - Concise title derived from the first user prompt.
     */
    public create(title: string): Promise<string> {
        const payload = JSON.stringify({ title });
        return new Promise((resolve, reject) => {
            const request = http.request(
                this.options(payload),
                response => {
                    this.readResponse(response, resolve, reject);
                }
            );
            request.on('error', reject);
            request.end(payload);
        });
    }

    /**
     * Builds the authenticated session-creation request.
     */
    private options(payload: string): http.RequestOptions {
        return {
            hostname: this.hostname,
            port: this.port,
            path: '/api/session',
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.token}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        };
    }

    /**
     * Parses one bounded JSON session response.
     */
    private readResponse(
        response: http.IncomingMessage,
        resolve: (sessionId: string) => void,
        reject: (reason?: unknown) => void
    ): void {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer | string) => {
            chunks.push(Buffer.isBuffer(chunk)
                ? chunk
                : Buffer.from(chunk));
        });
        response.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            const status = response.statusCode || 0;
            if (status < 200 || status >= 300) {
                reject(new Error(
                    `Session creation returned HTTP ${status}: ${body}`
                ));
                return;
            }
            this.resolveSessionId(body, resolve, reject);
        });
    }

    /**
     * Validates the identifier returned by session creation.
     */
    private resolveSessionId(
        body: string,
        resolve: (sessionId: string) => void,
        reject: (reason?: unknown) => void
    ): void {
        try {
            const parsed = JSON.parse(body) as { id?: unknown };
            if (typeof parsed.id !== 'string' || !parsed.id) {
                throw new Error('Session response did not contain an id.');
            }
            resolve(parsed.id);
        } catch (error) {
            reject(error);
        }
    }
}