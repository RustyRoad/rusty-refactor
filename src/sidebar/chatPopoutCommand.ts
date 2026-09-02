import * as vscode from 'vscode';

import {
    CHAT_POPOUT_VIEW_TYPE,
    ChatPopoutRequest,
    MOVE_EDITOR_TO_NEW_WINDOW_COMMAND,
    OPEN_CHAT_WINDOW_COMMAND
} from './chatPopoutConstants';
import { CodetetherChatViewProvider } from './CodetetherChatViewProvider';
import {
    WorkspaceFileChangeObserver
} from '../workspaceFileChangeService';

/**
 * Owns detached chat panels created by the open-in-new-window command.
 */
export class ChatPopoutCommand implements vscode.Disposable {
    private readonly panels = new Map<
        vscode.WebviewPanel,
        CodetetherChatViewProvider
    >();
    private readonly command: vscode.Disposable;

    /**
     * Registers the command with dependencies shared by all chat surfaces.
     */
    public constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly workspaceFiles: WorkspaceFileChangeObserver
    ) {
        this.command = vscode.commands.registerCommand(
            OPEN_CHAT_WINDOW_COMMAND,
            (request?: ChatPopoutRequest) => this.open(request)
        );
    }

    /**
     * Creates an independent chat editor and moves it to an auxiliary window.
     *
     * Each panel receives its own provider so concurrent chats, speech, and
     * cancellation remain isolated from the sidebar and other pop-outs.
     * A selected persisted session is loaded after its webview becomes ready.
     */
    public async open(request?: ChatPopoutRequest): Promise<void> {
        const session = this.normalizeRequest(request);
        const panel = vscode.window.createWebviewPanel(
            CHAT_POPOUT_VIEW_TYPE,
            'Rusty Refactor Chat',
            vscode.ViewColumn.Active,
            {
                retainContextWhenHidden: true
            }
        );
        const provider = new CodetetherChatViewProvider(
            this.context,
            this.workspaceFiles,
            session
        );

        this.panels.set(panel, provider);
        panel.onDidDispose(() => {
            this.panels.delete(panel);
        });
        provider.resolveWebviewPanel(panel);

        try {
            await vscode.commands.executeCommand(
                MOVE_EDITOR_TO_NEW_WINDOW_COMMAND
            );
        } catch (error) {
            panel.dispose();
            throw error;
        }
    }

    /**
     * Accepts only string session identifiers from command callers.
     */
    private normalizeRequest(
        request: unknown
    ): ChatPopoutRequest | undefined {
        if (!request || typeof request !== 'object') {
            return undefined;
        }

        const value = request as Record<string, unknown>;
        const sessionId = typeof value.sessionId === 'string'
            ? value.sessionId
            : '';
        const sessionPath = typeof value.sessionPath === 'string'
            ? value.sessionPath
            : '';
        if (!sessionId && !sessionPath) {
            return undefined;
        }

        return { sessionId, sessionPath };
    }

    /**
     * Unregisters the command and closes panels during extension shutdown.
     */
    public dispose(): void {
        this.command.dispose();
        for (const panel of this.panels.keys()) {
            panel.dispose();
        }
        this.panels.clear();
    }
}