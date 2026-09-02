import * as assert from 'assert';

import type {
    ChatMessage,
    CodetetherChatCompletionOptions,
    CodetetherClient,
    JsChatResponse
} from '../../codetetherClient';
import { defaultCodetetherModelOptions } from
    '../../codetetherModelOptions';
import {
    ChatThreadManager,
    ChatThreadSink
} from '../../sidebar/chatThreadManager';
import type { UserMessageRequest } from '../../sidebar/chatTypes';

interface DeferredCompletion {
    promise: Promise<JsChatResponse>;
    resolve: (response: JsChatResponse) => void;
}

/**
 * Creates one externally resolvable model completion.
 */
function deferredCompletion(): DeferredCompletion {
    let resolve = (_response: JsChatResponse): void => {};
    const promise = new Promise<JsChatResponse>(next => {
        resolve = next;
    });
    return { promise, resolve };
}

/**
 * Creates one minimal live-thread prompt.
 */
function threadRequest(text: string): UserMessageRequest {
    return {
        text,
        modelOptions: defaultCodetetherModelOptions(),
        includeContext: false
    };
}

/**
 * Creates a no-op sink for manager lifecycle testing.
 */
function threadSink(): ChatThreadSink {
    return {
        progress: () => {},
        tool: () => {},
        status: () => {},
        start: () => {},
        finish: () => {},
        threadsChanged: () => {}
    };
}

/**
 * Verifies a second chat starts without cancelling the first chat transport.
 */
async function runsIndependentThreadsConcurrently(): Promise<void> {
    const completions: DeferredCompletion[] = [];
    const signals: Array<AbortSignal | undefined> = [];
    const scopes: Array<string | undefined> = [];
    const client = {
        chatCompletion: async (
            _messages: ChatMessage[],
            options: CodetetherChatCompletionOptions
        ): Promise<JsChatResponse> => {
            const completion = deferredCompletion();
            completions.push(completion);
            signals.push(options.signal);
            scopes.push(options.serverScope);
            return completion.promise;
        }
    } as unknown as CodetetherClient;
    const manager = new ChatThreadManager(client, threadSink());
    const firstId = manager.activeThreadId();
    const firstRun = manager.submit(
        firstId,
        threadRequest('First background task')
    );
    await new Promise(resolve => setImmediate(resolve));

    const second = manager.createThread();
    const secondRun = manager.submit(
        second.id,
        threadRequest('Second background task')
    );
    await new Promise(resolve => setImmediate(resolve));

    assert.strictEqual(completions.length, 2);
    assert.strictEqual(signals[0]?.aborted, false);
    assert.strictEqual(signals[1]?.aborted, false);
    assert.notStrictEqual(scopes[0], scopes[1]);
    assert.strictEqual(scopes[0], firstId);
    assert.strictEqual(scopes[1], second.id);
    assert.strictEqual(
        manager.summaries().filter(thread => thread.busy).length,
        2
    );

    completions[0].resolve({ text: 'First complete.' });
    completions[1].resolve({ text: 'Second complete.' });
    await Promise.all([firstRun, secondRun]);
    assert.strictEqual(
        manager.summaries().filter(thread => thread.busy).length,
        0
    );
    manager.dispose();
}

/**
 * Verifies one hard interrupt leaves its sibling transport running.
 */
async function interruptsOnlySelectedThread(): Promise<void> {
    const completions: DeferredCompletion[] = [];
    const signals: Array<AbortSignal | undefined> = [];
    const client = {
        chatCompletion: async (
            _messages: ChatMessage[],
            options: CodetetherChatCompletionOptions
        ): Promise<JsChatResponse> => {
            const completion = deferredCompletion();
            completions.push(completion);
            signals.push(options.signal);
            return completion.promise;
        }
    } as unknown as CodetetherClient;
    const manager = new ChatThreadManager(client, threadSink());
    const firstId = manager.activeThreadId();
    const firstRun = manager.submit(
        firstId,
        threadRequest('First task')
    );
    await new Promise(resolve => setImmediate(resolve));
    const second = manager.createThread();
    const secondRun = manager.submit(
        second.id,
        threadRequest('Second task')
    );
    await new Promise(resolve => setImmediate(resolve));

    assert.strictEqual(manager.interruptThread(firstId), true);
    assert.strictEqual(signals[0]?.aborted, true);
    assert.strictEqual(signals[1]?.aborted, false);
    assert.strictEqual(
        manager.summaries().filter(thread => thread.busy).length,
        2
    );

    completions[0].resolve({ text: 'Ignored after interrupt.' });
    await firstRun;
    assert.strictEqual(
        manager.summaries().filter(thread => thread.busy).length,
        1
    );
    completions[1].resolve({ text: 'Second complete.' });
    await secondRun;
    manager.dispose();
}

/**
 * Registers independent concurrent chat coverage.
 */
function registerChatThreadManagerTests(): void {
    test(
        'keeps separate chat transports running concurrently',
        runsIndependentThreadsConcurrently
    );
    test(
        'interrupts only the selected chat transport',
        interruptsOnlySelectedThread
    );
}

suite('Chat thread manager', registerChatThreadManagerTests);