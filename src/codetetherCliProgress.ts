import {
    CodetetherChatProgress,
    CodetetherChatProgressSink
} from './codetetherChatProgress';

const ANSI_ESCAPE_PATTERN = new RegExp(
    String.raw`\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])`,
    'g'
);

/**
 * Converts live CodeTether CLI tracing lines into sidebar progress events.
 */
export class CodetetherCliProgressParser {
    private bufferedText = '';
    private readonly emittedCalls = new Set<string>();

    /**
     * Creates a parser whose sink receives ordered session and tool updates.
     */
    public constructor(
        private readonly sink?: CodetetherChatProgressSink
    ) {}

    /**
     * Accepts arbitrary stderr chunks while preserving split log lines.
     */
    public push(chunk: string): void {
        this.bufferedText += chunk;
        const lines = this.bufferedText.split(/\r?\n/u);
        this.bufferedText = lines.pop() || '';

        for (const line of lines) {
            this.parseLine(line);
        }
    }

    /**
     * Parses the final unterminated log line after the child exits.
     */
    public finish(): void {
        if (this.bufferedText) {
            this.parseLine(this.bufferedText);
            this.bufferedText = '';
        }
    }

    /**
     * Routes one normalized tracing line to its protocol event parser.
     */
    private parseLine(rawLine: string): void {
        const line = rawLine.replace(ANSI_ESCAPE_PATTERN, '');
        this.emitSession(line);
        this.emitToolCall(line);
    }

    /**
     * Emits a stable session id as soon as CodeTether announces it.
     */
    private emitSession(line: string): void {
        const match = line.match(
            /(?:Created new|Continuing) session:\s*([a-z0-9-]+)/iu
        );
        if (!match) {
            return;
        }

        this.emit({
            phase: 'thinking',
            message: 'CodeTether session started.',
            sessionId: match[1]
        });
    }

    /**
     * Emits a tool call when the agent loop begins executing it.
     */
    private emitToolCall(line: string): void {
        if (!line.includes('Executing tool')) {
            return;
        }

        const name = this.field(line, 'tool');
        if (!name) {
            return;
        }

        const id = this.field(line, 'tool_id') || `tool-${name}`;
        if (this.emittedCalls.has(id)) {
            return;
        }
        this.emittedCalls.add(id);
        this.emit({
            phase: 'tool',
            message: `Running ${name}...`,
            toolEvent: {
                kind: 'call',
                id,
                name,
                arguments: 'Arguments are retained by the CodeTether session.'
            }
        });
    }

    /**
     * Reads one unquoted or quoted tracing field from a normalized line.
     */
    private field(line: string, name: string): string {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
        const pattern = new RegExp(
            `\\b${escaped}=(?:"([^"]+)"|([^\\s]+))`,
            'u'
        );
        const match = line.match(pattern);
        return match ? (match[1] || match[2] || '') : '';
    }

    /**
     * Sends one parsed event only when a caller requested progress.
     */
    private emit(progress: CodetetherChatProgress): void {
        this.sink?.(progress);
    }
}
