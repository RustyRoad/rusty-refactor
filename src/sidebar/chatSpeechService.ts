import { ChatNativeSpeechBackend } from './chatNativeSpeechBackend';
import type {
    ChatSpeechBackend,
    ChatSpeechAudioSink,
    ChatSpeechState,
    ChatSpeechStateSink,
    ChatSpeechVoice
} from './chatSpeechTypes';
import { ChatWebviewSpeechBackend } from './chatWebviewSpeechBackend';
import { ChatSpeechTextPreparer } from './chatSpeechTextPreparer';
import { ChatSpeechStream } from './chatSpeechStream';

/**
 * Coordinates speech state across native and remote-safe backends.
 */
export class ChatSpeechService {
    private activeMessageId = '';
    private generation = 0;
    private readonly nativeBackend: ChatNativeSpeechBackend;
    private readonly webviewBackend: ChatWebviewSpeechBackend;
    private readonly textPreparer = new ChatSpeechTextPreparer();
    private stream: ChatSpeechStream | undefined;

    /**
     * Creates speech backends for one extension host and local webview.
     */
    public constructor(
        extensionPath: string,
        private readonly stateSink: ChatSpeechStateSink,
        audioSink: ChatSpeechAudioSink,
        serverUrl: () => string
    ) {
        this.nativeBackend = new ChatNativeSpeechBackend(extensionPath);
        this.webviewBackend = new ChatWebviewSpeechBackend(
            audioSink,
            serverUrl
        );
    }

    /**
     * Returns whether native or transferable speech is available.
     */
    public isSupported(): boolean {
        return this.nativeBackend.isSupported()
            || this.webviewBackend.isSupported();
    }

    /**
     * Starts reading one assistant response on the appropriate client.
     */
    public async speak(
        messageId: string,
        text: string,
        voiceId = ''
    ): Promise<void> {
        const prepared = this.prepareText(text);
        if (!messageId || !prepared) {
            this.emitStopped(messageId, 'No response text to read.');
            return;
        }

        this.stop();
        const generation = this.generation;
        this.activeMessageId = messageId;
        this.emit({ messageId, speaking: true, supported: true });

        try {
            if (this.webviewBackend.isSupported()) {
                await this.webviewBackend.speak(
                    messageId,
                    prepared,
                    voiceId
                );
                return;
            }

            await this.nativeBackend.speak(prepared, voiceId);
            this.completeRequest(generation, messageId);
        } catch (error) {
            this.failRequest(generation, messageId, error);
        }
    }

    /**
     * Queues one raw Markdown fragment from an active streamed response.
     */
    public appendStream(
        messageId: string,
        text: string,
        voiceId = ''
    ): void {
        const prepared = this.prepareStreamText(text);
        if (!messageId) {
            return;
        }
        const stream = this.ensureStream(messageId, voiceId);
        if (prepared) {
            stream.append(prepared);
        }
    }

    /**
     * Closes streamed speech after every queued fragment is dispatched.
     */
    public finishStream(messageId: string): void {
        if (!messageId || messageId !== this.activeMessageId) {
            return;
        }
        this.stream?.finish();
    }

    /**
     * Stops native playback, remote synthesis, and local webview audio.
     */
    public stop(): void {
        this.generation += 1;
        const messageId = this.activeMessageId;
        this.activeMessageId = '';
        this.stream?.cancel();
        this.stream = undefined;
        this.nativeBackend.stop();
        this.webviewBackend.stop();
        this.emitStopped(messageId);
    }

    /**
     * Completes transferred playback after the local webview reports it.
     */
    public completeWebviewPlayback(
        messageId: unknown,
        error: unknown
    ): void {
        const id = typeof messageId === 'string' ? messageId : '';
        if (!id || id !== this.activeMessageId) {
            return;
        }

        this.activeMessageId = '';
        const detail = typeof error === 'string' && error.trim()
            ? error.trim()
            : undefined;
        this.emitStopped(id, detail);
    }

    /**
     * Stops speech and releases backend state during extension disposal.
     */
    public dispose(): void {
        this.stop();
    }

    /**
     * Emits the current support and playback state to the webview.
     */
    public emitSupportStatus(): void {
        this.emit({
            messageId: this.activeMessageId,
            speaking: Boolean(this.activeMessageId),
            supported: this.isSupported(),
        });
    }

