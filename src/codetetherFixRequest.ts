import type {
    ChatMessage,
    CodetetherChatCompletionOptions,
    JsChatResponse
} from './codetetherClient';

const FIX_SYSTEM_MESSAGE = [
    'You are a workspace-editing coding agent.',
    'Make the requested code changes in the workspace, let validation',
    'complete, and then summarize what changed.'
].join(' ');

/**
 * Describes the narrow client capability needed by a diagnostic fix.
 */
export interface CodetetherFixClient {
    /**
     * Runs one diagnostic-fix conversation with explicit execution options.
     */
    chatCompletion(
        messages: ChatMessage[],
        options: CodetetherChatCompletionOptions
    ): Promise<JsChatResponse>;
}

/**
 * Dispatches one diagnostic fix in a fresh process-backed session.
 *
 * The run transport starts a child process per call. Isolated session mode
 * prevents concurrent quick fixes from continuing the same workspace
 * conversation.
 */
export function requestCodetetherFix(
    client: CodetetherFixClient,
    filePath: string,
    prompt: string
): Promise<JsChatResponse> {
    return client.chatCompletion(
        [
            {
                role: 'system',
                content: FIX_SYSTEM_MESSAGE
            },
            {
                role: 'user',
                content: prompt
            }
        ],
        {
            filePaths: [filePath],
            transport: 'run',
            runSessionMode: 'isolated'
        }
    );
}
