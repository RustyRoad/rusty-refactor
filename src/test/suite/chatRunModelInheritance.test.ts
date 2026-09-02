import * as assert from 'assert';

import type {
    ChatMessage,
    CodetetherClient,
    JsChatResponse
} from '../../codetetherClient';
import { defaultCodetetherModelOptions } from
    '../../codetetherModelOptions';
import type { AgentPromptBuilder } from '../../sidebar/agentPromptBuilder';
import {
    ChatRunController,
    ChatRunSink
} from '../../sidebar/chatRunController';

/**
 * Creates a sink that discards UI effects during prompt-policy coverage.
 */
function silentSink(): ChatRunSink {
    return {
        progress: () => {},
        tool: () => {},
        status: () => {},
        start: () => {},
        finish: () => {}
    };
}

/**
 * Creates an immediate transport response for model-inheritance coverage.
 */
function completedClient(): CodetetherClient {
    return {
        chatCompletion: async (
            _messages: ChatMessage[]
        ): Promise<JsChatResponse> => {
            return { text: 'done', model_id: 'openai/gpt-5' };
        }
    } as unknown as CodetetherClient;
}

/**
 * Verifies the selected request model reaches the delegation instruction.
 */
async function passesParentModelToPrompt(): Promise<void> {
    let parentModel = '';
    const promptBuilder = {
        buildAgentPrompt: async (
            text: string,
            _mode: string,
            _feature: string,
            _includeContext: boolean,
            model: string
        ): Promise<string> => {
            parentModel = model;
            return text;
        }
    } as unknown as AgentPromptBuilder;
    const controller = new ChatRunController(
        completedClient(),
        silentSink(),
        promptBuilder
    );

    await controller.submit({
        text: 'Delegate this task.',
        model: 'openai/gpt-5',
        modelOptions: defaultCodetetherModelOptions(),
        includeContext: false
    });

    assert.strictEqual(parentModel, 'openai/gpt-5');
}

/**
 * Registers chat-run model inheritance coverage.
 */
function registerChatRunModelInheritanceTests(): void {
    test(
        'passes the parent model into the delegation prompt',
        passesParentModelToPrompt
    );
}

suite(
    'Chat run model inheritance',
    registerChatRunModelInheritanceTests
);