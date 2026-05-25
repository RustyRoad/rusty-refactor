/**
 * Utilities for extracting assistant text from `codetether run` output.
 */

interface RunJsonResponse {
    text?: unknown;
    output?: unknown;
    response?: unknown;
    message?: unknown;
    session_id?: unknown;
    sessionId?: unknown;
}

/**
 * Parsed response from Codetether's CLI JSON output.
 */
export interface CodetetherRunResponse {
    text: string;
    sessionId?: string;
}

/**
 * Returns user-facing assistant text from noisy `codetether run` output.
 *
 * Codetether can emit tracing logs before the structured or plain assistant
 * response. The chat UI should show only the assistant response, while the
 * raw logs remain available through the extension output channel.
 */
export function extractCodetetherRunText(output: string): string {
    return parseCodetetherRunOutput(output).text;
}

/**
 * Returns assistant text and session metadata from noisy CLI output.
 */
export function parseCodetetherRunOutput(
    output: string
): CodetetherRunResponse {
    const response = extractJsonResponse(output);
    if (response) {
        return {
            text: responseText(response).trim(),
            sessionId: responseSessionId(response)
        };
    }

    return { text: stripRunLogs(output).trim() };
}

/**
 * Finds response JSON in either a whole response or an embedded object.
 */
function extractJsonResponse(output: string): RunJsonResponse | undefined {
    const stripped = stripAnsi(output).trim();
    const direct = readJsonResponse(stripped);
    if (direct) {
        return direct;
    }

    const visibleOutput = stripRunLogs(output).trim();
    const visibleDirect = readJsonResponse(visibleOutput);
    if (visibleDirect) {
        return visibleDirect;
    }

    let lastResponse: RunJsonResponse | undefined;
    for (const objectText of findJsonObjects(visibleOutput)) {
        const response = readJsonResponse(objectText);
        if (response) {
            lastResponse = response;
        }
    }

    if (lastResponse) {
        return lastResponse;
    }

    for (const objectText of findJsonObjects(stripped)) {
        const response = readJsonResponse(objectText);
        if (response) {
            lastResponse = response;
        }
    }

    return lastResponse;
}

/**
 * Parses a candidate JSON object when it contains response text.
 */
function readJsonResponse(candidate: string): RunJsonResponse | undefined {
    try {
        const parsed = JSON.parse(candidate) as RunJsonResponse;
        if (responseText(parsed)) {
            return parsed;
        }
    } catch {
        return undefined;
    }

    return undefined;
}

/**
 * Returns the first response-like text field from parsed CLI JSON.
 */
function responseText(response: RunJsonResponse): string {
    for (const key of ['text', 'output', 'response', 'message'] as const) {
        const value = response[key];
        if (typeof value === 'string') {
            return value;
        }
    }

    return '';
}

/**
 * Returns the session id produced by a CLI run when one is present.
 */
function responseSessionId(response: RunJsonResponse): string | undefined {
    if (typeof response.session_id === 'string') {
        return response.session_id;
    }

    if (typeof response.sessionId === 'string') {
        return response.sessionId;
    }

    return undefined;
}

/**
 * Finds top-level JSON object literals inside otherwise noisy text.
 */
function findJsonObjects(value: string): string[] {
    const objects: string[] = [];
    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = 0; index < value.length; index++) {
        const char = value[index];

        if (inString) {
            const wasEscaped = escaped;
            escaped = updateStringEscape(char, escaped);
            if (char === '"' && !wasEscaped) {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
            escaped = false;
            continue;
        }

        if (char === '{') {
            if (depth === 0) {
                start = index;
            }
            depth++;
            continue;
        }

        if (char === '}' && depth > 0) {
            depth--;
            if (depth === 0 && start >= 0) {
                objects.push(value.slice(start, index + 1));
                start = -1;
            }
        }
    }

    return objects;
}

/**
 * Updates escape tracking while scanning inside a JSON string literal.
 */
function updateStringEscape(char: string, escaped: boolean): boolean {
    if (escaped) {
        return false;
    }

    return char === '\\';
}

/**
 * Removes known Codetether tracing logs and echoed prompts from output text.
 */
function stripRunLogs(output: string): string {
    const lines = stripAnsi(output).replace(/\r/g, '').split('\n');
    const visible: string[] = [];
    let skippingPromptEcho = false;

    for (const line of lines) {
        const trimmed = line.trim();

        if (isCodetetherLogLine(trimmed)) {
            skippingPromptEcho = trimmed.includes('Running with message:');
            continue;
        }

        if (skippingPromptEcho) {
            continue;
        }

        visible.push(line);
    }

    return visible.join('\n');
}

/**
 * Detects timestamped tracing lines produced by Codetether and dependencies.
 */
function isCodetetherLogLine(line: string): boolean {
    const hasIsoTimestamp = /^\d{4}-\d{2}-\d{2}T/.test(line);
    const hasProcessTimestamp =
        /^[\w.-]+(?:\/[\w.-]+)*:\s+\d{4}-\d{2}-\d{2}T/.test(line);
    const hasLevel = /\b(INFO|WARN|ERROR|DEBUG|TRACE)\b/.test(line);

    return (hasIsoTimestamp || hasProcessTimestamp) && hasLevel;
}

/**
 * Removes ANSI color and style escape sequences from process output.
 */
function stripAnsi(value: string): string {
    return value.replace(/\u001b\[[0-9;]*m/g, '');
}
