/**
 * Codetether CLI client - invokes codetether binary directly
 */

import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import { logToOutput } from './extractor';

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

/**
 * Client that spawns codetether binary directly
 */
export class CodetetherClient {
    private binaryPath: string;
    private defaultModel: string;

    constructor() {
        const config = vscode.workspace.getConfiguration('rustyRefactor');
        this.binaryPath = config.get<string>('codetetherBinaryPath') || 'codetether';
        this.defaultModel = config.get<string>('codetetherModel') || '';
    }

    refreshConfig(): void {
        const config = vscode.workspace.getConfiguration('rustyRefactor');
        this.binaryPath = config.get<string>('codetetherBinaryPath') || 'codetether';
        this.defaultModel = config.get<string>('codetetherModel') || '';
    }

    isEnabled(): boolean {
        const config = vscode.workspace.getConfiguration('rustyRefactor');
        return config.get<boolean>('useCustomModelEndpoint') || false;
    }

    /**
     * Send a chat completion request via codetether CLI
     */
    async chatCompletion(
        messages: ChatMessage[],
        options: {
            model?: string;
            maxTokens?: number;
            temperature?: number;
        } = {}
    ): Promise<string> {
        const model = options.model || this.defaultModel || 'default';
        const config = vscode.workspace.getConfiguration('rustyRefactor');
        const maxTokens = options.maxTokens || config.get<number>('aiMaxTokens') || 4096;

        // Build the prompt from messages
        const prompt = this.buildPrompt(messages);

        logToOutput(`[Codetether] Spawning: ${this.binaryPath} run with model ${model}`);

        return new Promise((resolve, reject) => {
            const args: string[] = ['run'];
            
            if (model && model !== 'default') {
                args.push('--model', model);
            }

            // In 'run' mode, codetether expects the message as an argument.
            // Since our prompt may be very large and multi-line, we must pass it carefully
            // In powershell via spawn, quoting large strings can be tricky, but node's spawn handles standard argv well
            args.push(prompt);

            const proc = spawn(this.binaryPath, args, {
                // Ensure shell is false so Windows doesn't try to parse the giant prompt string
                shell: false,
                windowsHide: true
            });

            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            proc.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            proc.on('error', (err) => {
                logToOutput(`[Codetether] Process error: ${err.message}`);
                reject(new Error(`Failed to spawn codetether: ${err.message}`));
            });

            proc.on('close', (code) => {
                if (code !== 0) {
                    logToOutput(`[Codetether] Exit code ${code}: ${stderr}`);
                    reject(new Error(`Codetether exited with code ${code}: ${stderr}`));
                    return;
                }
                // When running codetether run, it might output standard terminal stuff. Let's return stdout.
                resolve(stdout.trim());
            });
            
            // `codetether run <message>` doesn't read from stdin
        });
    }

    /**
     * Build a prompt string from chat messages
     */
    private buildPrompt(messages: ChatMessage[]): string {
        const parts: string[] = [];

        for (const msg of messages) {
            switch (msg.role) {
                case 'system':
                    parts.push(`<|system|>\n${msg.content}`);
                    break;
                case 'user':
                    parts.push(`<|user|>\n${msg.content}`);
                    break;
                case 'assistant':
                    parts.push(`<|assistant|)\n${msg.content}`);
                    break;
            }
        }

        parts.push('<|assistant|)');
        return parts.join('\n\n');
    }

    /**
     * Check if codetether binary is available
     */
    async checkAvailable(): Promise<{ available: boolean; version?: string; error?: string }> {
        return new Promise((resolve) => {
            const proc = spawn(this.binaryPath, ['--version'], {
                shell: true,
                windowsHide: true
            });

            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            proc.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            proc.on('error', (err) => {
                resolve({ available: false, error: err.message });
            });

            proc.on('close', (code) => {
                if (code === 0) {
                    resolve({ available: true, version: stdout.trim() || stderr.trim() });
                } else {
                    resolve({ available: false, error: `Exit code ${code}` });
                }
            });
        });
    }
}

/**
 * Unified interface that works with codetether CLI or VS Code's LM API
 */
export class UnifiedModelClient {
    private codetetherClient: CodetetherClient;

