import * as assert from 'assert';
import * as vscode from 'vscode';

import {
    TodoCodeLensProvider
} from '../../todoCodeLensProvider';
import { IMPLEMENT_TODO_COMMAND } from '../../todoImplementationCommand';
import {
    buildTodoImplementationPrompt
} from '../../todoImplementationPrompt';

/**
 * Creates an in-memory TypeScript document without touching the workspace.
 */
async function openTodoDocument(
    content: string
): Promise<vscode.TextDocument> {
    return vscode.workspace.openTextDocument({
        content,
        language: 'typescript'
    });
}

/**
 * Verifies each supported TODO casing receives its own sidebar action.
 */
async function findsEveryTodoCasing(): Promise<void> {
    const document = await openTodoDocument([
        '// TODO: first',
        '// ToDo: second',
        '// todo: third'
    ].join('\n'));
    const cancellation = new vscode.CancellationTokenSource();
    const provider = new TodoCodeLensProvider();

    const lenses = provider.provideCodeLenses(
        document,
        cancellation.token
    );

    assert.strictEqual(lenses.length, 3);
    assert.deepStrictEqual(
        lenses.map(lens => lens.range.start.line),
        [0, 1, 2]
    );
    for (const lens of lenses) {
        assert.strictEqual(lens.command?.command, IMPLEMENT_TODO_COMMAND);
        assert.strictEqual(
            lens.command?.title,
            'Implement with Codetether'
        );
    }
}

/**
 * Verifies TODO text embedded in a larger identifier is ignored.
 */
async function ignoresIdentifierFragments(): Promise<void> {
    const document = await openTodoDocument([
        'const todoItem = 1;',
        'const methodology = 2;'
    ].join('\n'));
    const cancellation = new vscode.CancellationTokenSource();
    const provider = new TodoCodeLensProvider();

    const lenses = provider.provideCodeLenses(
        document,
        cancellation.token
    );

    assert.deepStrictEqual(lenses, []);
}

/**
 * Verifies the submitted prompt identifies and scopes the selected marker.
 */
function buildsScopedImplementationPrompt(): void {
    const prompt = buildTodoImplementationPrompt({
        relativePath: 'src/example.ts',
        lineNumber: 12,
        columnNumber: 4,
        sourceLine: '// TODO: parse the response'
    });

    assert.ok(prompt.includes('src/example.ts at line 12, column 4'));
    assert.ok(prompt.includes('// TODO: parse the response'));
    assert.ok(prompt.includes('remove the TODO'));
}

/**
 * Registers focused coverage for the TODO CodeLens feature.
 */
function defineTodoCodeLensProviderTests(): void {
    test('finds TODO, ToDo, and todo', findsEveryTodoCasing);
    test('ignores TODO fragments in identifiers', ignoresIdentifierFragments);
    test(
        'builds a location-specific prompt',
        buildsScopedImplementationPrompt
    );
}

suite('TODO CodeLens provider', defineTodoCodeLensProviderTests);
