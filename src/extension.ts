import * as vscode from 'vscode';
import * as path from 'path';
import { RustCodeAnalyzer } from './analyzer';
import { ModuleExtractor, logToOutput } from './extractor';
import { RustAnalyzerIntegration } from './rustAnalyzerIntegration';
import { FileSearchProvider } from './fileSearchProvider';
import { ModuleExtractorPanel } from './webview/ModuleExtractorPanel';
import { registerLanguageModelTools } from './languageModelTools';
import { RustRefactorHoverProvider, ExtractSymbolCommand } from './hoverProvider';
import { AIDocGenerator } from './aiDocGenerator';

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
    try {
        // Create output channel for logging
        outputChannel = vscode.window.createOutputChannel('Rusty Refactor');
        context.subscriptions.push(outputChannel);

        // Make output channel globally accessible for logging from other classes
        (global as any).rustyRefactorOutputChannel = outputChannel;

        outputChannel.appendLine('Rusty Refactor is now active!');
        outputChannel.appendLine(`Extension path: ${context.extensionPath}`);
        outputChannel.appendLine(`Extension URI: ${context.extensionUri.fsPath}`);
        console.log('Rusty Refactor is now active!');

        // Initialize rust-analyzer integration FIRST
        outputChannel.appendLine('Initializing RustAnalyzerIntegration...');
        rustAnalyzerIntegration = new RustAnalyzerIntegration();
        outputChannel.appendLine('✓ RustAnalyzerIntegration initialized');

        // Register hover provider for extract suggestions
        outputChannel.appendLine('Registering hover provider...');
        const hoverProvider = new RustRefactorHoverProvider(rustAnalyzerIntegration);
        const hoverRegistration = vscode.languages.registerHoverProvider(
            { language: 'rust' },
            hoverProvider
        );
        context.subscriptions.push(hoverRegistration);
        outputChannel.appendLine('✓ Hover provider registered');

        // Create extract symbol command handler
        outputChannel.appendLine('Creating extract symbol command handler...');
        const extractSymbolCommand = new ExtractSymbolCommand(rustAnalyzerIntegration);
        outputChannel.appendLine('✓ Extract symbol command handler created');

        // Set output channel for ModuleExtractorPanel
        outputChannel.appendLine('Setting output channel for ModuleExtractorPanel...');
        ModuleExtractorPanel.setOutputChannel(outputChannel);
        outputChannel.appendLine('✓ ModuleExtractorPanel output channel set');

        // Register language model tools for Copilot Chat integration
        outputChannel.appendLine('Registering language model tools...');
        registerLanguageModelTools(context, rustAnalyzerIntegration);
        outputChannel.appendLine('✓ Language model tools registered');

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

        // Register hover-based extraction commands
        const extractSymbolCommandReg = vscode.commands.registerCommand(
            'rustyRefactor.extractSymbol',
            async (args: [string, number, number, string]) => {
                const [filePath, startLine, endLine, suggestedName] = args;
                await extractSymbolCommand.extractSymbol(filePath, startLine, endLine, suggestedName, false, false);
            }
        );

        const extractSymbolCustomCommand = vscode.commands.registerCommand(
            'rustyRefactor.extractSymbolCustom',
            async (args: [string, number, number, string]) => {
                const [filePath, startLine, endLine, suggestedName] = args;
                await extractSymbolCommand.extractSymbol(filePath, startLine, endLine, suggestedName, true, false);
            }
        );

        const extractSymbolWithSearchCommand = vscode.commands.registerCommand(
            'rustyRefactor.extractSymbolWithSearch',
            async (args: [string, number, number, string]) => {
                const [filePath, startLine, endLine, suggestedName] = args;
                await extractSymbolCommand.extractSymbol(filePath, startLine, endLine, suggestedName, false, true);
            }
        );

        // Register command: Select preferred AI model
        const selectAIModelCommand = vscode.commands.registerCommand(
            'rustyRefactor.selectAIModel',
            async () => {
                const docGenerator = new AIDocGenerator();
                await docGenerator.selectPreferredModel();
            }
        );

        context.subscriptions.push(
            extractCommand,
            extractWithSearchCommand,
            extractCustomPathCommand,
            extractSymbolCommandReg,
            extractSymbolCustomCommand,
            extractSymbolWithSearchCommand,
            selectAIModelCommand
        );

        outputChannel.appendLine('✓ All commands registered successfully');
        outputChannel.appendLine('=== Rusty Refactor activation complete! ===');
        outputChannel.show(true); // Show the output channel automatically
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : '';
        console.error('Failed to activate Rusty Refactor:', error);
        if (outputChannel) {
            outputChannel.appendLine(`✗ ACTIVATION FAILED: ${errorMsg}`);
            outputChannel.appendLine(`Stack trace: ${errorStack}`);
            outputChannel.show(true);
        }
        vscode.window.showErrorMessage(`Rusty Refactor failed to activate: ${errorMsg}`);
        throw error; // Re-throw so VS Code knows activation failed
    }
}

