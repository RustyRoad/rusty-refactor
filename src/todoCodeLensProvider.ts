import * as vscode from 'vscode';

import { IMPLEMENT_TODO_COMMAND } from './todoImplementationCommand';
import { findTodoMarkers } from './todoMarker';

/**
 * Provides a Codetether implementation action for every TODO marker.
 *
 * Matching is case-insensitive and limited to complete words so identifiers
 * such as `todoItem` do not produce unrelated actions.
 */
export class TodoCodeLensProvider implements vscode.CodeLensProvider {
    /**
     * Maps every document TODO marker to one editor action.
     */
    public provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.CodeLens[] {
        const codeLenses: vscode.CodeLens[] = [];

        for (const marker of findTodoMarkers(document, token)) {
            codeLenses.push(
                this.createCodeLens(document.uri, marker.range)
            );
        }

        return codeLenses;
    }

    /**
     * Creates the clickable action associated with one TODO marker.
     */
    private createCodeLens(
        uri: vscode.Uri,
        range: vscode.Range
    ): vscode.CodeLens {
        return new vscode.CodeLens(range, {
            title: 'Implement with Codetether',
            command: IMPLEMENT_TODO_COMMAND,
            tooltip: 'Open a new Codetether session for this TODO',
            arguments: [uri, range]
        });
    }
}

/**
 * Registers TODO actions for workspace files that Codetether can edit.
 */
export function registerTodoCodeLensProvider(): vscode.Disposable {
    return vscode.languages.registerCodeLensProvider(
        { scheme: 'file' },
        new TodoCodeLensProvider()
    );
}
