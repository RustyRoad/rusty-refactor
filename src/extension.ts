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
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
    // Create output channel for logging
    outputChannel = vscode.window.createOutputChannel('Rusty Refactor');
    context.subscriptions.push(outputChannel);
    
    outputChannel.appendLine('Rusty Refactor is now active!');
    console.log('Rusty Refactor is now active!');

    // Initialize rust-analyzer integration
    rustAnalyzerIntegration = new RustAnalyzerIntegration();
    
    // Set output channel for ModuleExtractorPanel
    ModuleExtractorPanel.setOutputChannel(outputChannel);

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
            await handleExtractToModuleWithSearch(context.extensionUri);
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

async function handleExtractToModuleWithSearch(extensionUri: vscode.Uri) {
    outputChannel.appendLine('=== Extract to Module with Search ===');
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        outputChannel.appendLine('ERROR: No active editor found');
        vscode.window.showErrorMessage('No active editor found');
        return;
    }

    if (editor.document.languageId !== 'rust') {
        outputChannel.appendLine('ERROR: Not a Rust file');
        vscode.window.showErrorMessage('This command only works with Rust files');
        return;
    }

    const selection = editor.selection;
    if (selection.isEmpty) {
        outputChannel.appendLine('ERROR: No code selected');
        vscode.window.showErrorMessage('Please select the code you want to extract');
        return;
    }

    const selectedText = editor.document.getText(selection);
    outputChannel.appendLine(`Selected ${selectedText.length} characters`);

    try {
        // Analyze the selected code
        outputChannel.appendLine('Analyzing selected code...');
        const analyzer = new RustCodeAnalyzer(editor.document, rustAnalyzerIntegration);
        const analysisResult = await analyzer.analyzeSelection(selection, selectedText);
        outputChannel.appendLine('Analysis complete');

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
            outputChannel.appendLine('User cancelled module name input');
            return; // User cancelled
        }
        outputChannel.appendLine(`Module name: ${moduleName}`);

        // Get workspace root
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            outputChannel.appendLine('ERROR: No workspace folder found');
            vscode.window.showErrorMessage('No workspace folder found');
            return;
        }
        outputChannel.appendLine(`Workspace folder: ${workspaceFolder.uri.fsPath}`);
        outputChannel.appendLine(`Extension URI: ${extensionUri.fsPath}`);

        // Show webview panel to select destination
        outputChannel.appendLine('Opening webview panel...');
        const selectedPath = await ModuleExtractorPanel.show(
            moduleName,
            selectedText,
            analysisResult,
            workspaceFolder,
            extensionUri
        );

        if (!selectedPath) {
            outputChannel.appendLine('User cancelled path selection');
            return; // User cancelled
        }
        outputChannel.appendLine(`Selected path: ${selectedPath}`);

        // Extract the module
        outputChannel.appendLine('Creating module extractor...');
        const extractor = new ModuleExtractor(
            editor.document,
            analysisResult,
            moduleName,
            selectedPath,
            rustAnalyzerIntegration,
            selection // Pass original selection for accurate replacement
        );
        
        outputChannel.appendLine('Extracting module...');
        await extractor.extract();
        outputChannel.appendLine('Module extraction complete!');

        vscode.window.showInformationMessage(
            `Successfully extracted code to module '${moduleName}' at ${selectedPath}`
        );

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        outputChannel.appendLine(`ERROR: ${errorMessage}`);
        if (error instanceof Error && error.stack) {
            outputChannel.appendLine(`Stack trace: ${error.stack}`);
        }
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
            rustAnalyzerIntegration,
            selection // Pass original selection for accurate replacement
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
