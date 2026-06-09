import * as path from 'path';
import * as vscode from 'vscode';

import { AIDocGenerator } from './aiDocGenerator';
import { logToOutput } from './extractor';

interface DocumentTarget {
    editor: vscode.TextEditor;
    range: vscode.Range;
}

/**
 * Documents the active code selection with Codetether and replaces it in the
 * editor when generation succeeds.
 */
export async function handleDocumentWithCodetether(
    secretStorage?: vscode.SecretStorage,
    uri?: vscode.Uri,
    range?: vscode.Range
): Promise<void> {
    const target = await resolveDocumentTarget(uri, range);
    if (!target) {
        void vscode.window.showErrorMessage(
            'Select the code you want Codetether to document.',
        );
        return;
    }

    const { editor } = target;
    const selectedCode = editor.document.getText(target.range);
    const languageId = editor.document.languageId;
    if (!selectedCode.trim()) {
        void vscode.window.showErrorMessage(
            'The current selection is empty after trimming whitespace.',
        );
        return;
    }

    const generator = new AIDocGenerator(secretStorage);
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
        editBuilder.replace(target.range, documented);
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
 * Resolves the editor and range supplied by a command or context menu.
 */
async function resolveDocumentTarget(
    uri?: vscode.Uri,
    range?: vscode.Range
): Promise<DocumentTarget | undefined> {
    const editor = await resolveEditor(uri);
    if (!editor) {
        return undefined;
    }

    const targetRange = nonEmptyRange(range) || nonEmptyRange(
        editor.selection,
    );
    if (!targetRange) {
        return undefined;
    }

    return {
        editor,
        range: targetRange,
    };
}

/**
 * Returns the active editor or opens the URI supplied by VS Code commands.
 */
async function resolveEditor(
    uri?: vscode.Uri
): Promise<vscode.TextEditor | undefined> {
    const activeEditor = vscode.window.activeTextEditor;

    if (!uri) {
        return activeEditor;
    }

    if (
        activeEditor
        && activeEditor.document.uri.toString() === uri.toString()
    ) {
        return activeEditor;
    }

    const document = await vscode.workspace.openTextDocument(uri);
    return vscode.window.showTextDocument(document);
}

/**
 * Keeps only ranges that cover at least one character.
 */
function nonEmptyRange(
    range: vscode.Range | undefined
): vscode.Range | undefined {
    if (!range || range.isEmpty) {
        return undefined;
    }

    return range;
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
