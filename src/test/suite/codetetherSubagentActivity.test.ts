import * as assert from 'assert';

import {
    subagentActivityFromToolEvents
} from '../../codetetherSubagentActivity';
import type { CodetetherToolEvent } from '../../codetetherToolEvents';

/**
 * Creates a matched call and result pair for the `agent` runtime tool.
 */
function agentEvents(
    argumentsValue: Record<string, unknown>,
    result: unknown
): CodetetherToolEvent[] {
    return [
        {
            kind: 'call',
            id: 'call-1',
            name: 'agent',
            arguments: JSON.stringify(argumentsValue)
        },
        {
            kind: 'result',
            id: 'call-1',
            name: 'agent',
            content: JSON.stringify(result)
        }
    ];
}

/**
 * Verifies agent-list JSON becomes structured sidebar activity rows.
 */
function parsesAgentListResult(): void {
    const rows = subagentActivityFromToolEvents(agentEvents(
        { action: 'list' },
        [
            {
                agent_id: 'agent-1',
                name: 'reviewer',
                status: 'running',
                current_tool: 'read',
                transport: 'local'
            },
            {
                agent_id: 'agent-2',
                name: 'tester',
                status: 'done',
                session_title: 'Focused test review',
                transport: 'lan'
            }
        ]
    ));

    assert.deepStrictEqual(
        rows.map(row => ({
            id: row.id,
            name: row.name,
            status: row.status,
            detail: row.detail,
            source: row.source
        })),
        [
            {
                id: 'agent-agent-1',
                name: 'reviewer',
                status: 'running',
                detail: 'Running read.',
                source: 'local'
            },
            {
                id: 'agent-agent-2',
                name: 'tester',
                status: 'completed',
                detail: 'Focused test review',
                source: 'lan'
            }
        ]
    );
    assert.ok(rows.every(row => !row.detail.includes('{')));
}

/**
 * Verifies a single agent status object becomes one structured card.
 */
function parsesAgentStatusResult(): void {
    const [row] = subagentActivityFromToolEvents(agentEvents(
        { action: 'status', name: 'reviewer' },
        {
            agent_id: 'agent-1',
            name: 'reviewer',
            status: 'waiting',
            needs_interaction: true
        }
    ));

    assert.ok(row);
    assert.strictEqual(row.name, 'reviewer');
    assert.strictEqual(row.status, 'running');
    assert.strictEqual(row.detail, 'Waiting for interaction.');
}

/**
 * Verifies generic structured completion never replaces card text with JSON.
 */
function hidesUnrecognizedResultJson(): void {
    const [row] = subagentActivityFromToolEvents(agentEvents(
        {
            action: 'spawn',
            name: 'reviewer',
            message: 'Review the focused change.'
        },
        { success: true }
    ));

    assert.ok(row);
    assert.strictEqual(row.name, 'reviewer');
    assert.strictEqual(row.status, 'completed');
    assert.strictEqual(row.detail, 'Sub-agent completed.');
}

/**
 * Verifies an empty agent-list snapshot does not leave a synthetic JSON row.
 */
function handlesEmptyAgentList(): void {
    const rows = subagentActivityFromToolEvents(agentEvents(
        { action: 'list' },
        []
    ));

    assert.deepStrictEqual(rows, []);
}

/**
 * Registers structured sub-agent result presentation coverage.
 */
function registerSubagentActivityTests(): void {
    test(
        'parses agent-list results into activity cards',
        parsesAgentListResult
    );
    test(
        'parses a single agent status result',
        parsesAgentStatusResult
    );
    test(
        'hides unrecognized structured result JSON',
        hidesUnrecognizedResultJson
    );
    test('handles an empty agent list', handlesEmptyAgentList);
}

suite('Codetether sub-agent activity', registerSubagentActivityTests);