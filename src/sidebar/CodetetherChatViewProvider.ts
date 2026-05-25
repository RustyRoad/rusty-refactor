import * as vscode from 'vscode';

import { ChatMessage, CodetetherClient } from '../codetetherClient';
import {
    CodetetherSubagentActivity,
    coordinatorSubagentActivity,
    finishSubagentActivity,
    mergeSubagentActivity,
    subagentActivityFromToolEvents,
    subagentSummary
} from '../codetetherSubagentActivity';
import { CodetetherToolEvent } from '../codetetherToolEvents';
import { logToOutput } from '../extractor';
import { AgentPromptBuilder } from './agentPromptBuilder';
import { CHAT_SYSTEM_PROMPT } from './chatConstants';
import {
    ChatSpeechService,
    ChatSpeechVoice
} from './chatSpeechService';
import { ChatWebviewHtml } from './chatWebviewHtml';
import { ChatWorkerLocator } from './chatWorkerLocator';
import { ChatVoiceInputService } from './chatVoiceInputService';
import {
    ChatVoiceInputResult,
    ChatVoiceInputState
} from './chatVoiceInputTypes';
import {
    normalizeFeature,
    normalizeMode,
    statusForMode
} from './chatModes';
import { CodetetherSessionService } from './codetetherSessions';
import {
    ChatHistory,
    ChatMode,
    CodetetherFeature,
    UserMessageRequest
} from './chatTypes';
import { ModelListService } from './modelListService';
import { SubagentSessionMonitor } from './subagentSessionMonitor';

/**
 * Hosts the Codetether chat sidebar and coordinates VS Code webview events.
 */
