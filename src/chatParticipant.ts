import * as vscode from 'vscode';
import { CodetetherClient, ChatMessage } from './codetetherClient';

export function registerChatParticipant(context: vscode.ExtensionContext) {
    const handler: vscode.ChatRequestHandler = async (
        request: vscode.ChatRequest,
        chatContext: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ) => {
        stream.progress('Thinking...');

        const client = new CodetetherClient();
        
        // Build the prompt history
        const messages: ChatMessage[] = [];

        // Include any past conversation context in the Chat panel
        for (const turn of chatContext.history) {
            if (turn instanceof vscode.ChatRequestTurn) {
                messages.push({ role: 'user', content: turn.prompt });
            } else if (turn instanceof vscode.ChatResponseTurn) {
                // Read the response elements text
                const content = turn.response.map(r => {
                    // ChatResponseMarkdownPart has a 'value' property 
                    if ('value' in r) {
                        const val = r.value as any;
                        return typeof val === 'string' ? val : (val.value || '');
                    }
                    return '';
                }).join('\n');
                messages.push({ role: 'assistant', content });
            }
        }

        // Add the current prompt
        messages.push({ role: 'user', content: request.prompt });

        try {
            // We just use chatCompletion as a single block for now
            // If the process could stream stdout gradually, we could yield chunks, 
            // but the current CodetetherClient collects all stdout then resolves.
            const response = await client.chatCompletion(messages);
            
            if (token.isCancellationRequested) {
                return;
            }

            stream.markdown(response.text || '');
            
            return { metadata: { source: 'codetether' } };
        } catch (error) {
            const errBase = error as Error;
            stream.markdown(`**Codetether Error:** ${errBase.message}`);
            return { errorDetails: { message: errBase.message } };
        }
    };

    const participant = vscode.chat.createChatParticipant('rustyRefactor.codetether', handler);
    // Use an icon associated with bots/AI
    participant.iconPath = new vscode.ThemeIcon('hubot');

    context.subscriptions.push(participant);
}