    /**
     * Lists voices for the backend that will handle the next request.
     */
    public async listVoices(): Promise<ChatSpeechVoice[]> {
        if (this.webviewBackend.isSupported()) {
            try {
                return await this.webviewBackend.listVoices();
            } catch {
                return this.nativeVoices();
            }
        }
        return this.nativeVoices();
    }

    /**
     * Lists native voices when remote speech metadata is unavailable.
     */
    private async nativeVoices(): Promise<ChatSpeechVoice[]> {
        if (!this.nativeBackend.isSupported()) {
            return [];
        }
        try {
            return await this.nativeBackend.listVoices();
        } catch {
            return [];
        }
    }

    /**
     * Normalizes large assistant responses before speech synthesis.
     */
    private prepareText(text: string): string {
        return this.textPreparer
            .prepare(String(text || ''))
            .slice(0, 20000);
    }

    /**
     * Keeps streamed narrative while silently omitting structured fragments.
     */
    private prepareStreamText(text: string): string {
        return this.textPreparer
            .prepareFragment(String(text || ''))
            .slice(0, 20000);
    }

    /**
     * Starts or reuses the ordered queue for one streamed response.
     */
    private ensureStream(
        messageId: string,
        voiceId: string
    ): ChatSpeechStream {
        if (this.stream && messageId === this.activeMessageId) {
            return this.stream;
        }
        this.stop();
        const generation = this.generation;
        this.activeMessageId = messageId;
        this.emit({ messageId, speaking: true, supported: true });
        this.stream = new ChatSpeechStream(
            text => this.playStreamFragment(
                generation,
                messageId,
                text,
                voiceId
            ),
            () => this.completeStream(generation, messageId),
            error => this.failRequest(generation, messageId, error)
        );
        return this.stream;
    }

    /**
     * Sends one fragment through the backend selected for this environment.
     */
    private async playStreamFragment(
        generation: number,
        messageId: string,
        text: string,
        voiceId: string
    ): Promise<void> {
        if (!this.isCurrent(generation, messageId)) {
            return;
        }
        if (this.webviewBackend.isSupported()) {
            await this.webviewBackend.append(
                messageId,
                text,
                voiceId
            );
            return;
        }
        await this.nativeBackend.speak(text, voiceId);
    }

    /**
     * Completes native playback or marks transferred audio input finished.
     */
    private completeStream(
        generation: number,
        messageId: string
    ): void {
        if (!this.isCurrent(generation, messageId)) {
            return;
        }
        this.stream = undefined;
        if (this.webviewBackend.isSupported()) {
            this.webviewBackend.finish(messageId);
            return;
        }
        this.completeRequest(generation, messageId);
    }

    /**
     * Completes a native request when it remains the active generation.
     */
    private completeRequest(
        generation: number,
        messageId: string
    ): void {
        if (!this.isCurrent(generation, messageId)) {
            return;
        }

        this.activeMessageId = '';
        this.emitStopped(messageId);
    }

    /**
     * Reports a backend failure when its request is still active.
     */
    private failRequest(
        generation: number,
        messageId: string,
        error: unknown
    ): void {
        if (!this.isCurrent(generation, messageId)) {
            return;
        }

        const detail = error instanceof Error
            ? error.message
            : String(error);
        console.error(
            `[Codetether Chat] Speech failed: ${detail}`
        );
        this.activeMessageId = '';
        this.emitStopped(messageId, detail);
    }

    /**
     * Checks whether an asynchronous result belongs to the active request.
     */
    private isCurrent(
        generation: number,
        messageId: string
    ): boolean {
        return generation === this.generation
            && messageId === this.activeMessageId;
    }

    /**
     * Emits a non-speaking state, optionally with an error.
     */
    private emitStopped(messageId: string, error?: string): void {
        this.emit({
            messageId,
            speaking: false,
            supported: this.isSupported(),
            error,
        });
    }

    /**
     * Sends one speech state update to the configured sink.
     */
    private emit(state: Omit<ChatSpeechState, 'backend'>): void {
        this.stateSink({
            ...state,
            backend: this.backend()
        });
    }

    /**
     * Identifies the playback implementation used in this environment.
     */
    private backend(): ChatSpeechBackend {
        if (this.webviewBackend.isSupported()) {
            return 'server';
        }
        if (this.nativeBackend.isSupported()) {
            return 'native';
        }
        return 'none';
    }
}
