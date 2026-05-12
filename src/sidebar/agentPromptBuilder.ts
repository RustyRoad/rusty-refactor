import * as vscode from 'vscode';

import { EditorContextCollector } from './editorContextCollector';
import { featureInstruction, modeInstruction } from './chatModes';
import { ChatMode, CodetetherFeature } from './chatTypes';

/**
 * Builds Codetether prompts from user text, mode, feature, and editor context.
 */
export class AgentPromptBuilder {
    public constructor(
        private readonly editorContextCollector = new EditorContextCollector()
    ) {}

    /**
     * Creates the full prompt sent to the Codetether chat-completion API.
     */
    public async buildAgentPrompt(
        userText: string,
        mode: ChatMode,
        feature: CodetetherFeature,
        includeContext: boolean
    ): Promise<string> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const context = includeContext
            ? await this.editorContextCollector.collectEditorContext()
            : '';

        return [
            modeInstruction(mode),
            featureInstruction(feature),
            this.workspaceLabel(workspaceFolder),
            context,
            'User request:',
            userText,
            '',
            this.toolRuntimeInstruction()
        ].filter(Boolean).join('\n\n');
    }

    /**
     * Formats the current workspace root for model grounding.
     */
    private workspaceLabel(
        workspaceFolder: vscode.WorkspaceFolder | undefined
    ): string {
        if (!workspaceFolder) {
            return 'No workspace folder is currently open.';
        }

        return `Workspace root: ${workspaceFolder.uri.fsPath}`;
    }

    /**
     * Explains the native tools the hosted assistant may call directly.
     */
    private toolRuntimeInstruction(): string {
        return [
            'Important: You are running inside Codetether, which has a real',
            'native tool runtime. Use tools directly when helpful:',
            'read/write/edit/multiedit/patch,',
            'grep/codesearch/search/glob/tree/list, bash, git diff/status,',
            'LSP diagnostics/symbols/references, browserctl,',
            'webfetch/websearch, swarm/subagents, PRD/Ralph/go pipelines,',
            'memory/session tools, and build/test commands.',
            'If changing code, inspect files first, edit, then validate.',
            'Return a concise summary plus files/commands used.'
        ].join(' ');
    }
}
