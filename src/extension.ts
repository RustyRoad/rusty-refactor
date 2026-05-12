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
import { SrpRefactorTool } from './SrpRefactorTool';
import { CodetetherClient, UnifiedModelClient } from './codetetherClient';
import { CodetetherCodeActionProvider, handleFixWithCodetether, handleFixAllWithCodetether } from './fixWithCodetether';
import { registerChatParticipant } from './chatParticipant';
import { CodetetherChatViewProvider } from './sidebar/CodetetherChatViewProvider';

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

        // Register CodeAction provider for diagnostics
        outputChannel.appendLine('Registering Codetether CodeActionProvider...');
        const codeActionRegistration = vscode.languages.registerCodeActionsProvider(
            { scheme: 'file', language: 'rust' },
            new CodetetherCodeActionProvider(),
            { providedCodeActionKinds: CodetetherCodeActionProvider.providedCodeActionKinds }
        );
        
        // Register TS CodeAction
        const tsCodeActionRegistration = vscode.languages.registerCodeActionsProvider(
            [{ scheme: 'file', language: 'typescript' }, { scheme: 'file', language: 'typescriptreact' }],
            new CodetetherCodeActionProvider(),
            { providedCodeActionKinds: CodetetherCodeActionProvider.providedCodeActionKinds }
        );
        
        context.subscriptions.push(codeActionRegistration, tsCodeActionRegistration);
        outputChannel.appendLine('✓ CodeActionProvider registered');

        // Register language model tools for Copilot Chat integration
        outputChannel.appendLine('Registering language model tools...');
        const lmSummary = registerLanguageModelTools(context, rustAnalyzerIntegration);
        outputChannel.appendLine(`✓ Language model tools registered: ${lmSummary.registered.length}`);
        if (lmSummary.failed.length > 0) {
            outputChannel.appendLine(`⚠ Language model tools failed: ${lmSummary.failed.length}`);
            for (const failure of lmSummary.failed) {
                outputChannel.appendLine(`  - ${failure.id}: ${failure.error}`);
            }
        }

        // Register Codetether Chat Participant
        outputChannel.appendLine('Registering Codetether Chat Participant...');
        registerChatParticipant(context);
        outputChannel.appendLine('✓ Codetether Chat Participant registered');

        // Register Codetether Sidebar View
        const chatProvider = new CodetetherChatViewProvider(context.extensionUri);
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(
                CodetetherChatViewProvider.viewType,
                chatProvider,
                { webviewOptions: { retainContextWhenHidden: true } }
            )
        );
        outputChannel.appendLine('✓ Codetether Sidebar registered');

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

        // Register command: SRP Refactor entire file
        const srpRefactorCommand = vscode.commands.registerCommand(
            'rustyRefactor.srpRefactorFile',
            async (resource?: vscode.Uri) => {
                let editor = vscode.window.activeTextEditor;

                if (resource) {
                    try {
                        const document = await vscode.workspace.openTextDocument(resource);
                        editor = await vscode.window.showTextDocument(document, { preview: false });
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        vscode.window.showErrorMessage(`Failed to open selected file: ${errorMessage}`);
                        return;
                    }
                }

                if (!editor) {
                    vscode.window.showErrorMessage('No active editor');
                    return;
                }
                const langId = editor.document.languageId;
                const isSupported = ['rust', 'typescript', 'typescriptreact'].includes(langId);
                if (!isSupported) {
                    vscode.window.showErrorMessage('SRP Refactor is available for Rust and TypeScript files');
                    return;
                }

                const filePath = editor.document.uri.fsPath;
                const maxLinesInput = await vscode.window.showInputBox({
                    prompt: 'Max lines per module (default: 50)',
                    value: '50',
                    validateInput: (v) => {
                        const n = parseInt(v, 10);
                        return (isNaN(n) || n < 10) ? 'Enter a number ≥ 10' : undefined;
                    }
                });
                if (maxLinesInput === undefined) return;

                const maxLines = parseInt(maxLinesInput, 10);
                const srpTool = new SrpRefactorTool(rustAnalyzerIntegration);

                await vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Notification, title: 'SRP Refactoring...', cancellable: true },
                    async (progress, token) => {
                        progress.report({ message: `Splitting ${path.basename(filePath)} into SRP modules (≤${maxLines} lines)` });
                        const result = await srpTool.invoke(
                            { input: { filePath, maxLinesPerModule: maxLines, autoFixImports: true } } as any,
                            token
                        );
                        const part = result.content[0] as any;
                        const text: string = part?.value ?? part?.toString() ?? '';
                        outputChannel.appendLine(text);
                        outputChannel.show(true);
                        vscode.window.showInformationMessage(`SRP Refactor complete — see output for details`);
                    }
                );
            }
        );

        // Register command: Select preferred AI model
        const selectAIModelCommand = vscode.commands.registerCommand(
            'rustyRefactor.selectAIModel',
            async () => {
                const config = vscode.workspace.getConfiguration('rustyRefactor');
                const unifiedClient = new UnifiedModelClient();

                const currentPreferred = config.get<string>('aiPreferredModel') || '';
                const currentFast = config.get<string>('aiFastModel') || '';
                const currentCodetether = config.get<string>('codetetherModel') || '';
                const useCodetether = config.get<boolean>('useCodetether') || false;

                const actions = [
                    {
                        label: '$(star-full) Preferred VS Code model',
                        description: currentPreferred || 'Auto-select largest available model',
                        detail: 'Used for AI documentation and high-context planning.',
                        value: 'preferred'
                    },
                    {
                        label: '$(zap) Fast VS Code model',
                        description: currentFast || 'Auto-select fast/small model when possible',
                        detail: 'Used for validation, summaries, and quick SRP planning.',
                        value: 'fast'
                    },
                    {
                        label: '$(hubot) Codetether model',
                        description: currentCodetether || 'Codetether default',
                        detail: `Used by Codetether chat/refactor transport. Codetether is currently ${useCodetether ? 'enabled' : 'disabled'}.`,
                        value: 'codetether'
                    },
                    {
                        label: useCodetether ? '$(debug-disconnect) Disable Codetether transport' : '$(plug) Enable Codetether transport',
                        description: useCodetether ? 'Use VS Code language models' : 'Use codetether CLI/server transport',
                        detail: 'Switches rustyRefactor.useCodetether.',
                        value: 'toggleCodetether'
                    }
                ];

                const action = await vscode.window.showQuickPick(actions, {
                    title: 'Rusty Refactor Model Selector',
                    placeHolder: 'Choose what model setting to update',
                    matchOnDescription: true,
                    matchOnDetail: true
                });

                if (!action) {
                    return;
                }

                if (action.value === 'toggleCodetether') {
                    await config.update('useCodetether', !useCodetether, vscode.ConfigurationTarget.Global);
                    vscode.window.showInformationMessage(`Codetether transport ${!useCodetether ? 'enabled' : 'disabled'}.`);
                    return;
                }

                const availableModels = await unifiedClient.getAvailableModels();
                const wantedSource = action.value === 'codetether' ? 'codetether' : 'vscode';
                const models = availableModels.filter(model => model.source === wantedSource);

                const currentValue = action.value === 'preferred'
                    ? currentPreferred
                    : action.value === 'fast'
                        ? currentFast
                        : currentCodetether;

                const items = [
                    {
                        label: '$(clear-all) Automatic / default',
                        description: 'Clear this setting',
                        detail: wantedSource === 'codetether' ? 'Use Codetether default model resolution.' : 'Let Rusty Refactor choose from VS Code models.',
                        modelId: ''
                    },
                    ...models.map(model => ({
                        label: model.id === currentValue ? `$(check) ${model.id}` : model.id,
                        description: model.source === 'codetether' ? 'Codetether' : 'VS Code Language Model',
                        detail: model.id === currentValue ? 'Currently selected' : undefined,
                        modelId: model.id
                    }))
                ];

                const selected = await vscode.window.showQuickPick(items, {
                    title: action.label.replace(/^\$\([^)]*\)\s*/, ''),
                    placeHolder: models.length > 0 ? 'Pick a model' : 'No models discovered; choose default or type a custom model name',
                    matchOnDescription: true,
                    matchOnDetail: true
                });

                const pickedModel = selected?.modelId;
                const customModel = selected ? undefined : await vscode.window.showInputBox({
                    title: 'Custom model name',
                    prompt: 'Enter a model id manually, or leave blank for automatic/default',
                    value: currentValue,
                    placeHolder: wantedSource === 'codetether' ? 'openai-codex/gpt-5.5-fast' : 'vendor/family'
                });

                const modelValue = pickedModel !== undefined ? pickedModel : customModel;
                if (modelValue === undefined) {
                    return;
                }

                const setting = action.value === 'preferred'
                    ? 'aiPreferredModel'
                    : action.value === 'fast'
                        ? 'aiFastModel'
                        : 'codetetherModel';

                await config.update(setting, modelValue.trim(), vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage(`${setting} set to ${modelValue.trim() || 'automatic/default'}.`);
            }
        );

        // Register command: Fix with Codetether
        const fixWithCodetetherCommand = vscode.commands.registerCommand(
            'rustyRefactor.fixWithCodetether',
            async (uri: vscode.Uri, diagnostic: vscode.Diagnostic, range: vscode.Range) => {
                await handleFixWithCodetether(uri, diagnostic, range, true);
            }
        );

        // Register command: Fix All with Codetether
        const fixAllWithCodetetherCommand = vscode.commands.registerCommand(
            'rustyRefactor.fixAllWithCodetether',
            async (uri: vscode.Uri, diagnostics: readonly vscode.Diagnostic[], range: vscode.Range) => {
                await handleFixAllWithCodetether(uri, diagnostics, range, true);
            }
        );

        const openCodetetherTuiCommand = vscode.commands.registerCommand(
            'rustyRefactor.openCodetetherTui',
            async () => {
                openCodetetherTui();
            }
        );

        // Register command: Configure Codetether server/client
        const configureCodetetherCommand = vscode.commands.registerCommand(
            'rustyRefactor.configureCodetether',
            async () => {
                const config = vscode.workspace.getConfiguration('rustyRefactor');
                const codetether = new CodetetherClient();

                const options = [
                    { label: '$(plug) Enable Codetether', value: 'enable' },
                    { label: '$(debug-disconnect) Disable Codetether (use VS Code LM)', value: 'disable' },
                    { label: '$(terminal) Open Codetether TUI', value: 'tui' },
                    { label: '$(fileExecutable) Set Binary Path', value: 'path' },
                    { label: '$(symbol-symbol) Set Model Name', value: 'model' },
                    { label: '$(broadcast) Set Chat Transport', value: 'transport' },
                    { label: '$(settings-gear) Test Codetether', value: 'test' }
                ];

                const selected = await vscode.window.showQuickPick(options, {
                    placeHolder: 'Configure Codetether workspace server'
                });

                if (!selected) {
                    return;
                }

                switch (selected.value) {
                    case 'enable':
                        await config.update('useCodetether', true, vscode.ConfigurationTarget.Global);
                        vscode.window.showInformationMessage('Codetether enabled for refactoring');
                        break;

                    case 'disable':
                        await config.update('useCodetether', false, vscode.ConfigurationTarget.Global);
                        vscode.window.showInformationMessage('Using VS Code built-in language models');
                        break;

                    case 'path': {
                        const currentPath = config.get<string>('codetetherBinaryPath') || 'codetether';
                        const newPath = await vscode.window.showInputBox({
                            prompt: 'Path to codetether binary',
                            value: currentPath,
                            placeHolder: 'codetether or /usr/local/bin/codetether'
                        });
                        if (newPath !== undefined) {
                            await config.update('codetetherBinaryPath', newPath, vscode.ConfigurationTarget.Global);
                            vscode.window.showInformationMessage(`Binary path set to: ${newPath}`);
                        }
                        break;
                    }

                    case 'model': {
                        const currentModel = config.get<string>('codetetherModel') || '';
                        const newModel = await vscode.window.showInputBox({
                            prompt: 'Model name for codetether (leave empty for default)',
                            value: currentModel,
                            placeHolder: 'qwen-2.5-coder'
                        });
                        if (newModel !== undefined) {
                            await config.update('codetetherModel', newModel, vscode.ConfigurationTarget.Global);
                            vscode.window.showInformationMessage(`Model set to: ${newModel || '(default)'}`);
                        }
                        break;
                    }

                    case 'transport': {
                        const currentTransport = config.get<string>('codetetherChatTransport') || 'run';
                        const selectedTransport = await vscode.window.showQuickPick(
                            [
                                {
                                    label: 'codetether run',
                                    description: 'Run one CLI process per chat request',
                                    value: 'run'
                                },
                                {
                                    label: 'codetether serve + A2A',
                                    description: 'Keep a workspace server running and message /a2a',
                                    value: 'serve'
                                }
                            ],
                            { placeHolder: `Chat transport (current: ${currentTransport})` }
                        );
                        if (selectedTransport) {
                            await config.update('codetetherChatTransport', selectedTransport.value, vscode.ConfigurationTarget.Global);
                            vscode.window.showInformationMessage(`Codetether chat transport set to: ${selectedTransport.label}`);
                        }
                        break;
                    }

                    case 'tui': {
                        openCodetetherTui();
                        break;
                    }

                    case 'test': {
                        await vscode.window.withProgress(
                            { location: vscode.ProgressLocation.Notification, title: 'Testing Codetether workspace server...' },
                            async () => {
                                try {
                                    codetether.refreshConfig();
                                    const result = await codetether.checkAvailable();
                                    if (result.available) {
                                        vscode.window.showInformationMessage(
                                            `✓ Codetether available: ${result.version || 'ok'}`
                                        );
                                        outputChannel.appendLine(`[Codetether] Server test passed: ${result.version}`);
                                    } else {
                                        vscode.window.showErrorMessage(`Codetether unavailable: ${result.error}`);
                                    }
                                } catch (error) {
                                    const msg = error instanceof Error ? error.message : String(error);
                                    vscode.window.showErrorMessage(`Codetether test failed: ${msg}`);
                                    outputChannel.appendLine(`[Codetether] Test failed: ${msg}`);
                                }
                            }
                        );
                        break;
                    }
                }
            }
        );

        context.subscriptions.push(
            extractCommand,
            extractWithSearchCommand,
            extractCustomPathCommand,
            extractSymbolCommandReg,
            extractSymbolCustomCommand,
            extractSymbolWithSearchCommand,
            srpRefactorCommand,
            selectAIModelCommand,
            fixWithCodetetherCommand,
            fixAllWithCodetetherCommand,
            configureCodetetherCommand,
            openCodetetherTuiCommand
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

function openCodetetherTui(): void {
    const config = vscode.workspace.getConfiguration('rustyRefactor');
    const binaryPath = config.get<string>('codetetherBinaryPath') || 'codetether';
    const model = config.get<string>('codetetherModel') || '';
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const cwd = workspaceFolder?.uri.fsPath;

    const terminal = vscode.window.createTerminal({
        name: 'Codetether TUI',
        cwd
    });

    const quotedBinary = quoteShellArg(binaryPath);
    const modelArgs = model ? ` --model ${quoteShellArg(model)}` : '';
    terminal.show(true);
    terminal.sendText(`${quotedBinary} tui${modelArgs}`);
    logToOutput(`[Codetether] Opened TUI terminal${cwd ? ` in ${cwd}` : ''}${model ? ` with model ${model}` : ''}`);
}

function quoteShellArg(value: string): string {
    if (process.platform === 'win32') {
        return `"${value.replace(/"/g, '\\"')}"`;
    }

    return `'${value.replace(/'/g, `'\\''`)}'`;
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
    CodetetherClient.disposeAllServers();
    if (rustAnalyzerIntegration) {
        rustAnalyzerIntegration.dispose();
    }
}