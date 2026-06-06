import { CodetetherToolEvent } from './codetetherToolEvents';

/**
 * Names the lifecycle state shown for a Codetether sub-agent.
 */
export type CodetetherSubagentStatus =
    | 'pending'
    | 'running'
    | 'completed'
    | 'failed';

/**
 * Describes one sub-agent or swarm task visible in the chat sidebar.
 */
export interface CodetetherSubagentActivity {
    id: string;
    name: string;
    status: CodetetherSubagentStatus;
    detail: string;
    updatedAt: string;
    source: string;
    taskCount?: number;
    doneCount?: number;
    blockedCount?: number;
    evidenceCount?: number;
    model?: string;
    sessionId?: string;
}

/**
 * Creates the synthetic coordinator row shown while work is delegated.
 */
export function coordinatorSubagentActivity(): CodetetherSubagentActivity {
    return {
        id: 'coordinator',
        name: 'Coordinator',
        status: 'running',
        detail: 'Watching Codetether sub-agent activity.',
        source: 'coordinator',
        updatedAt: new Date().toISOString()
    };
}

/**
 * Extracts sub-agent activity from completed Codetether tool events.
 */
export function subagentActivityFromToolEvents(
    events: CodetetherToolEvent[]
): CodetetherSubagentActivity[] {
    const rows = new Map<string, CodetetherSubagentActivity>();

    for (const event of events) {
        if (event.kind === 'call') {
            for (const row of activitiesFromToolCall(event)) {
                rows.set(row.id, row);
            }
            continue;
        }

        applyToolResult(rows, event);
    }

    return Array.from(rows.values());
}

/**
 * Builds a panel summary for the current sub-agent activity rows.
 */
export function subagentSummary(
    rows: CodetetherSubagentActivity[]
): string {
    const count = rows.filter(row => row.id !== 'coordinator').length;
    const running = rows.filter(row => row.status === 'running').length;
    const blocked = rows.reduce((total, row) => {
        return total + (row.blockedCount || 0);
    }, 0);

    if (blocked > 0) {
        return `${count} tracked | ${blocked} blocked`;
    }
    if (running > 0 && count > 0) {
        return `${count} tracked | ${running} running`;
    }
    if (count === 0 && rows.length > 0) {
        return 'coordinating';
    }

    return count === 1 ? '1 sub-agent' : `${count} sub-agents`;
}

/**
 * Merges newer activity rows over existing rows by id.
 */
export function mergeSubagentActivity(
    current: CodetetherSubagentActivity[],
    incoming: CodetetherSubagentActivity[]
): CodetetherSubagentActivity[] {
    const rows = new Map<string, CodetetherSubagentActivity>();

    for (const row of current) {
        rows.set(row.id, row);
    }
    for (const row of incoming) {
        rows.set(row.id, row);
    }

    return Array.from(rows.values());
}

/**
 * Marks all visible sub-agent rows as complete or failed.
 */
export function finishSubagentActivity(
    rows: CodetetherSubagentActivity[],
    succeeded: boolean
): CodetetherSubagentActivity[] {
    const status = succeeded ? 'completed' : 'failed';
    return rows.map(row => ({
        ...row,
        status: row.status === 'completed' ? row.status : status,
        detail: finishDetail(row, succeeded),
        updatedAt: new Date().toISOString()
    }));
}

/**
 * Converts a tool call into one or more sub-agent activity rows.
 */
function activitiesFromToolCall(
    event: CodetetherToolEvent
): CodetetherSubagentActivity[] {
    if (event.name === 'batch') {
        return activitiesFromBatch(event);
    }
    if (!toolNameSuggestsSubagent(event.name)) {
        return [];
    }

    return [activityFromToolCall(event.id, event.name, event.arguments)];
}

/**
 * Converts nested batch calls into sub-agent rows when they delegate work.
 */
function activitiesFromBatch(
    event: CodetetherToolEvent
): CodetetherSubagentActivity[] {
    const args = parseToolArguments(event.arguments);
    const calls = Array.isArray(args.calls) ? args.calls : [];
    const rows: CodetetherSubagentActivity[] = [];

    calls.forEach((call, index) => {
        const item = call as Record<string, unknown>;
        const tool = stringField(item, 'tool');
        const toolArgs = item.args && typeof item.args === 'object'
            ? item.args as Record<string, unknown>
            : {};

        if (!toolNameSuggestsSubagent(tool)) {
            return;
        }

        rows.push(activityFromToolCall(
            `${event.id}-${index}`,
            tool,
            JSON.stringify(toolArgs)
        ));
    });

    return rows;
}

