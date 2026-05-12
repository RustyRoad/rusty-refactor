/**
 * Codetether Native Client - uses NAPI bridge for direct Rust integration
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { logToOutput } from './extractor';

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

// Native NAPI bindings interface
interface NativeBridge {
    greet(name: string): string;
    version(): string;
    codetether_chat(
        messages: Array<{ role: string; content: string }>,
        model?: string,
        max_tokens?: number,
        temperature?: number
    ): Promise<string>;
}

/**
 * Client that uses native NAPI bridge to call codetether directly
 */
export class CodetetherClient {
    private defaultModel: string;
    private nativeBridge: NativeBridge | null = null;

    constructor() {
        const config = vscode.workspace.getConfiguration('rustyRefactor');
        this.defaultModel = config.get<string>('codetetherModel') || '';
        
        // Load native bridge
        this.loadNativeBridge();
    }

    private loadNativeBridge(): void {
        try {
            // The .node binary is built by napi-rs and placed in rust-backend/
            const binaryPath = path.join(
                vscode.extensions.getExtension('your-publisher.rusty-refactor')?.extensionPath || __dirname,
                '..',
                'rust-backend',
                `napi_bridge.${process.platform}-${process.arch}-${process.platform === 'win32' ? 'msvc' : 'gnu'}.node`
            );

            // eslint-disable-next-line @typescript-eslint/no-require-imports
            this.nativeBridge = require(binaryPath) as NativeBridge;
            logToOutput(`[Codetether] Loaded native bridge from ${binaryPath}`);
            logToOutput(`[Codetether] Native bridge version: ${this.nativeBridge.version()}`);
        } catch (error) {
            logToOutput(`[Codetether] Failed to load native bridge: ${error}`);
            this.nativeBridge = null;
        }
    }

    refreshConfig(): void {
        const config = vscode.workspace.getConfiguration('rustyRefactor');
        this.defaultModel = config.get<string>('codetetherModel') || '';
    }

    isEnabled(): boolean {
        const config = vscode.workspace.getConfiguration('rustyRefactor');
        return config.get<boolean>('useCustomModelEndpoint') || false;
    }

    /**
     * Send a chat completion request via native NAPI bridge
     */
    async chatCompletion(
        messages: ChatMessage[],
        options: {
            model?: string;
            maxTokens?: number;
            temperature?: number;
        } = {}
    ): Promise<string> {
        if (!this.nativeBridge) {
            throw new Error('Native bridge not loaded. Please rebuild the extension.');
        }

        const model = options.model || this.defaultModel || 'default';
        const config = vscode.workspace.getConfiguration('rustyRefactor');
        const maxTokens = options.maxTokens || config.get<number>('aiMaxTokens') || 4096;

        logToOutput(`[Codetether] Native call: model=${model}, max_tokens=${maxTokens}`);

        try {
            // Convert to JS objects expected by NAPI
            const jsMessages = messages.map(m => ({
                role: m.role,
                content: m.content
            }));

            const response = await this.nativeBridge.codetether_chat(
                jsMessages,
                model !== 'default' ? model : undefined,
                maxTokens,
                options.temperature
            );

            logToOutput(`[Codetether] Response received (${response.length} chars)`);
            return response;
        } catch (error: any) {
            logToOutput(`[Codetether] Native call failed: ${error.message}`);
            throw new Error(`Codetether completion failed: ${error.message}`);
        }
    }

    /**
     * Check if native bridge is available
     */
    async checkAvailable(): Promise<{ available: boolean; version?: string; error?: string }> {
        if (!this.nativeBridge) {
            return { available: false, error: 'Native bridge not loaded' };
        }

        try {
            const version = this.nativeBridge.version();
            return { available: true, version: `napi-bridge v${version}` };
        } catch (error: any) {
            return { available: false, error: error.message };
        }
    }
}
