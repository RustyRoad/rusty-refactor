import * as vscode from 'vscode';

import { createTodoDiagnostics } from './todoDiagnostic';

const TODO_COLLECTION_NAME = 'codetetherTodos';

/**
 * Maintains Problems-panel TODO diagnostics for open workspace files.
 */
export class TodoDiagnosticManager implements vscode.Disposable {
    private readonly diagnostics =
        vscode.languages.createDiagnosticCollection(TODO_COLLECTION_NAME);
    private readonly listeners: vscode.Disposable;

    /**
     * Publishes diagnostics for open files and tracks editor lifecycle events.
     */
    public constructor() {
        this.listeners = vscode.Disposable.from(
            vscode.workspace.onDidOpenTextDocument(document => {
                this.refresh(document);
            }),
            vscode.workspace.onDidChangeTextDocument(event => {
                this.refresh(event.document);
            }),
            vscode.workspace.onDidCloseTextDocument(document => {
                this.diagnostics.delete(document.uri);
            })
        );

        for (const document of vscode.workspace.textDocuments) {
            this.refresh(document);
        }
    }

    /**
     * Replaces one file's diagnostic snapshot after its text changes.
     */
    public refresh(document: vscode.TextDocument): void {
        if (document.uri.scheme !== 'file') {
            this.diagnostics.delete(document.uri);
            return;
        }

        this.diagnostics.set(
            document.uri,
            createTodoDiagnostics(document)
        );
    }

    /**
     * Releases editor listeners and clears every published TODO problem.
     */
    public dispose(): void {
        this.listeners.dispose();
        this.diagnostics.dispose();
    }
}

/**
 * Registers the owner of all Codetether TODO diagnostics.
 */
export function registerTodoDiagnostics(): vscode.Disposable {
    return new TodoDiagnosticManager();
}
