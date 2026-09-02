import * as http from 'http';

import {
    CodetetherChatProgressSink,
    codetetherCancelledError
} from './codetetherChatProgress';

/**
 * Describes one OpenAI-compatible message accepted by CodeTether.
 */
export interface CodetetherStreamMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content?: string;
    tool_call_id?: string;
    tool_calls?: CodetetherStreamMessageToolCall[];
}

/**
 * Describes assistant tool metadata replayed in a request history.
 */
export interface CodetetherStreamMessageToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

/**
 * Describes the request fields supported by the streaming server endpoint.
 */
export interface CodetetherStreamRequest {
    model: string;
    messages: CodetetherStreamMessage[];
    max_tokens?: number;
    temperature?: number;
    stream: true;
}

/**
 * Contains text and tool calls assembled from an SSE response.
 */
export interface CodetetherStreamResult {
    text: string;
    toolCalls: Array<{
        id: string;
        name: string;
        arguments: string;
    }>;
}

interface StreamToolCall {
    id: string;
    name: string;
    arguments: string;
}

/**
 * Reads CodeTether's OpenAI-compatible SSE response incrementally.
 */
export class CodetetherOpenAiStream {
    /**
     * Creates a stream bound to one authenticated managed server.
     */
    public constructor(
        private readonly hostname: string,
        private readonly port: number,
        private readonly token: string
    ) {}

    /**
     * Sends one request and reports text, reasoning, and tool deltas early.
     *
     * Cancellation destroys the underlying socket and rejects with an
     * `AbortError`, allowing callers to distinguish steering from failure.
     */
    public complete(
        payload: CodetetherStreamRequest,
        signal?: AbortSignal,
        sink?: CodetetherChatProgressSink
    ): Promise<CodetetherStreamResult> {
        const body = JSON.stringify(payload);

        return new Promise((resolve, reject) => {
            if (signal?.aborted) {
                reject(codetetherCancelledError());
                return;
            }

            let responseText = '';
            let eventBuffer = '';
            let settled = false;
            const tools = new Map<number, StreamToolCall>();
            const request = http.request(
                this.requestOptions(body),
                response => {
                    if (!this.isSuccessful(response.statusCode)) {
                        this.rejectHttpResponse(response, error => {
                            if (settled) {
                                return;
                            }
                            settled = true;
                            signal?.removeEventListener('abort', onAbort);
                            reject(error);
                        });
                        return;
                    }

                    response.on('data', (chunk: Buffer | string) => {
                        eventBuffer += chunk.toString();
                        eventBuffer = this.consumeFrames(
                            eventBuffer,
                            tools,
                            text => {
                                responseText += text;
                            },
                            sink
                        );
                    });
                    response.on('end', () => {
                        if (settled) {
                            return;
                        }
                        settled = true;
                        signal?.removeEventListener('abort', onAbort);
                        resolve({
                            text: responseText,
                            toolCalls: [...tools.values()]
                        });
                    });
                }
            );
            const onAbort = (): void => {
                if (settled) {
                    return;
                }
                settled = true;
                request.destroy(codetetherCancelledError());
                reject(codetetherCancelledError());
            };

            signal?.addEventListener('abort', onAbort, { once: true });
            request.on('error', error => {
                if (settled) {
                    return;
                }
                settled = true;
                signal?.removeEventListener('abort', onAbort);
                reject(signal?.aborted
                    ? codetetherCancelledError()
                    : error);
            });
            request.write(body);
            request.end();
        });
    }

    /**
     * Builds the authenticated request options for the SSE endpoint.
     */
    private requestOptions(body: string): http.RequestOptions {
        return {
            hostname: this.hostname,
            port: this.port,
            path: '/v1/chat/completions',
            method: 'POST',
            headers: {
                Accept: 'text/event-stream',
                Authorization: `Bearer ${this.token}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };
    }

    /**
     * Returns whether an HTTP status can contain a completion stream.
     */
    private isSuccessful(statusCode?: number): boolean {
        const status = statusCode ?? 0;
        return status >= 200 && status < 300;
    }

    /**
     * Collects a failed response body before returning a useful error.
     */
    private rejectHttpResponse(
        response: http.IncomingMessage,
        reject: (reason?: unknown) => void
    ): void {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer | string) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            reject(new Error(
                `CodeTether stream returned HTTP ` +
                `${response.statusCode ?? 0}: ${body}`
            ));
        });
    }

    /**
     * Consumes complete SSE frames and retains an unfinished trailing frame.
     */
    private consumeFrames(
        buffer: string,
        tools: Map<number, StreamToolCall>,
        appendText: (text: string) => void,
        sink?: CodetetherChatProgressSink
    ): string {
        const frames = buffer.split(/\r?\n\r?\n/u);
        const remainder = frames.pop() || '';

        for (const frame of frames) {
            const data = frame.split(/\r?\n/u)
                .filter(line => line.startsWith('data:'))
                .map(line => line.slice(5).trimStart())
                .join('\n');
            this.consumeData(data, tools, appendText, sink);
        }

        return remainder;
    }

    /**
     * Converts one SSE data payload into ordered progress updates.
     */
    private consumeData(
        data: string,
        tools: Map<number, StreamToolCall>,
        appendText: (text: string) => void,
        sink?: CodetetherChatProgressSink
    ): void {
        if (!data || data === '[DONE]') {
            return;
        }

        const payload = JSON.parse(data) as {
            choices?: Array<{
                delta?: Record<string, unknown>;
            }>;
        };
        const delta = payload.choices?.[0]?.delta || {};
        const reasoning = this.reasoningDelta(delta);
        if (reasoning) {
            sink?.({
                phase: 'thinking',
                message: 'Reasoning...',
                thinkingDelta: reasoning
            });
        }

        const content = typeof delta.content === 'string'
            ? delta.content
            : '';
        if (content) {
            appendText(content);
            sink?.({
                phase: 'answer',
                message: 'Responding...',
                textDelta: content
            });
        }

        this.consumeToolDeltas(delta.tool_calls, tools, sink);
    }

    /**
     * Reads reasoning fields used by current compatible model providers.
     */
    private reasoningDelta(delta: Record<string, unknown>): string {
        const candidates = [
            delta.reasoning_content,
            delta.reasoning,
            delta.thinking
        ];
        const value = candidates.find(item => typeof item === 'string');
        return typeof value === 'string' ? value : '';
    }

    /**
     * Merges fragmented OpenAI tool calls and emits their latest snapshots.
     */
    private consumeToolDeltas(
        rawCalls: unknown,
        tools: Map<number, StreamToolCall>,
        sink?: CodetetherChatProgressSink
    ): void {
        if (!Array.isArray(rawCalls)) {
            return;
        }

        for (const rawCall of rawCalls) {
            const call = rawCall as {
                index?: number;
                id?: string;
                function?: {
                    name?: string;
                    arguments?: string;
                };
            };
            const index = call.index ?? tools.size;
            const current = tools.get(index) || {
                id: call.id || `stream-tool-${index}`,
                name: '',
                arguments: ''
            };
            current.id = call.id || current.id;
            current.name += call.function?.name || '';
            current.arguments += call.function?.arguments || '';
            tools.set(index, current);
            sink?.({
                phase: 'tool',
                message: current.name
                    ? `Preparing ${current.name}...`
                    : 'Preparing tool call...',
                toolEvent: {
                    kind: 'call',
                    id: current.id,
                    name: current.name,
                    arguments: current.arguments
                }
            });
        }
    }
}
