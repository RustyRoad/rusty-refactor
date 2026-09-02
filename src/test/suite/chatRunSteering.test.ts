import * as assert from 'assert';

import type {
    ChatMessage,
    CodetetherChatCompletionOptions,
    CodetetherClient,
    JsChatResponse
} from '../../codetetherClient';
import { defaultCodetetherModelOptions } from
    '../../codetetherModelOptions';
import type { AgentPromptBuilder } from '../../sidebar/agentPromptBuilder';
import {
    ChatRunController,
    ChatRunSink,
    ChatRunSnapshot
} from '../../sidebar/chatRunController';
import type { UserMessageRequest } from '../../sidebar/chatTypes';

interface DeferredResponse {
    promise: Promise<JsChatResponse>;
    resolve: (response: JsChatResponse) => void;
}

/**
 * Creates one externally resolvable transport response.
 */
function deferredResponse(): DeferredResponse {
    let resolve = (_response: JsChatResponse): void => {};
    const promise = new Promise<JsChatResponse>(next => {
        resolve = next;
    });
    return { promise, resolve };
}

/**
 * Creates one minimal request for deterministic controller tests.
 */
function request(text: string): UserMessageRequest {
    return {
        text,
        modelOptions: defaultCodetetherModelOptions(),
        includeContext: false
    };
}

/**
 * Creates a prompt builder that preserves test text without editor context.
 */
function promptBuilder(): AgentPromptBuilder {
    return {
        buildAgentPrompt: async (text: string) => text
    } as unknown as AgentPromptBuilder;
}

/**
 * Creates a sink that records immutable response snapshots.
 */
function recordingSink(snapshots: ChatRunSnapshot[]): ChatRunSink {
    return {
        progress: snapshot => snapshots.push({
            ...snapshot,
            toolEvents: [...snapshot.toolEvents]
        }),
        tool: () => {},
        status: () => {},
        start: () => {},
        finish: () => {}
    };
}

/**
 * Verifies accepted steering starts a distinct assistant response bubble.
 */
async function separatesPostSteerResponse(): Promise<void> {
    const completion = deferredResponse();
    const snapshots: ChatRunSnapshot[] = [];
    let options: CodetetherChatCompletionOptions | undefined;
    const client = {
        chatCompletion: async (
            _messages: ChatMessage[],
            nextOptions: CodetetherChatCompletionOptions
        ): Promise<JsChatResponse> => {
            options = nextOptions;
            nextOptions.onSteeringReady?.(async () => true);
            nextOptions.onProgress?.({
                phase: 'answer',
                message: 'Writing response.',
                textDelta: 'Before steering.'
            });
            return completion.promise;
        }
    } as unknown as CodetetherClient;
    const controller = new ChatRunController(
        client,
        recordingSink(snapshots),
        promptBuilder()
    );

    const initialRun = controller.submit(request('Initial request'));
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(options, 'Transport options were not captured.');
    await controller.submit(request('New direction'));

    const firstFinal = snapshots.find(snapshot => {
        return snapshot.id === 'response-1'
            && snapshot.phase === 'steered'
            && !snapshot.streaming;
    });
    const secondStart = snapshots.find(snapshot => {
        return snapshot.id === 'response-2' && snapshot.streaming;
    });
    assert.strictEqual(firstFinal?.content, 'Before steering.');
    assert.ok(secondStart, 'Steering did not create a second response.');

    options.onProgress?.({
        phase: 'answer',
        message: 'Writing steered response.',
        textDelta: 'After steering.'
    });
    completion.resolve({
        text: 'Before steering.After steering.',
        session_id: 'session-1'
    });
    await initialRun;

    const secondFinal = [...snapshots].reverse().find(snapshot => {
        return snapshot.id === 'response-2' && !snapshot.streaming;
    });
    assert.strictEqual(secondFinal?.content, 'After steering.');
}

/**
 * Registers response segmentation coverage for steering updates.
 */
function registerChatRunSteeringTests(): void {
    test(
        'renders post-steer output in a new assistant response',
        separatesPostSteerResponse
    );
}

suite('Chat run steering', registerChatRunSteeringTests);
