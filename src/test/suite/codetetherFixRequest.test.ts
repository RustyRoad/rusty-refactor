import * as assert from 'assert';

import type {
    ChatMessage,
    CodetetherChatCompletionOptions,
    JsChatResponse
} from '../../codetetherClient';
import {
    CodetetherFixClient,
    requestCodetetherFix
} from '../../codetetherFixRequest';

interface RecordedRequest {
    messages: ChatMessage[];
    options: CodetetherChatCompletionOptions;
}

/**
 * Records fix dispatches without starting the real Codetether executable.
 */
class RecordingFixClient implements CodetetherFixClient {
    public readonly requests: RecordedRequest[] = [];

    /**
     * Captures one request and returns a minimal successful response.
     */
    public async chatCompletion(
        messages: ChatMessage[],
        options: CodetetherChatCompletionOptions
    ): Promise<JsChatResponse> {
        this.requests.push({ messages, options });
        return { text: 'fixed' };
    }
}

/**
 * Verifies every repeated quick fix requests a fresh process-backed session.
 */
async function isolatesRepeatedFixRequests(): Promise<void> {
    const client = new RecordingFixClient();

    await Promise.all([
        requestCodetetherFix(client, 'first.rs', 'Fix the first error.'),
        requestCodetetherFix(client, 'second.rs', 'Fix the second error.'),
        requestCodetetherFix(client, 'third.rs', 'Fix the third error.')
    ]);

    assert.strictEqual(client.requests.length, 3);
    for (const request of client.requests) {
        assert.strictEqual(request.options.transport, 'run');
        assert.strictEqual(
            request.options.runSessionMode,
            'isolated'
        );
    }
}

/**
 * Registers diagnostic-fix request tests with Mocha's TDD interface.
 */
function defineCodetetherFixRequestTests(): void {
    test(
        'isolates repeated quick-fix requests',
        isolatesRepeatedFixRequests
    );
}

suite('Codetether fix request', defineCodetetherFixRequestTests);
