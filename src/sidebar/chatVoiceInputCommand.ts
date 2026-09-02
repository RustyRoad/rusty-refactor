import * as vscode from 'vscode';

import { ChatVoiceInputResult } from './chatVoiceInputTypes';

const captureCommand = 'rustyRefactor.audio.capture';
const cancelCommand = 'rustyRefactor.audio.cancel';
const statusCommand = 'rustyRefactor.audio.status';

/**
 * Calls microphone commands owned by the local UI extension host.
 */
export class ChatVoiceInputCommand {
    /**
     * Returns whether the Windows audio companion can capture speech.
     */
    public async isSupported(): Promise<boolean> {
        try {
            return Boolean(await vscode.commands.executeCommand(
                statusCommand
            ));
        } catch {
            return false;
        }
    }

    /**
     * Captures one utterance through the local Windows extension host.
     */
    public async capture(): Promise<ChatVoiceInputResult> {
        const result = await vscode.commands.executeCommand<unknown>(
            captureCommand
        );
        return this.toResult(result);
    }

    /**
     * Cancels any local companion capture without failing if it is idle.
     */
    public async cancel(): Promise<void> {
        await vscode.commands.executeCommand(cancelCommand);
    }

    /**
     * Validates the cross-host command result before it reaches the webview.
     */
    private toResult(value: unknown): ChatVoiceInputResult {
        if (!value || typeof value !== 'object') {
            throw new Error('Windows voice input returned no result.');
        }

        const result = value as Record<string, unknown>;
        const text = typeof result.text === 'string'
            ? result.text.trim()
            : '';
        if (!text) {
            throw new Error('Windows voice input returned no text.');
        }

        return {
            text,
            confidence: String(result.confidence || ''),
            status: String(result.status || ''),
        };
    }
}
