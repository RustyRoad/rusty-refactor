import * as vscode from 'vscode';

export const OPEN_CHAT_COMMAND = 'rustyRefactor.openChat';

const OPEN_CHAT_CONTAINER =
    'workbench.view.extension.rustyRefactor-sidebar';
const FOCUS_CHAT_VIEW = 'rustyRefactor.chatView.focus';

/**
 * Reveals the Rusty Refactor container and focuses its chat webview.
 *
 * The separate focus command ensures a previously collapsed chat view opens
 * when the editor-title action is used.
 */
export async function openRustyRefactorChat(): Promise<void> {
    await vscode.commands.executeCommand(OPEN_CHAT_CONTAINER);
    await vscode.commands.executeCommand(FOCUS_CHAT_VIEW);
}

/**
 * Registers the editor-title command that opens Rusty Refactor chat.
 */
export function registerOpenChatCommand(): vscode.Disposable {
    return vscode.commands.registerCommand(
        OPEN_CHAT_COMMAND,
        openRustyRefactorChat
    );
}
