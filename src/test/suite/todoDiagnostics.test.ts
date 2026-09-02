import * as assert from 'assert';
import * as vscode from 'vscode';

import { TodoCodeActionProvider } from '../../todoCodeActionProvider';
import {
    createTodoDiagnostics,
    isTodoDiagnostic,
    TODO_DIAGNOSTIC_CODE,
    TODO_DIAGNOSTIC_SOURCE
} from '../../todoDiagnostic';
import { IMPLEMENT_TODO_COMMAND } from '../../todoImplementationCommand';

let diagnosticTestDirectory: vscode.Uri | undefined;

/**
 * Creates an in-memory document for deterministic diagnostic checks.
 */
async function openDiagnosticDocument(
    content: string
): Promise<vscode.TextDocument> {
    return vscode.workspace.openTextDocument({
        content,
        language: 'typescript'
    });
}

/**
 * Verifies TODO variants become Information entries in Problems.
 */
async function createsTodoProblems(): Promise<void> {
    const document = await openDiagnosticDocument([
        '// TODO: parse the response',
        '// ToDo - validate the payload',
        '// todo'
    ].join('\n'));

    const diagnostics = createTodoDiagnostics(document);

    assert.strictEqual(diagnostics.length, 3);
    assert.deepStrictEqual(
        diagnostics.map(diagnostic => diagnostic.message),
        [
            'TODO: parse the response',
            'TODO: validate the payload',
            'TODO requires implementation.'
        ]
    );
    for (const diagnostic of diagnostics) {
        assert.strictEqual(
            diagnostic.severity,
            vscode.DiagnosticSeverity.Information
        );
        assert.strictEqual(diagnostic.source, TODO_DIAGNOSTIC_SOURCE);
        assert.strictEqual(diagnostic.code, TODO_DIAGNOSTIC_CODE);
    }
}

/**
 * Verifies a TODO Problem exposes the existing implementation command.
 */
async function createsTodoQuickFix(): Promise<void> {
    const document = await openDiagnosticDocument('// TODO: finish this');
    const diagnostic = createTodoDiagnostics(document)[0];
    const provider = new TodoCodeActionProvider();
    const actions = provider.provideCodeActions(
        document,
        diagnostic.range,
        {
            diagnostics: [diagnostic],
            only: vscode.CodeActionKind.QuickFix,
            triggerKind: vscode.CodeActionTriggerKind.Invoke
        }
    );

    assert.strictEqual(actions.length, 1);
    assert.strictEqual(actions[0].title, 'Implement with Codetether');
    assert.strictEqual(actions[0].command?.command, IMPLEMENT_TODO_COMMAND);
    assert.deepStrictEqual(
        actions[0].command?.arguments,
        [document.uri, diagnostic.range]
    );
}

/**
 * Activates the development extension that owns the diagnostic collection.
 */
async function activateTodoExtension(): Promise<void> {
    const extension = vscode.extensions.getExtension(
        'rusty-refactor.rusty-refactor'
    );
    assert.ok(extension, 'Expected the Rusty Refactor extension.');
    await extension.activate();
}

/**
 * Verifies the registered collection publishes TODOs from an opened file.
 */
async function publishesOpenedFileProblems(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder, 'Expected an open workspace folder.');

    diagnosticTestDirectory = vscode.Uri.joinPath(
        workspaceFolder.uri,
        '.vscode-test-temp',
        'todo-diagnostics'
    );
    const fileUri = vscode.Uri.joinPath(
        diagnosticTestDirectory,
        'problem.ts'
    );
    await vscode.workspace.fs.createDirectory(diagnosticTestDirectory);
    await vscode.workspace.fs.writeFile(
        fileUri,
        Buffer.from('// TODO: publish this problem\n', 'utf8')
    );
    await vscode.workspace.openTextDocument(fileUri);

    const diagnostics = vscode.languages
        .getDiagnostics(fileUri)
        .filter(isTodoDiagnostic);

    assert.strictEqual(diagnostics.length, 1);
    assert.strictEqual(diagnostics[0].message, 'TODO: publish this problem');
}

/**
 * Removes the dedicated diagnostic integration-test directory.
 */
async function removeDiagnosticTestFiles(): Promise<void> {
    if (!diagnosticTestDirectory) {
        return;
    }

    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.workspace.fs.delete(diagnosticTestDirectory, {
        recursive: true,
        useTrash: false
    });
}

/**
 * Registers coverage for TODO Problems and their preferred quick fix.
 */
function defineTodoDiagnosticTests(): void {
    suiteSetup(activateTodoExtension);
    suiteTeardown(removeDiagnosticTestFiles);
    test('publishes TODO variants as Problems', createsTodoProblems);
    test('offers Implement with Codetether', createsTodoQuickFix);
    test('publishes opened-file Problems', publishesOpenedFileProblems);
}

suite('TODO diagnostics', defineTodoDiagnosticTests);