async function handleExtractToModuleWithSearch(extensionUri: vscode.Uri) {
    logToOutput('=== Extract to Module with Search ===');
    logToOutput('Starting extraction process');

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        logToOutput('ERROR: No active editor found');
        vscode.window.showErrorMessage('No active editor found');
        return;
    }

    logToOutput(`Active editor found: ${editor.document.fileName}`);
    logToOutput(`Document language: ${editor.document.languageId}`);

    if (editor.document.languageId !== 'rust') {
        logToOutput(`ERROR: Not a Rust file (language: ${editor.document.languageId})`);
        vscode.window.showErrorMessage('This command only works with Rust files');
        return;
    }

    const selection = editor.selection;
    logToOutput(`Selection: start=${selection.start.line}:${selection.start.character}, end=${selection.end.line}:${selection.end.character}`);

    if (selection.isEmpty) {
        logToOutput('ERROR: No code selected - selection is empty');
        vscode.window.showErrorMessage('Please select the code you want to extract');
        return;
    }

    const selectedText = editor.document.getText(selection);
    logToOutput(`Selected ${selectedText.length} characters`);
    logToOutput(`Selected text preview: ${selectedText.substring(0, 100)}${selectedText.length > 100 ? '...' : ''}`);

    try {
        // Analyze the selected code
        logToOutput('Starting code analysis...');
        const analyzer = new RustCodeAnalyzer(editor.document, rustAnalyzerIntegration);

        logToOutput('Calling analyzer.analyzeSelection()...');
        const analysisResult = await analyzer.analyzeSelection(selection, selectedText);
        logToOutput(`Analysis complete - found ${analysisResult.functions.length} functions, ${analysisResult.structs.length} structs, ${analysisResult.enums.length} enums`);
        logToOutput(`Used types: ${Array.from(analysisResult.usedTypes).join(', ')}`);
        logToOutput(`Used traits: ${Array.from(analysisResult.usedTraits).join(', ')}`);
        logToOutput(`Is inside impl block: ${analysisResult.isInsideImpl}`);

        // Get module name from user
        logToOutput('Prompting user for module name...');
        const moduleName = await vscode.window.showInputBox({
            prompt: 'Enter the module name',
            placeHolder: 'my_module',
            validateInput: (value) => {
                logToOutput(`Validating module name: "${value}"`);
                if (!value) {
                    return 'Module name cannot be empty';
                }
                if (!/^[a-z][a-z0-9_]*$/.test(value)) {
                    logToOutput(`Module name validation failed: "${value}" doesn't match pattern`);
                    return 'Module name must be lowercase with underscores (snake_case)';
                }
                logToOutput(`Module name validation passed: "${value}"`);
                return null;
            }
        });

        if (!moduleName) {
            logToOutput('User cancelled module name input');
            return; // User cancelled
        }
        logToOutput(`Module name confirmed: ${moduleName}`);

        // Get workspace root
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            logToOutput('ERROR: No workspace folder found');
            vscode.window.showErrorMessage('No workspace folder found');
            return;
        }
        logToOutput(`Workspace folder: ${workspaceFolder.uri.fsPath}`);
        logToOutput(`Extension URI: ${extensionUri.fsPath}`);

        // Show webview panel to select destination
        logToOutput('Opening webview panel for path selection...');
        logToOutput(`Calling ModuleExtractorPanel.show() with params: moduleName="${moduleName}", selectedText.length=${selectedText.length}`);

        const selectedPath = await ModuleExtractorPanel.show(
            moduleName,
            selectedText,
            analysisResult,
            workspaceFolder,
            extensionUri
        );

        if (!selectedPath) {
            logToOutput('User cancelled path selection or no path returned');
            return; // User cancelled
        }
        logToOutput(`Path selected: ${selectedPath}`);

        // Extract the module
        logToOutput('Creating ModuleExtractor instance...');
        const extractor = new ModuleExtractor(
            editor.document,
            analysisResult,
            moduleName,
            selectedPath,
            rustAnalyzerIntegration,
            selection // Pass original selection for accurate replacement
        );

        logToOutput('Starting module extraction process...');
        await extractor.extract();
        logToOutput('Module extraction completed successfully!');

        vscode.window.showInformationMessage(
            `Successfully extracted code to module '${moduleName}' at ${selectedPath}`
        );
        logToOutput('Success message shown to user');

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logToOutput(`ERROR: ${errorMessage}`);
        logToOutput(`Error type: ${typeof error}`);
        if (error instanceof Error && error.stack) {
            logToOutput(`Stack trace: ${error.stack}`);
        }
        vscode.window.showErrorMessage(`Failed to extract module: ${errorMessage}`);
        console.error('Extract to module error:', error);
        logToOutput('Extraction process failed');
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
