import { ChatTtsServerClient } from './chatTtsServerClient';
import { splitSpeechText } from './chatSpeechChunker';
import type {
    ChatSpeechAudioSink,
    ChatSpeechVoice
} from './chatSpeechTypes';

/**
 * Narrow server-client contract required by progressive speech synthesis.
 */
interface ChatSpeechServerClient {
    isConfigured(): boolean;
    listVoices(): Promise<ChatSpeechVoice[]>;
    synthesize(
        text: string,
        voiceId: string,
        signal: AbortSignal
    ): Promise<Buffer>;
}

/**
 * Synthesizes remote-host speech for playback in the local webview.
 */
export class ChatWebviewSpeechBackend {
    private controller: AbortController | undefined;

    /**
     * Binds server synthesis to the webview audio command sink.
     */
    public constructor(
        private readonly sink: ChatSpeechAudioSink,
        serverUrl: () => string,
        private readonly client: ChatSpeechServerClient =
            new ChatTtsServerClient(serverUrl)
    ) {
    }

    /**
     * Lists voice profiles currently available from the speech service.
     */
    public listVoices(): Promise<ChatSpeechVoice[]> {
        return this.client.listVoices();
    }

    /**
     * Returns whether a valid server URL can target the local webview.
     */
    public isSupported(): boolean {
        return this.client.isConfigured();
    }

    /**
     * Synthesizes bounded WAV chunks for progressive webview playback.
     */
    public async speak(
        messageId: string,
        text: string,
        voiceId: string
    ): Promise<void> {
        this.controller?.abort();
        await this.synthesize(
            messageId,
            text,
            voiceId,
            true
        );
    }

    /**
     * Synthesizes one streamed fragment without closing local playback.
     */
    public async append(
        messageId: string,
        text: string,
        voiceId: string
    ): Promise<void> {
        await this.synthesize(
            messageId,
            text,
            voiceId,
            false
        );
    }

    /**
     * Marks all transferred fragments as a complete speech stream.
     */
    public finish(messageId: string): void {
        this.sink({ action: 'finish', messageId });
    }

    /**
     * Converts bounded text chunks into ordered local audio commands.
     */
    private async synthesize(
        messageId: string,
        text: string,
        voiceId: string,
        markLastFinal: boolean
    ): Promise<void> {
        const controller = new AbortController();
        this.controller = controller;
        try {
            const chunks = splitSpeechText(text);
            for (let index = 0; index < chunks.length; index += 1) {
                const audio = await this.client.synthesize(
                    chunks[index],
                    voiceId,
                    controller.signal
                );
                if (controller.signal.aborted) {
                    return;
                }
                this.sink({
                    action: 'play',
                    messageId,
                    audioBase64: audio.toString('base64'),
                    final: markLastFinal
                        && index === chunks.length - 1
                });
            }
        } catch (error) {
            if (!controller.signal.aborted) {
                this.sink({ action: 'stop', messageId: '' });
            }
            throw error;
        } finally {
            if (this.controller === controller) {
                this.controller = undefined;
            }
        }
    }

    /**
     * Cancels synthesis and stops transferred webview audio.
     */
    public stop(): void {
        this.controller?.abort();
        this.controller = undefined;
        this.sink({ action: 'stop', messageId: '' });
    }
}
