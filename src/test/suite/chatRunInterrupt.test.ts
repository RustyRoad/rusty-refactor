import * as assert from 'assert';

import type {
    ChatMessage,
    CodetetherChatCompletionOptions,
    CodetetherClient,
    JsChatResponse
} from '../../codetetherClient';
import { codetetherCancelledError } from
    '../../codetetherChatProgress';
import { defaultCodetetherModelOptions } from
    '../../codetetherModelOptions';
import type { AgentPromptBuilder } from
    '../../sidebar/agentPromptBuilder';
import {
    ChatRunController,
    ChatRunSink,
    ChatRunSnapshot
} from '../../sidebar/chatRunController';
import type { UserMessageRequest } from '../../sidebar/chatTypes';

interface InterruptRecords {
    snapshots: ChatRunSnapshot[];
    statuses: Array<{ message: string; busy: boolean }>;
    finishes: Array<{ interrupted: boolean; succeeded: boolean }>;
}

/**
 * Creates one minimal request without editor context dependencies.
 */
function interruptRequest(text: string): UserMessageRequest {
    return {
        text,
        modelOptions: defaultCodetetherModelOptions(),
        includeContext: false
    };
}

/**
 * Creates a prompt builder that preserves the test request verbatim.
 */
function interruptPromptBuilder(): AgentPromptBuilder {
    return {
        buildAgentPrompt: async (text: string) => text
    } as unknown as AgentPromptBuilder;
}

/**
 * Records the lifecycle effects produced by a hard interrupt.
 */
function interruptSink(records: InterruptRecords): ChatRunSink {
    return {
        progress: snapshot => records.snapshots.push({
            ...snapshot,
            toolEvents: [...snapshot.toolEvents]
        }),
        tool: () => {},
        status: (message, busy) => {
            records.statuses.push({ message, busy });
        },
        start: () => {},
        finish: (succeeded, _events, interrupted) => {
            records.finishes.push({ interrupted, succeeded });
        }
    };
}

/**
 * Creates a transport that streams text until its abort signal fires.
 */
function interruptibleClient(
    capture: (options: CodetetherChatCompletionOptions) => void
): CodetetherClient {
    return {
        chatCompletion: async (
            _messages: ChatMessage[],
            options: CodetetherChatCompletionOptions
        ): Promise<JsChatResponse> => {
            capture(options);
            options.onProgress?.({
                phase: 'answer',
                message: 'Writing response.',
                textDelta: 'Partial response.'
            });
            return new Promise((_resolve, reject) => {
                options.signal?.addEventListener('abort', () => {
                    reject(codetetherCancelledError());
                }, { once: true });
            });
        }
    } as unknown as CodetetherClient;
}

/**
 * Verifies a hard stop aborts transport and preserves partial visible output.
 */
async function hardStopsActiveRun(): Promise<void> {
    const records: InterruptRecords = {
        snapshots: [],
        statuses: [],
        finishes: []
    };
    let options: CodetetherChatCompletionOptions | undefined;
    const controller = new ChatRunController(
        interruptibleClient(next => {
            options = next;
        }),
        interruptSink(records),
        interruptPromptBuilder()
    );

    const run = controller.submit(interruptRequest('Long task'));
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(controller.interrupt(), true);
    assert.deepStrictEqual(records.statuses.at(-1), {
        message: 'Interrupting...',
        busy: true
    });
    assert.strictEqual(records.finishes.length, 0);
    assert.strictEqual(options?.signal?.aborted, true);
    await run;

    const final = records.snapshots.at(-1);
    assert.strictEqual(final?.phase, 'interrupted');
    assert.strictEqual(final?.streaming, false);
    assert.match(final?.content || '', /Partial response\./u);
    assert.match(final?.content || '', /Hard interrupted by user\./u);
    assert.deepStrictEqual(records.finishes.at(-1), {
        interrupted: true,
        succeeded: false
    });
    assert.deepStrictEqual(records.statuses.at(-1), {
        message: 'Interrupted',
        busy: false
    });
    assert.strictEqual(controller.interrupt(), false);
}

/**
 * Registers hard-interrupt lifecycle coverage.
 */
function registerChatRunInterruptTests(): void {
    test('hard-stops an active response', hardStopsActiveRun);
}

suite('Chat run interrupt', registerChatRunInterruptTests);