/**
 * Builds one sub-agent row from a tool-call name and argument payload.
 */
function activityFromToolCall(
    id: string,
    toolName = '',
    rawArguments = ''
): CodetetherSubagentActivity {
    const args = parseToolArguments(rawArguments);
    return {
        id,
        name: activityName(toolName, args),
        status: 'running',
        detail: activityDetail(toolName, args),
        source: toolName || 'tool',
        model: stringField(args, 'model') || undefined,
        updatedAt: new Date().toISOString()
    };
}

/**
 * Applies a matching tool result to an existing activity row.
 */
function applyToolResult(
    rows: Map<string, CodetetherSubagentActivity>,
    event: CodetetherToolEvent
): void {
    const row = rows.get(event.id);
    if (!row) {
        return;
    }

    rows.set(event.id, {
        ...row,
        status: resultLooksFailed(event.content) ? 'failed' : 'completed',
        detail: summarizeText(event.content) || row.detail,
        updatedAt: new Date().toISOString()
    });
}

/**
 * Returns a concise completion detail for one final activity row.
 */
function finishDetail(
    row: CodetetherSubagentActivity,
    succeeded: boolean
): string {
    if (row.id !== 'coordinator') {
        return row.detail;
    }

    return succeeded
        ? 'Coordination finished.'
        : 'Coordination stopped with an error.';
}

/**
 * Chooses a display name from a tool call and its arguments.
 */
function activityName(
    toolName: string,
    args: Record<string, unknown>
): string {
    return stringField(args, 'name')
        || stringField(args, 'agent')
        || stringField(args, 'role')
        || friendlyToolName(toolName);
}

/**
 * Chooses a compact description from a tool call argument payload.
 */
function activityDetail(
    toolName: string,
    args: Record<string, unknown>
): string {
    const detail = stringField(args, 'task')
        || stringField(args, 'prompt')
        || stringField(args, 'message')
        || stringField(args, 'instruction')
        || stringField(args, 'description');

    if (detail) {
        return summarizeText(detail);
    }

    const count = subtaskCount(args);
    return count > 0
        ? `${friendlyToolName(toolName)} with ${count} tasks.`
        : `${friendlyToolName(toolName)} started.`;
}

/**
 * Reads a string field from parsed JSON object data.
 */
function stringField(
    value: Record<string, unknown>,
    key: string
): string {
    const field = value[key];
    return typeof field === 'string' ? field.trim() : '';
}

/**
 * Counts nested task or agent lists in a swarm argument payload.
 */
function subtaskCount(args: Record<string, unknown>): number {
    for (const key of ['tasks', 'agents', 'subagents']) {
        const value = args[key];
        if (Array.isArray(value)) {
            return value.length;
        }
    }

    return 0;
}

/**
 * Returns whether a tool name represents delegated agent work.
 */
function toolNameSuggestsSubagent(name: string | undefined): boolean {
    const lower = String(name || '').toLowerCase();
    return lower === 'agent'
        || lower.includes('swarm')
        || lower === 'relay_autochat';
}

/**
 * Converts raw tool names into short user-facing labels.
 */
function friendlyToolName(toolName: string): string {
    if (toolName.includes('swarm')) {
        return 'Swarm';
    }
    if (toolName === 'relay_autochat') {
        return 'Relay';
    }

    return 'Sub-agent';
}

/**
 * Parses JSON tool arguments while tolerating plain text payloads.
 */
function parseToolArguments(rawArguments = ''): Record<string, unknown> {
    try {
        const parsed = JSON.parse(rawArguments);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
    } catch {
        return {};
    }

    return {};
}

/**
 * Detects obvious failure wording in a tool result.
 */
function resultLooksFailed(content: string | undefined): boolean {
    const text = String(content || '').toLowerCase();
    return /\b(error|failed|failure|rejected)\b/.test(text);
}

/**
 * Trims long tool or session text for compact sidebar display.
 */
function summarizeText(value: string | undefined): string {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();
    const maxLength = 120;

    if (normalized.length <= maxLength) {
        return normalized;
    }

    return `${normalized.slice(0, maxLength - 3)}...`;
}
