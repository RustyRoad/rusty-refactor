import * as assert from 'assert';

import type {
    CodetetherChatProgress
} from '../../codetetherChatProgress';
import { CodetetherRealtimeEvents } from
    '../../codetetherRealtimeEvents';
import type {
    CodetetherThreadEvent
} from '../../codetetherRealtimeTypes';

/**
 * Creates one deterministic realtime event for router coverage.
 */
function event(
    kind: string,
    payload: Record<string, unknown> = {}
): CodetetherThreadEvent {
    return {
        event_id: `event-${kind}`,
        session_id: 'session-1',
        turn_id: 'turn-1',
        kind,
        payload
    };
}

/**
 * Creates one cumulative assistant text payload.
 */
function textPayload(itemId: string, text?: string): Record<string, unknown> {
    return {
        item_id: itemId,
        ...(text === undefined ? {} : { text })
    };
}

/**
 * Returns progress records carrying visible answer text.
 */
function answerUpdates(
    updates: CodetetherChatProgress[]
): CodetetherChatProgress[] {
    return updates.filter(update => Boolean(update.textDelta));
}

/**
 * Returns progress records carrying collapsible reasoning text.
 */
function thinkingUpdates(
    updates: CodetetherChatProgress[]
): CodetetherChatProgress[] {
    return updates.filter(update => Boolean(update.thinkingDelta));
}

/**
 * Verifies pre-tool narration is separated from the terminal answer item.
 */
function separatesProgressFromAnswer(): void {
    const updates: CodetetherChatProgress[] = [];
    const router = new CodetetherRealtimeEvents(update => {
        updates.push(update);
    });
    router.apply(event(
        'item.delta',
        textPayload('progress-1', 'I will inspect the relevant files.')
    ));
    router.apply(event(
        'item.completed',
        textPayload('progress-1', 'I will inspect the relevant files.')
    ));
    router.apply(event('tool.started', {
        item_id: 'tool-1',
        tool_call_id: 'call-1',
        name: 'read',
        arguments: '{}'
    }));
    router.apply(event('tool.completed', {
        item_id: 'tool-1',
        tool_call_id: 'call-1',
        name: 'read',
        output: 'contents'
    }));
    router.apply(event(
        'item.delta',
        textPayload('answer-1', 'Changed: fixed the cache key.')
    ));
    router.apply(event(
        'item.completed',
        textPayload('answer-1', 'Changed: fixed the cache key.')
    ));
    router.apply(event('turn.done'));

    assert.deepStrictEqual(
        thinkingUpdates(updates).map(update => update.thinkingDelta),
        ['I will inspect the relevant files.']
    );
    assert.deepStrictEqual(
        answerUpdates(updates).map(update => update.textDelta),
        ['Changed: fixed the cache key.']
    );
    assert.strictEqual(updates.at(-1)?.phase, 'complete');
}

/**
 * Verifies a turn containing only its final item has no thinking transcript.
 */
function keepsSingleItemAsAnswer(): void {
    const updates: CodetetherChatProgress[] = [];
    const router = new CodetetherRealtimeEvents(update => {
        updates.push(update);
    });
    router.apply(event(
        'item.delta',
        textPayload('answer-1', 'Final answer only.')
    ));
    router.apply(event(
        'item.completed',
        textPayload('answer-1')
    ));
    router.apply(event('turn.done'));

    assert.deepStrictEqual(thinkingUpdates(updates), []);
    assert.deepStrictEqual(
        answerUpdates(updates).map(update => update.textDelta),
        ['Final answer only.']
    );
}

/**
 * Verifies multiple superseded text items remain readable as paragraphs.
 */
function groupsMultipleProgressItems(): void {
    const updates: CodetetherChatProgress[] = [];
    const router = new CodetetherRealtimeEvents(update => {
        updates.push(update);
    });
    router.apply(event(
        'item.completed',
        textPayload('progress-1', 'First progress update.')
    ));
    router.apply(event('item.started', {
        item_id: 'progress-2',
        item_type: 'assistant_text'
    }));
    router.apply(event(
        'item.completed',
        textPayload('progress-2', 'Second progress update.')
    ));
    router.apply(event('tool.started', {
        item_id: 'tool-1',
        tool_call_id: 'call-1',
        name: 'read',
        arguments: '{}'
    }));
    router.apply(event(
        'item.completed',
        textPayload('answer-1', 'Result.')
    ));
    router.apply(event('turn.done'));

    assert.deepStrictEqual(
        thinkingUpdates(updates).map(update => update.thinkingDelta),
        [
            'First progress update.',
            '\n\nSecond progress update.'
        ]
    );
    assert.deepStrictEqual(
        answerUpdates(updates).map(update => update.textDelta),
        ['Result.']
    );
}

/**
 * Registers realtime reasoning and answer separation coverage.
 */
function registerRealtimeEventsTests(): void {
    test(
        'separates progress narration from the answer',
        separatesProgressFromAnswer
    );
    test('keeps a single text item as the answer', keepsSingleItemAsAnswer);
    test(
        'groups multiple progress items as thinking',
        groupsMultipleProgressItems
    );
}

suite('Codetether realtime events', registerRealtimeEventsTests);