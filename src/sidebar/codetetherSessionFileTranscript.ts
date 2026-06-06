import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

import { ChatMessage } from '../codetetherClient';
import { CHAT_SYSTEM_PROMPT } from './chatConstants';

interface SessionFile {
    messages?: unknown;
}

interface SessionMessage {
    role?: unknown;
    content?: unknown;
}

interface SessionPart {
    type?: unknown;
    text?: unknown;
    name?: unknown;
    arguments?: unknown;
    content?: unknown;
}

/**
 * Reads Codetether JSON session files into sidebar chat messages.
 */
export class CodetetherSessionFileTranscript {
    /**
     * Loads one JSON session by id from the active workspace.
     */
    public async loadById(sessionId: string): Promise<{
        history: ChatMessage[];
        messages: ChatMessage[];
    } | undefined> {
        if (!this.isSafeSessionId(sessionId)) {
            return undefined;
        }

        const filePath = this.sessionFilePath(sessionId);
        if (!filePath) {
            return undefined;
        }

        const session = await this.safeReadSession(filePath);
        if (!session) {
            return undefined;
        }

        const messages = this.messagesFromSession(session);
        return {
            history: [
                { role: 'system', content: CHAT_SYSTEM_PROMPT },
                ...messages
            ],
            messages
        };
    }

    /**
     * Converts stored JSON messages into visible chat messages.
     */
    private messagesFromSession(session: SessionFile): ChatMessage[] {
        const messages = Array.isArray(session.messages)
            ? session.messages
            : [];

        return messages
            .map(message => this.messageFromSession(message as SessionMessage))
            .filter(this.isChatMessage);
    }

    /**
     * Converts one JSON session message into one sidebar message.
     */
    private messageFromSession(
        message: SessionMessage
    ): ChatMessage | undefined {
        const role = this.roleValue(message.role);
        if (!role || role === 'system') {
            return undefined;
        }

        const content = this.visibleContent(message.content, role);
        if (!content) {
            return undefined;
        }

        return { role, content };
    }

    /**
     * Returns the chat role encoded in a session JSON message.
     */
    private roleValue(role: unknown): ChatMessage['role'] | '' {
        if (typeof role !== 'string') {
            return '';
        }

        return ['user', 'assistant', 'tool'].includes(role)
            ? role as ChatMessage['role']
            : '';
    }

    /**
     * Formats text and tool parts from a JSON message.
     */
    private visibleContent(
        content: unknown,
        role: ChatMessage['role']
    ): string {
        const parts = Array.isArray(content) ? content : [];
        const text = parts
            .map(part => this.partText(part as SessionPart))
            .filter(Boolean)
            .join('\n\n')
            .trim();

        return role === 'user' ? this.userRequestText(text) : text;
    }

    /**
     * Converts one content part into visible transcript text.
     */
    private partText(part: SessionPart): string {
        if (typeof part.text === 'string') {
            return part.text.trim();
        }
        if (part.type === 'tool_call') {
            return this.toolCallText(part);
        }
        if (part.type === 'tool_result') {
            return this.stringValue(part.content);
        }

        return '';
    }

    /**
     * Formats one stored tool call as compact markdown text.
     */
    private toolCallText(part: SessionPart): string {
        const name = this.stringValue(part.name) || 'tool';
        const args = this.stringValue(part.arguments);
        return args ? `[tool_call ${name}]\n${args}` : `[tool_call ${name}]`;
    }

    /**
     * Removes generated prompt framing from user turns when present.
     */
    private userRequestText(content: string): string {
        const marker = 'User request:';
        const markerIndex = content.indexOf(marker);
        if (markerIndex === -1) {
            return content.trim();
        }

        return content.slice(markerIndex + marker.length).trim();
    }

    /**
     * Reads and parses a JSON session file.
     */
    private async safeReadSession(
        filePath: string
    ): Promise<SessionFile | undefined> {
        try {
            const raw = await fs.readFile(filePath, 'utf8');
            return JSON.parse(raw) as SessionFile;
        } catch {
            return undefined;
        }
    }

    /**
     * Builds the JSON session file path for the active workspace.
     */
    private sessionFilePath(sessionId: string): string | undefined {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
            return undefined;
        }

        return path.join(
            folder.uri.fsPath,
            '.codetether-agent',
            'sessions',
            `${sessionId}.json`
        );
    }

    /**
     * Ensures a session id cannot escape the session directory.
     */
    private isSafeSessionId(sessionId: string): boolean {
        return /^[a-z0-9_-]+$/i.test(sessionId);
    }

    /**
     * Converts unknown values into readable strings.
     */
    private stringValue(value: unknown): string {
        if (typeof value === 'string') {
            return value.trim();
        }
        if (value === undefined || value === null) {
            return '';
        }

        return JSON.stringify(value, null, 2);
    }

    /**
     * Narrows optional messages after invalid rows are skipped.
     */
    private isChatMessage(
        message: ChatMessage | undefined
    ): message is ChatMessage {
        return Boolean(message);
    }
}
