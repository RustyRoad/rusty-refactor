import * as path from 'path';
import * as vscode from 'vscode';

import { AIDocGenerator } from './aiDocGenerator';
import { logToOutput } from './extractor';

/**
 * Documents the active code selection with Codetether and replaces it in the
 * editor when generation succeeds.
 */
export async function handleDocumentWithCodetether(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        void vscode.window.showErrorMessage('No active editor found.');
        return;
    }

    if (editor.selection.isEmpty) {
        void vscode.window.showErrorMessage(
            'Select the code you want Codetether to document.',
        );
        return;
    }

    const selection = editor.selection;
    const selectedCode = editor.document.getText(selection);
    const languageId = editor.document.languageId;
    if (!selectedCode.trim()) {
        void vscode.window.showErrorMessage(
            'The current selection is empty after trimming whitespace.',
        );
        return;
    }

    const generator = new AIDocGenerator();
    const moduleName = inferModuleName(editor.document);

    logToOutput(
        `[Codetether Docs] Documenting selection in ${editor.document.uri.fsPath}`,
    );

    const documented = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Documenting ${languageLabel(languageId)} with Codetether…`,
            cancellable: false,
        },
        async () => generator.generateSelectionDocumentationWithCodetether(
            selectedCode,
            moduleName,
            editor.document.uri.fsPath,
            languageId,
        ),
    );

    if (!documented) {
        void vscode.window.showWarningMessage(
            'Codetether could not generate valid documentation for the '
                + 'selected code.',
        );
        return;
    }

    const didApply = await editor.edit((editBuilder) => {
        editBuilder.replace(selection, documented);
    });

    if (!didApply) {
        void vscode.window.showErrorMessage(
            'Failed to apply the documented code to the editor.',
        );
        return;
    }

    logToOutput('[Codetether Docs] Documentation applied successfully.');
    void vscode.window.showInformationMessage(
        'Codetether documentation added to the selected code.',
    );
}

/**
 * Infers a module or file name from the active document path.
 */
function inferModuleName(document: vscode.TextDocument): string {
    const fileName = path.parse(document.fileName).name;
    return fileName || 'module';
}

/**
 * Returns a friendly language label for progress and messaging.
 */
function languageLabel(languageId: string): string {
    switch (languageId) {
        case 'typescript':
            return 'TypeScript';
        case 'typescriptreact':
            return 'TSX';
        case 'javascript':
            return 'JavaScript';
        case 'javascriptreact':
            return 'JSX';
        case 'rust':
            return 'Rust';
        case 'python':
            return 'Python';
        default:
            return languageId || 'code';
    }
}
