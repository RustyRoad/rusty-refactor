import * as vscode from 'vscode';

import { openRustyRefactorChat } from './sidebar/openChatCommand';
import { buildTodoImplementationPrompt } from './todoImplementationPrompt';
import { readTodoTarget } from './todoTarget';

export const IMPLEMENT_TODO_COMMAND =
    'rustyRefactor.implementTodoWithCodetether';

/**
 * Starts code-focused prompts in fresh Codetether sidebar sessions.
 */
export interface TodoImplementationChat {
    /**
     * Starts one implementation prompt in a newly visible session.
     */
    startCodeSession(prompt: string): Promise<void>;
}

/**
 * Registers the CodeLens command that opens a new TODO implementation chat.
 */
export function registerTodoImplementationCommand(
    chat: TodoImplementationChat
): vscode.Disposable {
    return vscode.commands.registerCommand(
        IMPLEMENT_TODO_COMMAND,
        async (uri: vscode.Uri, range: vscode.Range) => {
            await implementTodo(chat, uri, range);
        }
    );
}

/**
 * Handles one TODO CodeLens command invocation.
 */
async function implementTodo(
    chat: TodoImplementationChat,
    uri: vscode.Uri,
    range: vscode.Range
): Promise<void> {
    try {
        const document = await vscode.workspace.openTextDocument(uri);
        const target = readTodoTarget(document, range);
        if (!target) {
            void vscode.window.showWarningMessage(
                'That TODO no longer exists at this location.'
            );
            return;
        }

        await ensureTodoDocumentSaved(document);
        await openRustyRefactorChat();
        await chat.startCodeSession(buildTodoImplementationPrompt(target));
    } catch (error) {
        const message = error instanceof Error
            ? error.message
            : String(error);
        void vscode.window.showErrorMessage(
            `Could not start the Codetether TODO session: ${message}`
        );
    }
}

/**
 * Saves dirty source so Codetether sees the same TODO as the editor.
 */
async function ensureTodoDocumentSaved(
    document: vscode.TextDocument
): Promise<void> {
    if (document.isDirty && !await document.save()) {
        throw new Error('Save the file before starting the session.');
    }
}
