import { splitSpeechText } from './chatSpeechChunker';

/**
 * Builds a direct native worker command for HF synthesis and playback.
 */
export class ChatWindowsSpeechCommand {
    /**
     * Encodes bounded speech chunks as inert native process arguments.
     */
    public build(
        text: string,
        voiceId: string,
        serverUrl: string,
        extensionFolder: string,
        clientExtensionRoot: string
    ): string {
        const worker = this.workerCommand(
            extensionFolder,
            clientExtensionRoot
        );
        const arguments_ = [
            'hf-tts',
            this.utf8Base64(serverUrl),
            this.utf8Base64(voiceId),
            ...splitSpeechText(text).map(chunk => {
                return this.utf8Base64(chunk);
            })
        ];
        return [worker, ...arguments_, ';', 'exit'].join(' ');
    }

    /**
     * Targets the matching locally installed Windows worker executable.
     */
    private workerCommand(
        extensionFolder: string,
        clientExtensionRoot: string
    ): string {
        const folder = this.safePathPart(
            extensionFolder,
            'extension folder'
        );
        const root = this.safePathPart(
            clientExtensionRoot,
            'client extension root'
        );
        const path = [
            '$env:USERPROFILE\\',
            root,
            '\\extensions\\',
            folder,
            '\\rust-backend\\target\\release\\',
            'rusty_refactor_worker.exe'
        ].join('');
        return `& "${path}"`;
    }

    /**
     * Rejects path fragments that could become terminal shell grammar.
     */
    private safePathPart(value: string, label: string): string {
        if (!/^[a-z0-9._-]+$/iu.test(value)) {
            throw new Error(`Invalid Windows speech ${label}.`);
        }
        return value;
    }

    /**
     * Encodes one user-controlled value for grammar-free transport.
     */
    private utf8Base64(value: string): string {
        return Buffer.from(value, 'utf8').toString('base64');
    }
}
