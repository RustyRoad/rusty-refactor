import * as vscode from 'vscode';

import { ChatMessage } from '../codetetherClient';
import { CodetetherSessionLoader } from './codetetherSessionLoader';
import { CodetetherSessionSummary } from './codetetherSessionTypes';

/**
 * Loads persisted Codetether sessions into the sidebar webview.
 */
export class CodetetherSessionViewLoader {
    /**
     * Creates a webview loader for persisted session transcripts.
     */
    public constructor(
        private readonly loader = new CodetetherSessionLoader()
    ) {}

    /**
     * Posts a loaded session transcript and returns host chat history.
     */
    public async load(
        session: CodetetherSessionSummary,
        view: vscode.WebviewView | undefined
    ): Promise<ChatMessage[]> {
        const loaded = await this.loader.load(session);
        view?.webview.postMessage({
            type: 'sessionLoaded',
            sessionId: session.id,
            messages: loaded.messages
        });
        return loaded.history;
    }
}
