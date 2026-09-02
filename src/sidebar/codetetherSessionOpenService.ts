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
    messages?: ChatMessage[];
    sessionId?: string;
    title?: string;
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
        sessionId: string
    ): Promise<CodetetherSessionOpenResult> {
        const sessions = await this.sessions.listRecentSessions(200);
        const session = sessions.find(item => {
            return item.path === sessionPath || item.id === sessionId;
        });
        if (!session) {
            return { status: 'Session not found.', loaded: false };
        }

        const loaded = session.format === 'agent'
            ? await this.fileTranscript.loadById(session.id)
            : await this.loader.load(session);
        return loaded
            ? this.loadedResult(session.id, session.preview, loaded)
            : { status: 'Session could not be read.', loaded: false };
    }

    /**
     * Loads a session by id or unique prefix pasted from the shell TUI.
     */
    public async openById(
        sessionId: string
    ): Promise<CodetetherSessionOpenResult> {
        const session = await this.sessions.findSessionById(sessionId);
        if (session) {
            return this.openSelected(session.path, session.id);
        }

        const loaded = await this.fileTranscript.loadById(sessionId);
        if (!loaded) {
            return {
                status: `Session not found: ${sessionId}`,
                loaded: false
            };
        }

        return this.loadedResult(sessionId, 'Previous chat', loaded);
    }

    /**
     * Builds a successful open result for provider state updates.
     */
    private loadedResult(
        sessionId: string,
        title: string,
        loaded: {
            history: ChatMessage[];
            messages: ChatMessage[];
        }
    ): CodetetherSessionOpenResult {
        return {
            history: loaded.history,
            messages: loaded.messages,
            sessionId,
            title,
            status: `Loaded session ${sessionId}`,
            loaded: true
        };
    }
}
