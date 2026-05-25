import * as assert from 'assert';
import * as vscode from 'vscode';

let tempDirectory: vscode.Uri | undefined;

suite('Document with Codetether command', () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    let originalShowErrorMessage: typeof vscode.window.showErrorMessage;

    suiteSetup(async () => {
        assert.ok(workspaceFolder, 'Expected an open workspace folder.');
        const extension = vscode.extensions.getExtension(
            'rusty-refactor.rusty-refactor',
        );
        assert.ok(extension, 'Expected the extension to be installed.');
        await extension?.activate();
    });

    setup(() => {
        delete process.env.RUSTY_REFACTOR_TEST_DOC_RESPONSE;
        originalShowErrorMessage = vscode.window.showErrorMessage;
    });

    teardown(async () => {
        delete process.env.RUSTY_REFACTOR_TEST_DOC_RESPONSE;
        vscode.window.showErrorMessage = originalShowErrorMessage;
        await vscode.commands.executeCommand(
            'workbench.action.closeAllEditors',
        );
    });

    suiteTeardown(async () => {
        if (!tempDirectory) {
            return;
        }

        try {
            await vscode.workspace.fs.delete(tempDirectory, {
                recursive: true,
                useTrash: false,
            });
        } catch {
            // Ignore cleanup errors for already-removed files.
        }
    });

    test('documents a TypeScript selection via the command', async () => {
        const document = await openTempDocument(
            'document-command.ts',
            [
                'export function add(a: number, b: number): number {',
                '    return a + b;',
                '}',
            ].join('\n'),
            'typescript',
        );
        const editor = await vscode.window.showTextDocument(document);
        editor.selection = new vscode.Selection(
            new vscode.Position(0, 0),
            new vscode.Position(2, 1),
        );

        process.env.RUSTY_REFACTOR_TEST_DOC_RESPONSE = [
            '/**',
            ' * Adds two numbers.',
            ' * @param a First value.',
            ' * @param b Second value.',
            ' * @returns The numeric sum.',
            ' */',
            editor.document.getText(editor.selection),
        ].join('\n');

        await vscode.commands.executeCommand(
            'rustyRefactor.documentWithCodetether',
        );

        const updated = editor.document.getText();
        assert.ok(updated.includes('Adds two numbers.'));
        assert.ok(updated.includes('@returns The numeric sum.'));
        assert.ok(updated.includes('export function add'));
    });

    test(
        'shows an error and leaves content unchanged for empty selection',
        async () => {
            const document = await openTempDocument(
                'empty-selection.py',
                'def add(a, b):\n    return a + b\n',
                'python',
            );
            const editor = await vscode.window.showTextDocument(document);
            editor.selection = new vscode.Selection(
                new vscode.Position(0, 0),
                new vscode.Position(0, 0),
            );

            const errors: string[] = [];
            vscode.window.showErrorMessage = async (
                message: string,
            ): Promise<string | undefined> => {
                errors.push(message);
                return undefined;
            };

            await vscode.commands.executeCommand(
                'rustyRefactor.documentWithCodetether',
            );

            assert.deepStrictEqual(errors, [
                'Select the code you want Codetether to document.',
            ]);
            assert.strictEqual(
                editor.document.getText(),
                'def add(a, b):\n    return a + b\n',
            );
        },
    );
});

/**
 * Creates and opens a temporary document inside the current workspace.
 */
async function openTempDocument(
    fileName: string,
    content: string,
    languageId: string,
): Promise<vscode.TextDocument> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder, 'Expected an open workspace folder.');

    const testDir = vscode.Uri.joinPath(
        workspaceFolder.uri,
        '.vscode-test-temp',
    );
    const fileUri = vscode.Uri.joinPath(testDir, fileName);
    tempDirectory = testDir;

    await vscode.workspace.fs.createDirectory(testDir);
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf8'));
    const document = await vscode.workspace.openTextDocument(fileUri);

    if (document.languageId !== languageId) {
        // Language association is driven by file extension; this guards test
        // assumptions when the environment behaves differently.
        assert.strictEqual(document.languageId, languageId);
    }

    return document;
}
