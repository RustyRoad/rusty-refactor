import { ChatMessage } from '../codetetherClient';
import { CodetetherSessionLoader } from './codetetherSessionLoader';
import { CodetetherSessionSummary } from './codetetherSessionTypes';

/**
 * Loads persisted Codetether sessions into sidebar-ready message records.
 */
export class CodetetherSessionViewLoader {
    /**
     * Creates a webview loader for persisted session transcripts.
     */
    public constructor(
        private readonly loader = new CodetetherSessionLoader()
    ) {}

    /**
     * Returns visible messages and provider history for one session.
     */
    public async load(
        session: CodetetherSessionSummary
    ): Promise<{
        history: ChatMessage[];
        messages: ChatMessage[];
    }> {
        return this.loader.load(session);
    }
}
