import * as vscode from 'vscode';

import { CodetetherClient } from '../codetetherClient';
import {
    CodetetherModelOptions,
    normalizeCodetetherModelOptions
} from '../codetetherModelOptions';
import {
    CodetetherSubagentActivity,
    subagentSummary
} from '../codetetherSubagentActivity';
import { logToOutput } from '../extractor';
import type { ChatRunSnapshot } from './chatRunController';
import {
    ChatSpeechService
} from './chatSpeechService';
import type {
    ChatSpeechAudioCommand,
    ChatSpeechVoice
} from './chatSpeechTypes';
import {
    CodetetherSessionOpenResult,
    CodetetherSessionOpenService
} from './codetetherSessionOpenService';
import {
    CodetetherModelOptionsService
} from './codetetherModelOptionsService';
import { ChatWebviewHtml } from './chatWebviewHtml';
import { ChatWorkerLocator } from './chatWorkerLocator';
import { ChatVoiceInputService } from './chatVoiceInputService';
import {
    ChatVoiceInputResult,
    ChatVoiceInputState
} from './chatVoiceInputTypes';
import { CodetetherSessionService } from './codetetherSessions';
import type {
    UserMessageRequest
} from './chatTypes';
import { ChatThreadFileTracker } from './chatThreadFileTracker';
import {
    ChatThreadManager,
    ChatThreadSink,
    ChatThreadSummary
} from './chatThreadManager';
import {
    ChatThreadSubagentTracker
} from './chatThreadSubagentTracker';
import { ModelListService } from './modelListService';
import {
    WorkspaceFileChangeObserver
} from '../workspaceFileChangeService';
import {
    WorkspaceFileOpenService
} from './workspaceFileOpenService';
import {
    ChatPopoutRequest,
    OPEN_CHAT_WINDOW_COMMAND
} from './chatPopoutConstants';

/**
 * Hosts the Codetether chat sidebar and coordinates VS Code webview events.
 */
