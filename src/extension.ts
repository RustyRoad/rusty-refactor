import * as vscode from 'vscode';
import * as path from 'path';
import { RustCodeAnalyzer } from './analyzer';
import { ModuleExtractor } from './extractor';
import { RustAnalyzerIntegration } from './rustAnalyzerIntegration';
import { FileSearchProvider } from './fileSearchProvider';
import { ModuleExtractorPanel } from './webview/ModuleExtractorPanel';
import { registerLanguageModelTools } from './languageModelTools';
import { 
    enhancedCargoCheck, 
    suggestImportsForTypes, 
    extractFunctionWithTypes,
    getFunctionAtPosition,
    analyzeLifetimes,
    resolveTraitBounds,
    isNativeModuleAvailable 
} from './nativeBridge';

let rustAnalyzerIntegration: RustAnalyzerIntegration;

export function activate(context: vscode.ExtensionContext) {
    console.log('Rusty Refactor is now active!');

    // Initialize rust-analyzer integration
    rustAnalyzerIntegration = new RustAnalyzerIntegration();

    // Register language model tools for Copilot Chat integration
    registerLanguageModelTools(context, rustAnalyzerIntegration);

    // Register command: Extract to Module (default path)
    const extractCommand = vscode.commands.registerCommand(
        'rustyRefactor.extractToModule',
        async () => {
            await handleExtractToModule(false);
        }
    );

    // Register command: Extract to Module with File Search
    const extractWithSearchCommand = vscode.commands.registerCommand(
        'rustyRefactor.extractToModuleWithSearch',
        async () => {
            await handleExtractToModuleWithSearch();
        }
    );

    // Register command: Extract to Module (custom path - legacy)
    const extractCustomPathCommand = vscode.commands.registerCommand(
        'rustyRefactor.extractToModuleCustomPath',
        async () => {
            await handleExtractToModule(true);
        }
    );

    context.subscriptions.push(extractCommand, extractWithSearchCommand, extractCustomPathCommand);
}

async function handleExtractToModuleWithSearch() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('No active editor found');
        return;
    }

    if (editor.document.languageId !== 'rust') {
        vscode.window.showErrorMessage('This command only works with Rust files');
        return;
    }

    const selection = editor.selection;
    if (selection.isEmpty) {
        vscode.window.showErrorMessage('Please select the code you want to extract');
        return;
    }

    const selectedText = editor.document.getText(selection);

    try {
        // Analyze the selected code
        const analyzer = new RustCodeAnalyzer(editor.document, rustAnalyzerIntegration);
        const analysisResult = await analyzer.analyzeSelection(selection, selectedText);

        // Get module name from user
        const moduleName = await vscode.window.showInputBox({
            prompt: 'Enter the module name',
            placeHolder: 'my_module',
            validateInput: (value) => {
                if (!value) {
                    return 'Module name cannot be empty';
                }
                if (!/^[a-z][a-z0-9_]*$/.test(value)) {
                    return 'Module name must be lowercase with underscores (snake_case)';
                }
                return null;
            }
        });

        if (!moduleName) {
            return; // User cancelled
        }

        // Get workspace root
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder found');
            return;
        }

        // Get extension context for webview
        const extensionPath = (require.main?.filename || __filename).includes('extension') ? 
            vscode.Uri.file(require.main?.path?.replace('dist/extension.js', '') || __dirname) :
            vscode.Uri.file(__dirname);

        // Show webview panel to select destination
        const selectedPath = await ModuleExtractorPanel.show(
            moduleName,
            selectedText,
            analysisResult,
            workspaceFolder,
            extensionPath
        );

        if (!selectedPath) {
            return; // User cancelled
        }

        // Extract the module
        const extractor = new ModuleExtractor(
            editor.document,
            analysisResult,
            moduleName,
            selectedPath,
            rustAnalyzerIntegration
        );
        
        await extractor.extract();

        vscode.window.showInformationMessage(
            `Successfully extracted code to module '${moduleName}' at ${selectedPath}`
        );

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(`Failed to extract module: ${errorMessage}`);
        console.error('Extract to module error:', error);
    }
}

async function handleExtractToModule(useCustomPath: boolean) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('No active editor found');
        return;
    }

    if (editor.document.languageId !== 'rust') {
        vscode.window.showErrorMessage('This command only works with Rust files');
        return;
    }

    const selection = editor.selection;
    if (selection.isEmpty) {
        vscode.window.showErrorMessage('Please select the code you want to extract');
        return;
    }

    const selectedText = editor.document.getText(selection);

    try {
        // Analyze the selected code
        const analyzer = new RustCodeAnalyzer(editor.document, rustAnalyzerIntegration);
        const analysisResult = await analyzer.analyzeSelection(selection, selectedText);

        // Get module name from user
        const moduleName = await vscode.window.showInputBox({
            prompt: 'Enter the module name',
            placeHolder: 'my_module',
            validateInput: (value) => {
                if (!value) {
                    return 'Module name cannot be empty';
                }
                if (!/^[a-z][a-z0-9_]*$/.test(value)) {
                    return 'Module name must be lowercase with underscores (snake_case)';
                }
                return null;
            }
        });

        if (!moduleName) {
            return; // User cancelled
        }

        // Get file path
        let modulePath: string;
        if (useCustomPath) {
            const customPath = await vscode.window.showInputBox({
                prompt: 'Enter the module file path (relative to workspace root)',
                placeHolder: 'src/modules/my_module.rs',
                value: `src/${moduleName}.rs`
            });
            if (!customPath) {
                return; // User cancelled
            }
            modulePath = customPath;
        } else {
            const config = vscode.workspace.getConfiguration('rustyRefactor');
            const defaultPath = config.get<string>('defaultModulePath', 'src');
            modulePath = `${defaultPath}/${moduleName}.rs`;
        }

        // Extract the module
        const extractor = new ModuleExtractor(
            editor.document,
            analysisResult,
            moduleName,
            modulePath,
            rustAnalyzerIntegration
        );
        
        await extractor.extract();

        vscode.window.showInformationMessage(
            `Successfully extracted code to module '${moduleName}'`
        );

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(`Failed to extract module: ${errorMessage}`);
        console.error('Extract to module error:', error);
    }
}

export function deactivate() {
    if (rustAnalyzerIntegration) {
        rustAnalyzerIntegration.dispose();
    }
}
