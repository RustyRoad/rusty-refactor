import * as vscode from 'vscode';

import { isTodoDiagnostic } from './todoDiagnostic';
import { IMPLEMENT_TODO_COMMAND } from './todoImplementationCommand';

/**
 * Offers the Codetether implementation command for TODO diagnostics.
 */
export class TodoCodeActionProvider implements vscode.CodeActionProvider {
    public static readonly providedCodeActionKinds = [
        vscode.CodeActionKind.QuickFix
    ];

    /**
     * Creates one preferred quick fix for each selected TODO diagnostic.
     */
    public provideCodeActions(
        document: vscode.TextDocument,
        _range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext
    ): vscode.CodeAction[] {
        const actions: vscode.CodeAction[] = [];

        for (const diagnostic of context.diagnostics) {
            if (!isTodoDiagnostic(diagnostic)) {
                continue;
            }

            actions.push(this.createAction(document.uri, diagnostic));
        }

        return actions;
    }

    /**
     * Binds one TODO problem to its existing editor implementation command.
     */
    private createAction(
        uri: vscode.Uri,
        diagnostic: vscode.Diagnostic
    ): vscode.CodeAction {
        const action = new vscode.CodeAction(
            'Implement with Codetether',
            vscode.CodeActionKind.QuickFix
        );
        action.diagnostics = [diagnostic];
        action.isPreferred = true;
        action.command = {
            command: IMPLEMENT_TODO_COMMAND,
            title: 'Implement with Codetether',
            arguments: [uri, diagnostic.range]
        };
        return action;
    }
}

/**
 * Registers TODO quick fixes for every workspace file language.
 */
export function registerTodoCodeActionProvider(): vscode.Disposable {
    return vscode.languages.registerCodeActionsProvider(
        { scheme: 'file' },
        new TodoCodeActionProvider(),
        {
            providedCodeActionKinds:
                TodoCodeActionProvider.providedCodeActionKinds
        }
    );
}