    constructor() {
        this.codetetherClient = new CodetetherClient();
    }

    shouldUseCustomEndpoint(): boolean {
        return this.codetetherClient.isEnabled();
    }

    async sendChat(
        messages: ChatMessage[],
        options: {
            model?: string;
            maxTokens?: number;
            temperature?: number;
            justification?: string;
            token?: vscode.CancellationToken;
        } = {}
    ): Promise<string> {
        if (this.shouldUseCustomEndpoint()) {
            return this.codetetherClient.chatCompletion(messages, {
                model: options.model,
                maxTokens: options.maxTokens,
                temperature: options.temperature
            });
        }

        // Use VS Code's built-in Language Model API
        return this.sendVSCodeChat(messages, options);
    }

    async *streamChat(
        messages: ChatMessage[],
        options: {
            model?: string;
            maxTokens?: number;
            temperature?: number;
            justification?: string;
            token?: vscode.CancellationToken;
        } = {}
    ): AsyncGenerator<string> {
        if (this.shouldUseCustomEndpoint()) {
            // Codetether CLI doesn't support streaming well, return full response
            const result = await this.codetetherClient.chatCompletion(messages, {
                model: options.model,
                maxTokens: options.maxTokens,
                temperature: options.temperature
            });
            yield result;
            return;
        }

        // Use VS Code's built-in Language Model API
        const model = await this.selectModel(options.model);
        if (!model) {
            throw new Error('No language model available');
        }

        const chatMessages = messages.map(m =>
            m.role === 'user'
                ? vscode.LanguageModelChatMessage.User(m.content)
                : vscode.LanguageModelChatMessage.Assistant(m.content)
        );

        const response = await model.sendRequest(
            chatMessages,
            { justification: options.justification },
            options.token || new vscode.CancellationTokenSource().token
        );

        for await (const fragment of response.text) {
            yield fragment;
        }
    }

    async selectModel(preferredId?: string): Promise<vscode.LanguageModelChat | null> {
        try {
            const allModels = await vscode.lm.selectChatModels();
            if (allModels.length === 0) {
                return null;
            }

            const config = vscode.workspace.getConfiguration('rustyRefactor');
            const fastId = config.get<string>('aiFastModel');
            const preferred = preferredId || config.get<string>('aiPreferredModel');

            if (preferred) {
                const match = allModels.find(m => `${m.vendor}/${m.family}` === preferred);
                if (match) {
                    return match;
                }
            }

            if (fastId) {
                const match = allModels.find(m => `${m.vendor}/${m.family}` === fastId);
                if (match) {
                    return match;
                }
            }

            const sorted = [...allModels].sort((a, b) => b.maxInputTokens - a.maxInputTokens);
            return sorted[0] || null;
        } catch {
            return null;
        }
    }

    private async sendVSCodeChat(
        messages: ChatMessage[],
        options: {
            model?: string;
            maxTokens?: number;
            temperature?: number;
            justification?: string;
            token?: vscode.CancellationToken;
        }
    ): Promise<string> {
        const model = await this.selectModel(options.model);
        if (!model) {
            throw new Error('No language model available');
        }

        const chatMessages = messages.map(m =>
            m.role === 'user'
                ? vscode.LanguageModelChatMessage.User(m.content)
                : vscode.LanguageModelChatMessage.Assistant(m.content)
        );

        const response = await model.sendRequest(
            chatMessages,
            { justification: options.justification },
            options.token || new vscode.CancellationTokenSource().token
        );

        let result = '';
        for await (const fragment of response.text) {
            result += fragment;
        }

        return result;
    }

    async getAvailableModels(): Promise<{ id: string; source: 'vscode' | 'codetether' }[]> {
        const models: { id: string; source: 'vscode' | 'codetether' }[] = [];

        try {
            const vscodeModels = await vscode.lm.selectChatModels();
            for (const m of vscodeModels) {
                models.push({ id: `${m.vendor}/${m.family}`, source: 'vscode' });
            }
        } catch (error) {
            logToOutput(`[UnifiedModelClient] Failed to list VS Code models: ${error}`);
        }

        return models;
    }
}
