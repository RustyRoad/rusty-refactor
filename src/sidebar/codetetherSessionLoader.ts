import { ChatMessage } from '../codetetherClient';
import { CHAT_SYSTEM_PROMPT } from './chatConstants';
import { CodetetherSessionSummary } from './codetetherSessionTypes';
import { CodetetherSessionTranscript } from './codetetherSessionTranscript';

/**
 * Builds host and webview state for loading persisted chat sessions.
 */
export class CodetetherSessionLoader {
    /**
     * Creates a loader for persisted Codetether session transcripts.
     */
    public constructor(
        private readonly transcript = new CodetetherSessionTranscript()
    ) {}

    /**
     * Reads one session transcript and returns its full host history.
     */
    public async load(session: CodetetherSessionSummary): Promise<{
        history: ChatMessage[];
        messages: ChatMessage[];
    }> {
        const messages = await this.transcript.messages(session);
        return {
            history: [
                { role: 'system', content: CHAT_SYSTEM_PROMPT },
                ...messages
            ],
            messages
        };
    }
}