export class CodetetherChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'rustyRefactor.chatView';
    private static readonly ttsVoiceStateKey = 'codetether.ttsVoiceId';

    private view?: vscode.WebviewView;
    private readonly client: CodetetherClient;
    private readonly modelListService: ModelListService;
    private readonly sessionService: CodetetherSessionService;
    private readonly promptBuilder: AgentPromptBuilder;
    private readonly htmlRenderer: ChatWebviewHtml;
    private readonly speechService: ChatSpeechService;
    private readonly voiceInputService: ChatVoiceInputService;
    private chatHistory: ChatHistory = [];
    private autoSpeakNextResponse = false;
    private subagentActivities: CodetetherSubagentActivity[] = [];
    private subagentMonitor?: SubagentSessionMonitor;

    /**
     * Creates sidebar collaborators and binds persisted extension state.
     */
    public constructor(
        private readonly context: vscode.ExtensionContext
    ) {
        this.client = new CodetetherClient();
        this.modelListService = new ModelListService(this.client);
        this.sessionService = new CodetetherSessionService();
        this.promptBuilder = new AgentPromptBuilder();
        this.htmlRenderer = new ChatWebviewHtml();
        this.speechService = new ChatSpeechService(
            this.context.extensionUri.fsPath,
            state => {
                this.postSpeechState(state);
            }
        );
        const workerLocator = new ChatWorkerLocator(
            this.context.extensionUri.fsPath
        );
        this.voiceInputService = new ChatVoiceInputService(
            workerLocator.workerPath(),
            state => {
                this.postVoiceInputState(state);
            },
            result => {
                this.postVoiceInputResult(result);
            }
        );
        this.resetChatHistory();
    }

    /**
     * Initializes the chat webview, listeners, and first HTML render.
     */
    public resolveWebviewView(webviewView: vscode.WebviewView): void {
        this.view = webviewView;
        webviewView.webview.options = this.webviewOptions();

        const configListener = this.registerConfigListener();
        webviewView.onDidDispose(() => {
            configListener.dispose();
            this.stopSubagentMonitor();
            this.speechService.stop();
            this.voiceInputService.stop();
        });
        webviewView.webview.onDidReceiveMessage(data => {
            void this.handleWebviewMessage(data);
        });
        webviewView.webview.html = this.htmlRenderer.render(
            webviewView.webview,
            this.context.extensionUri,
        );
    }

    /**
     * Builds script and local-resource permissions for this webview only.
     */
    private webviewOptions(): vscode.WebviewOptions {
        return {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri]
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
                await this.sendSpeechSupport();
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
                await this.openSession(
                    data.value?.path || '',
                    data.value?.id || ''
                );
                return;
            case 'openSessionById':
                await this.openSessionById(data.value?.id || '');
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
            case 'speakText':
                this.speakText(
                    data.value?.messageId,
                    data.value?.text,
                    data.value?.voiceId
                );
                return;
            case 'stopSpeech':
                this.speechService.stop();
                return;
            case 'startVoiceInput':
                this.voiceInputService.start();
                return;
            case 'stopVoiceInput':
                this.voiceInputService.stop();
                return;
            case 'setVoiceInputSource':
                this.voiceInputService.setInput(
                    data.value?.sourceId || ''
                );
                return;
            case 'setTtsVoice':
                await this.setTtsVoice(data.value?.voiceId || '');
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
            includeContext: Boolean(data.value?.includeContext),
            autoSpeak: Boolean(data.value?.autoSpeak)
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
        this.speechService.stop();
        this.voiceInputService.stop();
        this.stopSubagentMonitor();
        this.postSubagentActivities([]);
        this.resetChatHistory();
        this.view?.webview.postMessage({ type: 'cleared' });
    }

    /**
     * Starts host-side text to speech for one assistant response.
     */
    private speakText(
        messageId: unknown,
        text: unknown,
        voiceId: unknown
    ): void {
        this.speechService.speak(
            typeof messageId === 'string' ? messageId : '',
            typeof text === 'string' ? text : '',
            this.toVoiceId(voiceId)
        );
    }

    /**
     * Sends current host speech support to the webview.
     */
    private async sendSpeechSupport(): Promise<void> {
        this.speechService.emitSupportStatus();
        this.voiceInputService.emitSupportStatus();
        await this.sendSpeechVoices();
    }

    /**
     * Sends installed TTS voices to the webview.
     */
    private async sendSpeechVoices(): Promise<void> {
        const voices = await this.speechService.listVoices();
        this.view?.webview.postMessage({
            type: 'speechVoicesListed',
            voices,
            selectedVoiceId: this.configuredTtsVoiceId(voices)
        });
    }

    /**
     * Persists the selected TTS voice id in extension-owned state.
     */
    private async setTtsVoice(voiceId: string): Promise<void> {
        await this.context.globalState.update(
            CodetetherChatViewProvider.ttsVoiceStateKey,
            voiceId
        );
        await this.sendSpeechVoices();
    }

    /**
     * Returns a valid voice id from input or persisted extension state.
     */
    private toVoiceId(value: unknown): string {
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }

        return this.persistedTtsVoiceId();
    }

    /**
     * Reads the TTS voice id saved by the chat sidebar.
     */
    private persistedTtsVoiceId(): string {
        return this.context.globalState.get<string>(
            CodetetherChatViewProvider.ttsVoiceStateKey,
            ''
        );
    }

    /**
     * Reads configured TTS voice id only when it still exists.
     */
    private configuredTtsVoiceId(voices: ChatSpeechVoice[]): string {
        const configured = this.persistedTtsVoiceId();
        if (!configured) {
            return '';
        }

        return voices.some(voice => voice.id === configured)
            ? configured
            : '';
    }

    /**
     * Posts speech playback state to the webview.
     */
    private postSpeechState(state: {
        messageId: string;
        speaking: boolean;
        supported: boolean;
        error?: string;
    }): void {
        this.view?.webview.postMessage({
            type: 'speechState',
            ...state
        });
    }

    /**
     * Posts microphone recognition state to the webview.
     */
    private postVoiceInputState(state: ChatVoiceInputState): void {
        this.view?.webview.postMessage({
            type: 'voiceInputState',
            ...state
        });
    }

    /**
     * Posts recognized microphone text to the webview.
     */
    private postVoiceInputResult(result: ChatVoiceInputResult): void {
        this.view?.webview.postMessage({
            type: 'voiceInputResult',
            ...result
        });
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
    private async openSession(
        sessionPath: string,
        sessionId = ''
    ): Promise<void> {
        const sessions = await this.sessionService.listRecentSessions(200);
        const session = sessions.find(item => {
            return item.path === sessionPath || item.id === sessionId;
        });
        if (!session) {
            this.postStatus('Session not found.', false);
            return;
        }

        await this.openSessionSummary(session);
    }

    /**
     * Opens a Codetether session folder by id from the shell TUI.
     */
    private async openSessionById(sessionId: string): Promise<void> {
        const session = await this.sessionService.findSessionById(sessionId);
        if (!session) {
            this.postStatus(`Session not found: ${sessionId}`, false);
            return;
        }

        await this.openSessionSummary(session);
    }

    /**
     * Opens the folder that stores one persisted Codetether session.
     */
    private async openSessionSummary(
        session: { path: string }
    ): Promise<void> {
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
        this.autoSpeakNextResponse = Boolean(request.autoSpeak);
        this.postStatus(statusForMode(mode), true);
        this.startSubagentView(mode, feature);

        await this.sendChatCompletion(request.model);
    }

    /**
     * Calls the client for a completion and records the assistant message.
     */
    private async sendChatCompletion(modelOverride?: string): Promise<void> {
        const autoSpeak = this.autoSpeakNextResponse;
        this.autoSpeakNextResponse = false;

        try {
            const response = await this.client.chatCompletion(
                this.chatHistory,
                { model: modelOverride || undefined }
            );
            const assistantMessage = this.toAssistantMessage(response);
            this.chatHistory.push(assistantMessage);
            const toolEvents = this.responseToolEvents(response);

            this.postAssistantMessage(
                response.text || '*(No response text returned.)*',
                toolEvents,
                response.session_id,
                autoSpeak
            );
            this.finishSubagentView(true, toolEvents);
        } catch (error) {
            this.finishSubagentView(false);
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
     * Converts response tool metadata into the webview timeline shape.
     */
    private responseToolEvents(response: {
        tool_events?: CodetetherToolEvent[];
        tool_calls?: ChatMessage['tool_calls'];
    }): CodetetherToolEvent[] {
        if (response.tool_events && response.tool_events.length > 0) {
            return response.tool_events;
        }

        return (response.tool_calls ?? []).map(toolCall => ({
            kind: 'call',
            id: toolCall.id,
            name: toolCall.name,
            arguments: toolCall.arguments
        }));
    }

    /**
     * Starts the visible sub-agent panel for modes that may delegate work.
     */
    private startSubagentView(
        mode: ChatMode,
        feature: CodetetherFeature
    ): void {
        this.stopSubagentMonitor();

        if (!this.shouldShowSubagentView(mode, feature)) {
            this.subagentActivities = [];
            this.postSubagentActivities([]);
            return;
        }

        this.subagentActivities = [coordinatorSubagentActivity()];
        this.postSubagentActivities(this.subagentActivities);
        this.startSubagentMonitor();
    }

    /**
     * Returns whether the current request should expose coordination state.
     */
    private shouldShowSubagentView(
        mode: ChatMode,
        feature: CodetetherFeature
    ): boolean {
        return mode === 'orchestrate'
            || feature === 'swarm'
            || feature === 'prd';
    }

    /**
     * Starts polling Codetether sessions for spawned sub-agent sessions.
     */
    private startSubagentMonitor(): void {
        const workspacePath = this.workspacePathForSubagentMonitor();
        if (!workspacePath) {
            return;
        }

        this.subagentMonitor = new SubagentSessionMonitor(
            workspacePath,
            activities => {
                this.mergeAndPostSubagentActivities(activities);
            }
        );
        this.subagentMonitor.start();
    }

    /**
     * Returns the workspace path used by Codetether session persistence.
     */
    private workspacePathForSubagentMonitor(): string {
        const activeUri = vscode.window.activeTextEditor?.document.uri;
        const activeFolder = activeUri
            ? vscode.workspace.getWorkspaceFolder(activeUri)
            : undefined;
        const fallbackFolder = vscode.workspace.workspaceFolders?.[0];
        const folder = activeFolder || fallbackFolder;

        return folder?.uri.fsPath || '';
    }

    /**
     * Merges new activity rows into the current panel state.
     */
    private mergeAndPostSubagentActivities(
        activities: CodetetherSubagentActivity[]
    ): void {
        this.subagentActivities = mergeSubagentActivity(
            this.subagentActivities,
            activities
        );
        this.postSubagentActivities(this.subagentActivities);
    }

    /**
     * Finalizes activity rows once the Codetether request finishes.
     */
    private finishSubagentView(
        succeeded: boolean,
        toolEvents: CodetetherToolEvent[] = []
    ): void {
        this.stopSubagentMonitor();
        const toolActivities = subagentActivityFromToolEvents(toolEvents);

        if (this.subagentActivities.length === 0
                && toolActivities.length === 0) {
            this.postSubagentActivities([]);
            return;
        }

        const merged = mergeSubagentActivity(
            this.subagentActivities,
            toolActivities
        );
        this.subagentActivities = finishSubagentActivity(merged, succeeded);
        this.postSubagentActivities(this.subagentActivities);
    }

    /**
     * Stops the active sub-agent session monitor if one is running.
     */
    private stopSubagentMonitor(): void {
        this.subagentMonitor?.stop();
        this.subagentMonitor = undefined;
    }

    /**
     * Posts sub-agent activity rows to the chat webview.
     */
    private postSubagentActivities(
        subagents: CodetetherSubagentActivity[]
    ): void {
        this.view?.webview.postMessage({
            type: 'subagentsChanged',
            subagents,
            summary: subagentSummary(subagents)
        });
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
     * Posts a successful assistant bubble and optional tool timeline.
     */
    private postAssistantMessage(
        content: string,
        toolEvents: CodetetherToolEvent[] = [],
        sessionId?: string,
        autoSpeak = false
    ): void {
        this.view?.webview.postMessage({
            type: 'receiveMessage',
            role: 'assistant',
            content,
            toolEvents,
            sessionId,
            autoSpeak
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
