import * as vscode from 'vscode';

import { ChatMessage } from '../codetetherClient';
import {
    CodetetherSessionFileTranscript
} from './codetetherSessionFileTranscript';
import { CodetetherSessionViewLoader } from './codetetherSessionViewLoader';
import { CodetetherSessionService } from './codetetherSessions';

/**
 * Result of attempting to load a persisted session into the sidebar.
 */
export interface CodetetherSessionOpenResult {
    history?: ChatMessage[];
    status: string;
    loaded: boolean;
}

/**
 * Finds persisted Codetether sessions and loads them into the webview.
 */
export class CodetetherSessionOpenService {
    /**
     * Creates a session opening service from focused collaborators.
     */
    public constructor(
        private readonly sessions = new CodetetherSessionService(),
        private readonly loader = new CodetetherSessionViewLoader(),
        private readonly fileTranscript = new CodetetherSessionFileTranscript()
    ) {}

    /**
     * Loads a session selected from the sidebar session list.
     */
    public async openSelected(
        sessionPath: string,
        sessionId: string,
        view: vscode.WebviewView | undefined
    ): Promise<CodetetherSessionOpenResult> {
        const sessions = await this.sessions.listRecentSessions(200);
        const session = sessions.find(item => {
            return item.path === sessionPath || item.id === sessionId;
        });
        if (!session) {
            return { status: 'Session not found.', loaded: false };
        }

        const history = await this.loader.load(session, view);
        return this.loadedResult(session.id, history);
    }

    /**
     * Loads a session by id or unique prefix pasted from the shell TUI.
     */
    public async openById(
        sessionId: string,
        view: vscode.WebviewView | undefined
    ): Promise<CodetetherSessionOpenResult> {
        const session = await this.sessions.findSessionById(sessionId);
        if (session) {
            const history = await this.loader.load(session, view);
            return this.loadedResult(session.id, history);
        }

        const loaded = await this.fileTranscript.loadById(sessionId);
        if (!loaded) {
            return {
                status: `Session not found: ${sessionId}`,
                loaded: false
            };
        }

        view?.webview.postMessage({
            type: 'sessionLoaded',
            sessionId,
            messages: loaded.messages
        });
        return this.loadedResult(sessionId, loaded.history);
    }

    /**
     * Builds a successful open result for provider state updates.
     */
    private loadedResult(
        sessionId: string,
        history: ChatMessage[]
    ): CodetetherSessionOpenResult {
        return {
            history,
            status: `Loaded session ${sessionId}`,
            loaded: true
        };
    }
}
