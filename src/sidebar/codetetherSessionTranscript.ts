import { ChatMessage } from '../codetetherClient';
import { CodetetherSessionDirectory } from './codetetherSessionDirectory';
import { CodetetherSessionSummary } from './codetetherSessionTypes';

/**
 * Reads persisted turn files into chat messages for sidebar replay.
 */
export class CodetetherSessionTranscript {
    /**
     * Creates a transcript reader for persisted session turn files.
     */
    public constructor(
        private readonly directory = new CodetetherSessionDirectory()
    ) {}

    /**
     * Converts one persisted session directory into chat messages.
     */
    public async messages(
        session: CodetetherSessionSummary
    ): Promise<ChatMessage[]> {
        const turnFiles = await this.directory.turnFiles(session.path);
        const messages = await Promise.all(
            turnFiles.map(file => this.messageFromTurn(session.path, file))
        );

        return messages.filter(this.isChatMessage);
    }

    /**
     * Reads one turn file and maps its filename suffix to a message role.
     */
    private async messageFromTurn(
        sessionPath: string,
        turnFile: string
    ): Promise<ChatMessage | undefined> {
        const role = this.roleFromTurnFile(turnFile);
        if (!role || role === 'system') {
            return undefined;
        }

        const turnPath = this.directory.turnPath(sessionPath, turnFile);
        const content = await this.directory.safeReadFile(turnPath);
        const visibleContent = this.visibleTurnContent(content, role);
        if (!visibleContent) {
            return undefined;
        }

        return { role, content: visibleContent };
    }

    /**
     * Returns the chat role encoded in a persisted turn filename.
     */
    private roleFromTurnFile(turnFile: string): ChatMessage['role'] | '' {
        const match = /^turn-\d{4}-(.+)\.md$/.exec(turnFile);
        const role = match ? match[1] : '';
        return this.isChatRole(role) ? role : '';
    }

    /**
     * Narrows arbitrary text to roles supported by chat rendering.
     */
    private isChatRole(role: string): role is ChatMessage['role'] {
        return ['system', 'user', 'assistant', 'tool'].includes(role);
    }

    /**
     * Removes generated prompt framing from user turns when present.
     */
    private visibleTurnContent(
        content: string,
        role: ChatMessage['role']
    ): string {
        if (role !== 'user') {
            return content.trim();
        }

        const marker = 'User request:';
        const markerIndex = content.indexOf(marker);
        if (markerIndex === -1) {
            return content.trim();
        }

        return content.slice(markerIndex + marker.length).trim();
    }

    /**
     * Narrows optional messages after unreadable turns are skipped.
     */
    private isChatMessage(
        message: ChatMessage | undefined
    ): message is ChatMessage {
        return Boolean(message);
    }
}
