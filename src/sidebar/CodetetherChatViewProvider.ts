import * as vscode from 'vscode';

import { ChatMessage, CodetetherClient } from '../codetetherClient';
import { logToOutput } from '../extractor';
import { AgentPromptBuilder } from './agentPromptBuilder';
import { CHAT_SYSTEM_PROMPT } from './chatConstants';
import { ChatWebviewHtml } from './chatWebviewHtml';
import {
    normalizeFeature,
    normalizeMode,
    statusForMode
} from './chatModes';
import { CodetetherSessionService } from './codetetherSessions';
import { ChatHistory, UserMessageRequest } from './chatTypes';
import { ModelListService } from './modelListService';

/**
 * Hosts the Codetether chat sidebar and coordinates VS Code webview events.
 */
export class CodetetherChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'rustyRefactor.chatView';

    private view?: vscode.WebviewView;
    private readonly client: CodetetherClient;
    private readonly modelListService: ModelListService;
    private readonly sessionService: CodetetherSessionService;
    private readonly promptBuilder: AgentPromptBuilder;
    private readonly htmlRenderer: ChatWebviewHtml;
    private chatHistory: ChatHistory = [];

    public constructor(private readonly extensionUri: vscode.Uri) {
        this.client = new CodetetherClient();
        this.modelListService = new ModelListService(this.client);
        this.sessionService = new CodetetherSessionService();
        this.promptBuilder = new AgentPromptBuilder();
        this.htmlRenderer = new ChatWebviewHtml();
        this.resetChatHistory();
    }

    /**
     * Initializes the chat webview, listeners, and first HTML render.
     */
    public resolveWebviewView(webviewView: vscode.WebviewView): void {
        this.view = webviewView;
        webviewView.webview.options = this.webviewOptions();

        const configListener = this.registerConfigListener();
        webviewView.onDidDispose(() => configListener.dispose());
        webviewView.webview.onDidReceiveMessage(data => {
            void this.handleWebviewMessage(data);
        });
        webviewView.webview.html = this.htmlRenderer.render(
            webviewView.webview,
            this.extensionUri,
        );
    }

    /**
     * Builds script and local-resource permissions for this webview only.
     */
    private webviewOptions(): vscode.WebviewOptions {
        return {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };
    }

    /**
     * Refreshes model configuration when the user changes extension settings.
     */
    private registerConfigListener(): vscode.Disposable {
        return vscode.workspace.onDidChangeConfiguration(event => {
            if (!event.affectsConfiguration('rustyRefactor.codetetherModel')) {
                return;
            }

            this.client.refreshConfig();
            void this.sendModelsList();
        });
    }

    /**
     * Routes a webview message to the matching sidebar behavior.
     */
    private async handleWebviewMessage(data: any): Promise<void> {
        try {
            this.logWebviewMessageSummary(data);
            await this.dispatchWebviewMessage(data);
        } catch (error) {
            this.handleWebviewError(error);
        }
    }

    /**
     * Dispatches trusted webview event types to focused handlers.
     */
    private async dispatchWebviewMessage(data: any): Promise<void> {
        switch (data?.type) {
            case 'webviewReady':
                await this.sendModelsList();
                await this.sendSessionsList();
                return;
            case 'refreshModels':
                await this.sendModelsList();
                return;
            case 'setModel':
                await this.setDefaultModel(data.value?.model || '');
                return;
            case 'sendMessage':
                await this.handleUserMessage(this.toUserMessageRequest(data));
                return;
            case 'refreshSessions':
                await this.sendSessionsList();
                return;
            case 'openSession':
                await this.openSession(data.value?.path || '');
                return;
            case 'openTui':
                await vscode.commands.executeCommand(
                    'rustyRefactor.openCodetetherTui'
                );
                return;
            case 'log':
                logToOutput(
                    `[Codetether Chat WebView] ${data.message || ''}`
                );
                return;
            case 'uiTelemetry':
                this.handleUiTelemetry(data.value);
                return;
            case 'clearChat':
                this.clearChat();
                return;
        }
    }

    /**
     * Logs a concise summary for each incoming webview message type.
     */
    private logWebviewMessageSummary(data: any): void {
        const type = String(data?.type || 'unknown');

        if (type === 'log' || type === 'uiTelemetry') {
            return;
        }

        logToOutput(`[Codetether Chat] UI event received: ${type}`);
    }

    /**
     * Emits structured telemetry-style logs sent from the webview script.
     */
    private handleUiTelemetry(value: any): void {
        const event = String(value?.event || 'unknown');
        const detail = value?.detail && typeof value.detail === 'object'
            ? value.detail
            : {};

        const compact = this.compactTelemetryDetail(detail);
        logToOutput(
            `[Codetether Telemetry] event=${event} detail=${compact}`
        );
    }

    /**
     * Serializes telemetry details while keeping log lines compact.
     */
    private compactTelemetryDetail(detail: Record<string, unknown>): string {
        try {
            const text = JSON.stringify(detail);
            const maxLen = 500;

            if (text.length <= maxLen) {
                return text;
            }

            return `${text.slice(0, maxLen)}…`;
        } catch {
            return '{"error":"unserializable telemetry detail"}';
        }
    }

    /**
     * Converts raw webview data to the typed user message request shape.
     */
    private toUserMessageRequest(data: any): UserMessageRequest {
        return {
            text: data.value?.text || '',
            model: data.value?.model,
            mode: data.value?.mode,
            feature: data.value?.feature,
            includeContext: Boolean(data.value?.includeContext)
        };
    }

    /**
     * Reports a webview handling failure to logs and the chat UI.
     */
    private handleWebviewError(error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);

        logToOutput(
            `[Codetether Chat] Failed to handle webview message: ${message}`
        );
        this.postAssistantError(message);
        this.postStatus('Ready', false);
    }

    /**
     * Restores the chat history to the system prompt only.
     */
    private resetChatHistory(): void {
        this.chatHistory = [{ role: 'system', content: CHAT_SYSTEM_PROMPT }];
    }

    /**
     * Clears chat state and notifies the webview to reset visible messages.
     */
    private clearChat(): void {
        this.resetChatHistory();
        this.view?.webview.postMessage({ type: 'cleared' });
    }

    /**
     * Sends current model choices to the webview through the model service.
     */
    private async sendModelsList(): Promise<void> {
        await this.modelListService.sendModelsList(this.view);
    }

    /**
     * Sends recent Codetether sessions to the webview for browsing.
     */
    private async sendSessionsList(): Promise<void> {
        const sessions = await this.sessionService.listRecentSessions();

        this.view?.webview.postMessage({
            type: 'sessionsListed',
            sessions
        });
    }

    /**
     * Opens a Codetether session folder after validating the webview path.
     */
    private async openSession(sessionPath: string): Promise<void> {
        if (!sessionPath) {
            return;
        }

        const sessions = await this.sessionService.listRecentSessions(100);
        const session = sessions.find(item => item.path === sessionPath);
        if (!session) {
            return;
        }

        await vscode.commands.executeCommand(
            'vscode.openFolder',
            vscode.Uri.file(session.path),
            { forceNewWindow: true }
        );
    }

    /**
     * Persists the default model, refreshes options, and shows feedback.
     */
    private async setDefaultModel(model: string): Promise<void> {
        await this.modelListService.setDefaultModel(model);
        this.view?.webview.postMessage({
            type: 'toast',
            message: model
                ? `Default model saved: ${model}`
                : 'Default model reset to automatic'
        });
        await this.sendModelsList();
    }

    /**
     * Sends a user message to Codetether and relays the assistant response.
     */
    private async handleUserMessage(
        request: UserMessageRequest
    ): Promise<void> {
        if (!this.view) {
            return;
        }

        const trimmed = request.text.trim();
        if (!trimmed) {
            return;
        }

        const mode = normalizeMode(request.mode);
        const feature = normalizeFeature(request.feature);
        const prompt = await this.promptBuilder.buildAgentPrompt(
            trimmed,
            mode,
            feature,
            request.includeContext
        );

        this.chatHistory.push({ role: 'user', content: prompt });
        this.postStatus(statusForMode(mode), true);

        await this.sendChatCompletion(request.model);
    }

    /**
     * Calls the client for a completion and records the assistant message.
     */
    private async sendChatCompletion(modelOverride?: string): Promise<void> {
        try {
            const response = await this.client.chatCompletion(
                this.chatHistory,
                { model: modelOverride || undefined }
            );
            const assistantMessage = this.toAssistantMessage(response);
            this.chatHistory.push(assistantMessage);

            this.postAssistantMessage(
                response.text || '*(No response text returned.)*'
            );
        } catch (error) {
            this.postAssistantError(this.chatErrorMessage(error));
        } finally {
            this.postStatus('Ready', false);
        }
    }

    /**
     * Converts a client response to the stored chat message format.
     */
    private toAssistantMessage(response: {
        text?: string;
        tool_calls?: ChatMessage['tool_calls'];
    }): ChatMessage {
        const assistantMessage: ChatMessage = { role: 'assistant' };

        if (response.text) {
            assistantMessage.content = response.text;
        }
        if (response.tool_calls) {
            assistantMessage.tool_calls = response.tool_calls;
        }

        return assistantMessage;
    }

    /**
     * Extracts a displayable error message from unknown thrown values.
     */
    private chatErrorMessage(error: unknown): string {
        return error instanceof Error
            ? error.message
            : 'Unknown error occurred';
    }

    /**
     * Posts a user bubble to the webview.
     */
    private postUserMessage(content: string): void {
        this.view?.webview.postMessage({
            type: 'receiveMessage',
            role: 'user',
            content
        });
    }

    /**
     * Posts a successful assistant bubble to the webview.
     */
    private postAssistantMessage(content: string): void {
        this.view?.webview.postMessage({
            type: 'receiveMessage',
            role: 'assistant',
            content
        });
    }

    /**
     * Posts an assistant error bubble using the webview's error styling.
     */
    private postAssistantError(message: string): void {
        this.view?.webview.postMessage({
            type: 'receiveMessage',
            role: 'assistant',
            content: `**Codetether error:** ${message}`,
            error: true
        });
    }

    /**
     * Posts the busy/ready state shown in the webview status bar.
     */
    private postStatus(message: string, busy: boolean): void {
        this.view?.webview.postMessage({
            type: 'status',
            message,
            busy
        });
    }
}