export class CodetetherChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'rustyRefactor.chatView';
    private static readonly ttsVoiceStateKey = 'codetether.ttsVoiceId';

    private webview?: vscode.Webview;
    private pendingSession?: ChatPopoutRequest;
    private readonly client: CodetetherClient;
    private readonly modelListService: ModelListService;
    private readonly sessionService: CodetetherSessionService;
    private readonly sessionOpenService: CodetetherSessionOpenService;
    private readonly workspaceFileOpener: WorkspaceFileOpenService;
    private readonly modelOptions: CodetetherModelOptionsService;
    private readonly chatThreads: ChatThreadManager;
    private readonly threadFiles: ChatThreadFileTracker;
    private readonly threadSubagents: ChatThreadSubagentTracker;
    private readonly htmlRenderer: ChatWebviewHtml;
    private readonly speechService: ChatSpeechService;
    private readonly voiceInputService: ChatVoiceInputService;

    /**
     * Creates chat collaborators and binds optional initial session state.
     */
    public constructor(
        private readonly context: vscode.ExtensionContext,
        workspaceFiles: WorkspaceFileChangeObserver,
        initialSession?: ChatPopoutRequest
    ) {
        this.pendingSession = initialSession;
        this.client = new CodetetherClient({
            secretStorage: this.context.secrets
        });
        this.modelListService = new ModelListService(this.client);
        this.sessionService = new CodetetherSessionService();
        this.sessionOpenService = new CodetetherSessionOpenService();
        this.workspaceFileOpener = new WorkspaceFileOpenService();
        this.modelOptions = new CodetetherModelOptionsService(
            this.context.globalState
        );
        this.threadFiles = new ChatThreadFileTracker(workspaceFiles);
        this.threadSubagents = new ChatThreadSubagentTracker(
            () => this.workspacePathForSubagentMonitor(),
            activities => this.postSubagentActivities(activities)
        );
        this.chatThreads = new ChatThreadManager(
            this.client,
            this.createChatThreadSink()
        );
        this.htmlRenderer = new ChatWebviewHtml();
        this.speechService = new ChatSpeechService(
            this.context.extensionUri.fsPath,
            state => {
                this.postSpeechState(state);
            },
            command => {
                this.postSpeechAudio(command);
            },
            () => {
                return this.ttsServerUrl();
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
    }

    /**
     * Initializes the chat webview, listeners, and first HTML render.
     */
    public resolveWebviewView(webviewView: vscode.WebviewView): void {
        this.resolveWebview(
            webviewView.webview,
            listener => webviewView.onDidDispose(listener)
        );
    }

    /**
     * Initializes one detached chat panel with the shared surface contract.
     */
    public resolveWebviewPanel(panel: vscode.WebviewPanel): void {
        this.resolveWebview(
            panel.webview,
            listener => panel.onDidDispose(listener)
        );
    }

    /**
     * Binds one webview to this provider and releases its surface resources.
     */
    private resolveWebview(
        webview: vscode.Webview,
        onDidDispose: (
            listener: () => unknown
        ) => vscode.Disposable
    ): void {
        this.webview = webview;
        webview.options = this.webviewOptions();

        const configListener = this.registerConfigListener();
        onDidDispose(() => {
            configListener.dispose();
            this.chatThreads.dispose();
            this.threadSubagents.dispose();
            this.speechService.stop();
            void this.voiceInputService.stop();
            this.webview = undefined;
        });
        webview.onDidReceiveMessage(data => {
            void this.handleWebviewMessage(data);
        });
        webview.html = this.htmlRenderer.render(
            webview,
            this.context.extensionUri,
        );
    }

    /**
     * Starts one editor-originated code task in a visible agent session.
     */
    public async startCodeSession(prompt: string): Promise<void> {
        if (!this.webview) {
            throw new Error('The Codetether sidebar is not ready.');
        }

        const thread = this.chatThreads.createThread();
        const delivered = await this.webview.postMessage({
            type: 'receiveMessage',
            role: 'user',
            content: prompt,
            threadId: thread.id
        });
        if (!delivered) {
            throw new Error('The Codetether sidebar did not accept the task.');
        }

        await this.chatThreads.submit(thread.id, {
            text: prompt,
            modelOptions: this.modelOptions.current(),
            mode: 'agent',
            feature: 'code',
            includeContext: true
        });
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
     * Refreshes sidebar services when their extension settings change.
     */
    private registerConfigListener(): vscode.Disposable {
        return vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration(
                'rustyRefactor.ttsServerUrl'
            )) {
                this.speechService.stop();
                void this.sendVoiceFeatureState();
            }

            const affectsModelDiscovery = [
                'rustyRefactor.codetetherModel',
                'rustyRefactor.codetetherChatTransport',
                'rustyRefactor.codetetherServer',
                'rustyRefactor.codetetherToken',
                'rustyRefactor.codetetherA2AServerUrl',
                'rustyRefactor.codeTether.enabled',
                'rustyRefactor.codeTether.serverUrl',
                'rustyRefactor.useCodetether'
            ].some(setting => event.affectsConfiguration(setting));

            if (!affectsModelDiscovery) {
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
                this.sendChatThreads();
                await this.openPendingSession();
                await this.sendVoiceFeatureState();
                this.sendModelOptions();
                await this.sendModelsList();
                await this.sendSessionsList();
                return;
            case 'refreshModels':
                await this.sendModelsList();
                return;
            case 'setModel':
                await this.setDefaultModel(data.value?.model || '');
                return;
            case 'setModelOptions':
                await this.setModelOptions(data.value?.options);
                return;
            case 'sendMessage':
                await this.handleUserMessage(
                    data.value?.threadId || '',
                    this.toUserMessageRequest(data)
                );
                return;
            case 'interruptChat':
                this.interruptChat(data.value?.threadId || '');
                return;
            case 'newChat':
                this.chatThreads.createThread();
                return;
            case 'selectChatThread':
                this.chatThreads.selectThread(data.value?.threadId || '');
                return;
            case 'refreshSessions':
                await this.sendSessionsList();
                return;
            case 'refreshSubagents':
                await this.refreshSubagentActivities();
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
            case 'openChatWindow':
                await vscode.commands.executeCommand(
                    OPEN_CHAT_WINDOW_COMMAND,
                    {
                        sessionId: data.value?.id || '',
                        sessionPath: data.value?.path || ''
                    } satisfies ChatPopoutRequest
                );
                return;
            case 'openWorkspaceFile':
                await this.workspaceFileOpener.open(data.value);
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
                this.clearChat(data.value?.threadId || '');
                return;
            case 'speakText':
                await this.speakText(
                    data.value?.messageId,
                    data.value?.text,
                    data.value?.voiceId
                );
                return;
            case 'appendSpeechStream':
                this.appendSpeechStream(
                    data.value?.messageId,
                    data.value?.text,
                    data.value?.voiceId
                );
                return;
            case 'finishSpeechStream':
                this.speechService.finishStream(
                    typeof data.value?.messageId === 'string'
                        ? data.value.messageId
                        : ''
                );
                return;
            case 'stopSpeech':
                this.speechService.stop();
                return;
            case 'speechAudioEnded':
                this.speechService.completeWebviewPlayback(
                    data.value?.messageId,
                    data.value?.error
                );
                return;
            case 'startVoiceInput':
                await this.voiceInputService.start();
                return;
            case 'stopVoiceInput':
                await this.voiceInputService.stop();
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

            return `${text.slice(0, maxLen)}...`;
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
            modelOptions: normalizeCodetetherModelOptions(
                data.value?.modelOptions || this.modelOptions.current()
            ),
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
        this.postSidebarError(message);
        this.postStatus('Ready', false);
    }

    /**
     * Clears chat state and notifies the webview to reset visible messages.
     */
    private clearChat(threadId: string): void {
        this.speechService.stop();
        void this.voiceInputService.stop();
        const clearedThreadId = threadId
            || this.chatThreads.activeThreadId();
        if (!this.chatThreads.clearThread(clearedThreadId)) {
            return;
        }

        this.webview?.postMessage({
            type: 'threadCleared',
            threadId: clearedThreadId
        });
    }

    /**
     * Hard-stops one selected response without clearing its conversation.
     */
    private interruptChat(threadId: string): void {
        const targetThreadId = threadId
            || this.chatThreads.activeThreadId();
        if (!this.chatThreads.interruptThread(targetThreadId)) {
            return;
        }
        if (this.chatThreads.isActive(targetThreadId)) {
            this.speechService.stop();
        }
    }

    /**
     * Sends host-owned speech and microphone state to the webview.
     */
    private async sendVoiceFeatureState(): Promise<void> {
        this.speechService.emitSupportStatus();
        await this.voiceInputService.emitSupportStatus();
        await this.sendSpeechVoices();
    }

    /**
     * Starts host-side text to speech for one assistant response.
     */
    private async speakText(
        messageId: unknown,
        text: unknown,
        voiceId: unknown
    ): Promise<void> {
        await this.speechService.speak(
            typeof messageId === 'string' ? messageId : '',
            typeof text === 'string' ? text : '',
            this.toVoiceId(voiceId)
        );
    }

    /**
     * Queues one streamed Markdown fragment for ordered speech playback.
     */
    private appendSpeechStream(
        messageId: unknown,
        text: unknown,
        voiceId: unknown
    ): void {
        this.speechService.appendStream(
            typeof messageId === 'string' ? messageId : '',
            typeof text === 'string' ? text : '',
            this.toVoiceId(voiceId)
        );
    }

    /**
     * Sends installed TTS voices to the webview.
     */
    private async sendSpeechVoices(): Promise<void> {
        const voices = await this.speechService.listVoices();
        this.webview?.postMessage({
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
        if (typeof value === 'string') {
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
     * Reads the configured TTS base URL used for speech synthesis.
     */
    private ttsServerUrl(): string {
        return vscode.workspace
            .getConfiguration('rustyRefactor')
            .get<string>('ttsServerUrl', '')
            .trim();
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
        this.webview?.postMessage({
            type: 'speechState',
            ...state
        });
    }

    /**
     * Posts portable WAV audio for playback on the local webview client.
     */
    private postSpeechAudio(command: ChatSpeechAudioCommand): void {
        const audioBytes = command.action === 'play'
            ? Buffer.byteLength(command.audioBase64, 'base64')
            : 0;
        logToOutput(
            '[Codetether Chat] TTS webview transfer '
            + `action=${command.action} bytes=${audioBytes}`
        );
        const delivery = this.webview?.postMessage({
            type: 'speechAudio',
            ...command
        });
        if (!delivery) {
            logToOutput(
                '[Codetether Chat] TTS webview transfer has no active view'
            );
            return;
        }
        void delivery.then(delivered => {
            logToOutput(
                '[Codetether Chat] TTS webview transfer '
                + `delivered=${String(delivered)}`
            );
        });
    }

    /**
     * Posts microphone recognition state to the webview.
     */
    private postVoiceInputState(state: ChatVoiceInputState): void {
        this.webview?.postMessage({
            type: 'voiceInputState',
            ...state
        });
    }

    /**
     * Posts recognized microphone text to the webview.
     */
    private postVoiceInputResult(result: ChatVoiceInputResult): void {
        this.webview?.postMessage({
            type: 'voiceInputResult',
            ...result
        });
    }

    /**
     * Sends current model choices to the webview through the model service.
     */
    private async sendModelsList(): Promise<void> {
        await this.modelListService.sendModelsList(this.webview);
    }

    /**
     * Sends recent Codetether sessions to the webview for browsing.
     */
    private async sendSessionsList(): Promise<void> {
        const sessions = await this.sessionService.listRecentSessions();

        this.webview?.postMessage({
            type: 'sessionsListed',
            sessions
        });
    }

    /**
     * Loads the persisted session requested when this chat surface was made.
     */
    private async openPendingSession(): Promise<void> {
        const session = this.pendingSession;
        this.pendingSession = undefined;
        if (!session) {
            return;
        }

        if (session.sessionPath) {
            await this.openSession(
                session.sessionPath,
                session.sessionId || ''
            );
            return;
        }
        if (session.sessionId) {
            await this.openSessionById(session.sessionId);
        }
    }

    /**
     * Loads a Codetether session transcript into the current chat view.
     */
    private async openSession(
        sessionPath: string,
        sessionId = ''
    ): Promise<void> {
        const result = await this.sessionOpenService.openSelected(
            sessionPath,
            sessionId
        );
        this.applySessionOpenResult(result);
    }

    /**
     * Loads a Codetether session transcript by id from the shell TUI.
     */
    private async openSessionById(sessionId: string): Promise<void> {
        const result = await this.sessionOpenService.openById(
            sessionId
        );
        this.applySessionOpenResult(result);
    }

    /**
     * Applies a session-load result to provider history and status text.
     */
    private applySessionOpenResult(
        result: CodetetherSessionOpenResult
    ): void {
        if (result.history && result.messages && result.sessionId) {
            const thread = this.chatThreads.openThread(
                result.title || 'Previous chat',
                result.history,
                result.sessionId
            );
            this.webview?.postMessage({
                type: 'sessionLoaded',
                threadId: thread.id,
                sessionId: result.sessionId,
                messages: result.messages
            });
        }
        this.postStatus(result.status, false);
    }

    /**
     * Persists the default model, refreshes options, and shows feedback.
     */
    private async setDefaultModel(model: string): Promise<void> {
        await this.modelListService.setDefaultModel(model);
        this.webview?.postMessage({
            type: 'toast',
            message: model
                ? `Default model saved: ${model}`
                : 'Default model reset to automatic'
        });
        await this.sendModelsList();
    }

    /**
     * Persists validated provider options and returns the canonical snapshot.
     */
    private async setModelOptions(value: unknown): Promise<void> {
        const options = await this.modelOptions.update(value);
        this.postModelOptions(options);
    }

    /**
     * Sends persisted provider options when the webview becomes ready.
     */
    private sendModelOptions(): void {
        this.postModelOptions(this.modelOptions.current());
    }

    /**
     * Posts one validated provider-option snapshot to the webview.
     */
    private postModelOptions(options: CodetetherModelOptions): void {
        this.webview?.postMessage({
            type: 'modelOptionsChanged',
            options
        });
    }

    /**
     * Starts a chat request or steers the currently active protocol run.
     */
    private async handleUserMessage(
        threadId: string,
        request: UserMessageRequest
    ): Promise<void> {
        if (!this.webview) {
            return;
        }

        await this.chatThreads.submit(threadId, request);
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
     * Refreshes the sub-agent panel from local Codetether activity files.
     */
    private async refreshSubagentActivities(): Promise<void> {
        const threadId = this.chatThreads.activeThreadId();
        if (!await this.threadSubagents.refresh(threadId)) {
            this.postStatus('Open a workspace to refresh sub-agents.', false);
            return;
        }

        this.postStatus('Sub-agent activity refreshed.', false);
    }

    /**
     * Connects independent run controllers to thread-scoped side effects.
     */
    private createChatThreadSink(): ChatThreadSink {
        return {
            progress: (threadId, snapshot) => {
                this.postChatProgress(threadId, snapshot);
            },
            tool: (threadId, event) => {
                this.threadFiles.observe(threadId, event);
            },
            status: (threadId, message, busy) => {
                if (this.chatThreads?.isActive(threadId)) {
                    this.postStatus(message, busy);
                }
            },
            start: (threadId, mode, feature) => {
                this.threadFiles.start(threadId);
                this.threadSubagents.start(threadId, mode, feature);
            },
            finish: (threadId, succeeded, toolEvents, interrupted) => {
                this.threadFiles.finish(threadId);
                if (interrupted) {
                    this.threadSubagents.interrupt(threadId);
                    return;
                }
                this.threadSubagents.finish(
                    threadId,
                    succeeded,
                    toolEvents
                );
            },
            threadsChanged: (threads, activeThreadId) => {
                this.postChatThreads(threads, activeThreadId);
                this.threadSubagents.select(activeThreadId);
            }
        };
    }

    /**
     * Reposts the current thread index when the webview becomes ready.
     */
    private sendChatThreads(): void {
        this.postChatThreads(
            this.chatThreads.summaries(),
            this.chatThreads.activeThreadId()
        );
    }

    /**
     * Posts all live threads and the current transcript selection.
     */
    private postChatThreads(
        threads: ChatThreadSummary[],
        activeThreadId: string
    ): void {
        this.webview?.postMessage({
            type: 'chatThreadsChanged',
            threads,
            activeThreadId
        });
    }

    /**
     * Posts one thread's latest progressively rendered response.
     */
    private postChatProgress(
        threadId: string,
        snapshot: ChatRunSnapshot
    ): void {
        this.webview?.postMessage({
            type: 'chatProgress',
            threadId,
            ...snapshot
        });
    }

    /**
     * Posts sub-agent activity rows to the chat webview.
     */
    private postSubagentActivities(
        subagents: CodetetherSubagentActivity[]
    ): void {
        this.webview?.postMessage({
            type: 'subagentsChanged',
            subagents,
            summary: subagentSummary(subagents)
        });
    }

    /**
     * Posts an extension-side sidebar failure without blaming Codetether.
     */
    private postSidebarError(message: string): void {
        this.webview?.postMessage({
            type: 'receiveMessage',
            role: 'assistant',
            content: `**Sidebar error:** ${message}`,
            error: true
        });
    }

    /**
     * Posts the busy/ready state shown in the webview status bar.
     */
    private postStatus(message: string, busy: boolean): void {
        this.webview?.postMessage({
            type: 'status',
            message,
            busy
        });
    }
}