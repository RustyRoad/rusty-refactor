import type { ChatSpeechVoice } from './chatSpeechTypes';

const requestTimeoutMs = 90_000;
const metadataTimeoutMs = 10_000;
const maximumAudioBytes = 128 * 1024 * 1024;
const maximumErrorLength = 500;

interface VoicePayload {
    voice_id?: unknown;
    name?: unknown;
}

interface VoicesPayload {
    voices?: unknown;
}

interface LegacySpeechPayload {
    job_id?: unknown;
}

/**
 * Invokes the TTS API hosted at the configured speech server URL.
 */
export class ChatTtsServerClient {
    /**
     * Reads the current server URL lazily so configuration changes apply.
     */
    public constructor(
        private readonly serverUrl: () => string
    ) {}

    /**
     * Returns whether an HTTP or HTTPS speech endpoint is configured.
     */
    public isConfigured(): boolean {
        try {
            this.endpoint('health');
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Lists validated voice profiles exposed by the speech service.
     */
    public async listVoices(): Promise<ChatSpeechVoice[]> {
        const signal = AbortSignal.timeout(metadataTimeoutMs);
        const payload = await this.requestJson<VoicesPayload>(
            'voices',
            { signal }
        );
        if (!Array.isArray(payload.voices)) {
            throw new Error('The TTS server returned an invalid voice list.');
        }

        return payload.voices
            .map(value => this.toVoice(value))
            .filter(voice => voice !== undefined);
    }

    /**
     * Synthesizes text and returns WAV bytes for local webview playback.
     */
    public async synthesize(
        text: string,
        voiceId: string,
        signal: AbortSignal
    ): Promise<Buffer> {
        const body: Record<string, string> = {
            script: text,
            language: 'english'
        };
        if (voiceId) {
            body.voice_id = voiceId;
        }

        const requestSignal = AbortSignal.any([
            signal,
            AbortSignal.timeout(requestTimeoutMs)
        ]);
        const response = await fetch(this.endpoint('tts/speak'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal: requestSignal
        });
        await this.assertSuccess(response);
        const audio = this.isJson(response)
            ? await this.downloadLegacyAudio(response, requestSignal)
            : await this.readAudio(response);
        this.assertWav(audio);
        return audio;
    }

    /**
     * Converts one untrusted API voice record to the sidebar contract.
     */
    private toVoice(value: unknown): ChatSpeechVoice | undefined {
        if (!value || typeof value !== 'object') {
            return undefined;
        }

        const candidate = value as VoicePayload;
        const id = typeof candidate.voice_id === 'string'
            ? candidate.voice_id.trim()
            : '';
        const name = typeof candidate.name === 'string'
            ? candidate.name.trim()
            : '';
        if (!id || !name) {
            return undefined;
        }
        return { id, name, natural: true };
    }

    /**
     * Downloads audio from the older job-based API response contract.
     */
    private async downloadLegacyAudio(
        response: Response,
        signal: AbortSignal
    ): Promise<Buffer> {
        const payload = await this.parseJson<LegacySpeechPayload>(response);
        const jobId = this.jobId(payload.job_id);
        const output = await fetch(
            this.endpoint(`outputs/${encodeURIComponent(jobId)}`),
            { signal }
        );
        await this.assertSuccess(output);
        return this.readAudio(output);
    }

    /**
     * Validates the opaque synthesis job identifier used by older servers.
     */
    private jobId(value: unknown): string {
        if (typeof value !== 'string'
                || !/^[A-Za-z0-9_-]+$/.test(value)) {
            throw new Error(
                'The TTS server returned an invalid synthesis job.'
            );
        }
        return value;
    }

    /**
     * Fetches and parses one successful JSON response from the speech API.
     */
    private async requestJson<T>(
        path: string,
        init: RequestInit
    ): Promise<T> {
        const response = await fetch(this.endpoint(path), init);
        await this.assertSuccess(response);
        return this.parseJson<T>(response);
    }

    /**
     * Parses JSON while replacing syntax failures with a useful API error.
     */
    private async parseJson<T>(response: Response): Promise<T> {
        try {
            return await response.json() as T;
        } catch {
            throw new Error('The TTS server returned invalid JSON.');
        }
    }

    /**
     * Reads a bounded audio response so a faulty server cannot exhaust the
     * extension host while transferring speech to the webview.
     */
    private async readAudio(response: Response): Promise<Buffer> {
        const declaredSize = Number(
            response.headers.get('content-length') || 0
        );
        if (declaredSize > maximumAudioBytes) {
            throw new Error('TTS audio exceeded the transfer limit.');
        }

        const audio = Buffer.from(await response.arrayBuffer());
        if (audio.byteLength > maximumAudioBytes) {
            throw new Error('TTS audio exceeded the transfer limit.');
        }
        return audio;
    }

    /**
     * Returns whether a response uses the legacy JSON job contract.
     */
    private isJson(response: Response): boolean {
        const contentType = response.headers.get('content-type') ?? '';
        return contentType.toLowerCase().includes('application/json');
    }

    /**
     * Converts a non-success response into a concise user-facing failure.
     */
    private async assertSuccess(response: Response): Promise<void> {
        if (response.ok) {
            return;
        }

        const detail = (await response.text())
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, maximumErrorLength);
        const suffix = detail ? `: ${detail}` : '';
        throw new Error(
            `TTS request failed (${response.status})${suffix}`
        );
    }

    /**
     * Rejects responses that are not RIFF/WAVE audio before transfer.
     */
    private assertWav(audio: Buffer): void {
        const isWave = audio.byteLength >= 12
            && audio.toString('ascii', 0, 4) === 'RIFF'
            && audio.toString('ascii', 8, 12) === 'WAVE';
        if (!isWave) {
            throw new Error('The TTS server returned invalid WAV audio.');
        }
    }

    /**
     * Resolves a relative API path against a validated server base URL.
     */
    private endpoint(path: string): URL {
        const configured = this.serverUrl().trim();
        const base = new URL(
            configured.endsWith('/') ? configured : `${configured}/`
        );
        if (base.protocol !== 'http:' && base.protocol !== 'https:') {
            throw new Error('The TTS URL must use HTTP or HTTPS.');
        }
        return new URL(path, base);
    }
}
