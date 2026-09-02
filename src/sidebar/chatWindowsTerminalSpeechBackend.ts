import * as vscode from 'vscode';
import { basename } from 'path';

import { ChatWindowsSpeechCommand } from './chatWindowsSpeechCommand';

const NEW_LOCAL_TERMINAL_COMMAND =
    'workbench.action.terminal.newLocal';
const SEND_TERMINAL_SEQUENCE_COMMAND =
    'workbench.action.terminal.sendSequence';
const CLOSE_PANEL_COMMAND = 'workbench.action.closePanel';
const INTERRUPT_SEQUENCE = '\u0003';

/**
 * Runs packaged Windows speech from a Remote-SSH extension host.
 */
export class ChatWindowsTerminalSpeechBackend {
    private active = false;
    private finishWait: (() => void) | undefined;
    private readonly command = new ChatWindowsSpeechCommand();

    /**
     * Enables local-terminal speech only for the Remote-SSH client path.
     */
    public constructor(
        private readonly enabled: boolean,
        private readonly serverUrl: () => string,
        private readonly extensionPath: string
    ) {}

    /**
     * Reports whether this extension host should target its Windows client.
     */
    public isSupported(): boolean {
        return this.enabled;
    }

    /**
     * Dispatches speech through the workbench-owned local terminal.
     */
    public async speak(
        text: string,
        voiceId: string
    ): Promise<void> {
        this.stop();
        const command = this.command.build(
            text,
            voiceId,
            this.validServerUrl(),
            basename(this.extensionPath),
            this.clientExtensionRoot()
        );
        await vscode.commands.executeCommand(
            NEW_LOCAL_TERMINAL_COMMAND
        );
        this.active = true;
        try {
            await vscode.commands.executeCommand(
                SEND_TERMINAL_SEQUENCE_COMMAND,
                { text: `${command}\r` }
            );
            await vscode.commands.executeCommand(
                CLOSE_PANEL_COMMAND
            );
            await this.waitForPlayback(text);
        } finally {
            this.active = false;
            this.finishWait = undefined;
        }
    }

    /**
     * Interrupts the workbench-owned speech terminal when it is active.
     */
    public stop(): void {
        const shouldInterrupt = this.active;
        this.active = false;
        this.finishWait?.();
        this.finishWait = undefined;
        if (!shouldInterrupt) {
            return;
        }

        void vscode.commands.executeCommand(
            SEND_TERMINAL_SEQUENCE_COMMAND,
            { text: INTERRUPT_SEQUENCE }
        ).then(
            () => undefined,
            () => undefined
        );
    }

    /**
     * Keeps the Read control active for the expected playback window.
     */
    private waitForPlayback(text: string): Promise<void> {
        return new Promise(resolve => {
            const finish = (): void => {
                clearTimeout(timer);
                if (this.finishWait === finish) {
                    this.finishWait = undefined;
                }
                resolve();
            };
            const timer = setTimeout(finish, this.timeoutMs(text));
            this.finishWait = finish;
        });
    }

    /**
     * Allows roughly one second per word plus process startup headroom.
     */
    private timeoutMs(text: string): number {
        const words = text.trim().split(/\s+/u).filter(Boolean).length;
        return Math.max(15_000, Math.min(10 * 60_000, 10_000 + words * 1_000));
    }

    /**
     * Returns the configured HTTP endpoint for local HF synthesis requests.
     */
    private validServerUrl(): string {
        const configured = this.serverUrl().trim();
        const parsed = new URL(configured);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw new Error('The TTS URL must use HTTP or HTTPS.');
        }
        return configured;
    }

    /**
     * Chooses the local extension directory used by the active client build.
     */
    private clientExtensionRoot(): string {
        return vscode.env.appName.toLowerCase().includes('insiders')
            ? '.vscode-insiders'
            : '.vscode';
    }
}
