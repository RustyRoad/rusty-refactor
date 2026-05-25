/**
 * Reads Codetether session files to recover completed tool activity.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

import { CodetetherToolEvent } from './codetetherToolEvents';

const MAX_TOOL_EVENTS = 80;
const MAX_TOOL_CONTENT_CHARS = 4000;

interface SessionPart {
    type?: unknown;
    id?: unknown;
    name?: unknown;
    arguments?: unknown;
    tool_call_id?: unknown;
    content?: unknown;
}

interface SessionMessage {
    content?: unknown;
}

interface SessionFile {
    messages?: unknown;
}

/**
 * Reads the tool timeline for a completed Codetether CLI session.
 */
export async function readCodetetherSessionToolEvents(
    workspacePath: string,
    sessionId: string | undefined
): Promise<CodetetherToolEvent[]> {
    if (!sessionId || !isSafeSessionId(sessionId)) {
        return [];
    }

    try {
        const filePath = sessionFilePath(workspacePath, sessionId);
        const raw = await fs.readFile(filePath, 'utf8');
        return parseSessionToolEvents(raw);
    } catch {
        return [];
    }
}

/**
 * Builds the persisted session file path for one Codetether session id.
 */
function sessionFilePath(workspacePath: string, sessionId: string): string {
    return path.join(
        workspacePath,
        '.codetether-agent',
        'sessions',
        `${sessionId}.json`
    );
}

/**
 * Ensures a session id cannot escape the session directory.
 */
function isSafeSessionId(sessionId: string): boolean {
    return /^[a-z0-9_-]+$/i.test(sessionId);
}

/**
 * Parses persisted session JSON into a compact tool timeline.
 */
function parseSessionToolEvents(raw: string): CodetetherToolEvent[] {
    const parsed = JSON.parse(raw) as SessionFile;
    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    const events: CodetetherToolEvent[] = [];

    for (const message of messages) {
        events.push(...eventsFromMessage(message as SessionMessage));
        if (events.length >= MAX_TOOL_EVENTS) {
            break;
        }
    }

    return attachResultNames(events.slice(0, MAX_TOOL_EVENTS));
}

/**
 * Extracts tool-related parts from one persisted session message.
 */
function eventsFromMessage(message: SessionMessage): CodetetherToolEvent[] {
    const parts = Array.isArray(message.content) ? message.content : [];
    const events: CodetetherToolEvent[] = [];

    for (const part of parts) {
        const event = eventFromPart(part as SessionPart);
        if (event) {
            events.push(event);
        }
    }

    return events;
}

/**
 * Converts one Codetether session part into a tool event when applicable.
 */
function eventFromPart(part: SessionPart): CodetetherToolEvent | undefined {
    if (part.type === 'tool_call') {
        return toolCallEvent(part);
    }

    if (part.type === 'tool_result') {
        return toolResultEvent(part);
    }

    return undefined;
}

/**
 * Converts a persisted tool call part into a display event.
 */
function toolCallEvent(part: SessionPart): CodetetherToolEvent | undefined {
    const id = stringValue(part.id);
    if (!id) {
        return undefined;
    }

    return {
        kind: 'call',
        id,
        name: stringValue(part.name),
        arguments: stringValue(part.arguments)
    };
}

/**
 * Converts a persisted tool result part into a display event.
 */
function toolResultEvent(part: SessionPart): CodetetherToolEvent | undefined {
    const id = stringValue(part.tool_call_id);
    if (!id) {
        return undefined;
    }

    const limited = limitText(stringValue(part.content));
    return {
        kind: 'result',
        id,
        content: limited.text,
        truncated: limited.truncated
    };
}

/**
 * Adds tool names to result rows using earlier call rows with matching ids.
 */
function attachResultNames(
    events: CodetetherToolEvent[]
): CodetetherToolEvent[] {
    const names = new Map<string, string>();

    return events.map(event => {
        if (event.kind === 'call' && event.name) {
            names.set(event.id, event.name);
            return event;
        }

        if (event.kind === 'result' && !event.name) {
            return { ...event, name: names.get(event.id) };
        }

        return event;
    });
}

/**
 * Converts unknown session values to a readable string.
 */
function stringValue(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }

    if (value === undefined || value === null) {
        return '';
    }

    return JSON.stringify(value, null, 2);
}

/**
 * Caps large tool result content before sending it to the webview.
 */
function limitText(text: string): { text: string; truncated: boolean } {
    if (text.length <= MAX_TOOL_CONTENT_CHARS) {
        return { text, truncated: false };
    }

    return {
        text: text.slice(0, MAX_TOOL_CONTENT_CHARS),
        truncated: true
    };
}
