import * as vscode from 'vscode';

import { WORKSPACE_CONTEXT_LIMIT } from './chatConstants';

/**
 * Builds the active-editor snippet supplied to Codetether prompts.
 */
export class EditorContextCollector {
    /**
     * Collects selected text or a bounded prefix of the active document.
     */
    public async collectEditorContext(): Promise<string> {
        const editor = vscode.window.activeTextEditor;

        if (!editor) {
            return 'Editor context: no active editor.';
        }

        const document = editor.document;
        const selection = editor.selection;
        const selectedText = this.getSelectedText(document, selection);
        const fullText = document.getText();
        const content = selectedText || fullText.slice(0,
            WORKSPACE_CONTEXT_LIMIT);
        const truncated = !selectedText
            && fullText.length > WORKSPACE_CONTEXT_LIMIT;

        return this.formatEditorContext(document, selection, selectedText,
            content, truncated);
    }

    /**
     * Reads only a non-empty editor selection so full files stay bounded.
     */
    private getSelectedText(
        document: vscode.TextDocument,
        selection: vscode.Selection
    ): string {
        return selection && !selection.isEmpty
            ? document.getText(selection)
            : '';
    }

    /**
     * Formats document metadata and code as markdown for the assistant.
     */
    private formatEditorContext(
        document: vscode.TextDocument,
        selection: vscode.Selection,
        selectedText: string,
        content: string,
        truncated: boolean
    ): string {
        return [
            'Active editor context:',
            `File: ${document.uri.fsPath}`,
            this.selectionLabel(selection, selectedText),
            '```' + document.languageId,
            content,
            '```',
            this.truncationLabel(truncated)
        ].filter(Boolean).join('\n');
    }

    /**
     * Describes whether context came from a selection or document prefix.
     */
    private selectionLabel(
        selection: vscode.Selection,
        selectedText: string
    ): string {
        if (!selectedText) {
            return 'Selection: none; included beginning of active file.';
        }

        return [
            'Selection: lines',
            `${selection.start.line + 1}-${selection.end.line + 1}`
        ].join(' ');
    }

    /**
     * Explains when the active file was shortened for prompt size.
     */
    private truncationLabel(truncated: boolean): string {
        if (!truncated) {
            return '';
        }

        return [
            `[Active file truncated to ${WORKSPACE_CONTEXT_LIMIT}`,
            'characters. Use Codetether file tools for full contents.]'
        ].join(' ');
    }
}
