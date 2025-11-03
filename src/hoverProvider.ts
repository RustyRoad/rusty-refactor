import * as vscode from 'vscode';
import { RustAnalyzerIntegration } from './rustAnalyzerIntegration';
import { RustCodeAnalyzer } from './analyzer';
import { 
    getFunctionAtPosition, 
    analyzeLifetimes, 
    resolveTraitBounds, 
    isNativeModuleAvailable 
} from './nativeBridge';

/**
 * Hover provider that shows "Extract to Module" suggestions for Rust code
 */
export class RustRefactorHoverProvider implements vscode.HoverProvider {
    constructor(private rustAnalyzer: RustAnalyzerIntegration) {}

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | null> {
        // Only work with Rust files
        if (document.languageId !== 'rust') {
            return null;
        }

        try {
            // Try native bridge first for more accurate function detection
            let functionInfo = null;
            if (isNativeModuleAvailable()) {
                try {
                    functionInfo = await getFunctionAtPosition(
                        document.uri.fsPath,
                        position.line + 1, // Convert to 1-based
                        position.character + 1
                    );
                } catch (error) {
                    console.warn('Native bridge function detection failed, falling back to rust-analyzer:', error);
                }
            }

            // Use rust-analyzer as fallback or for non-function symbols
            let symbol = null;
            if (functionInfo) {
                // Create a synthetic symbol from native bridge function info
                symbol = this.createSymbolFromFunctionInfo(functionInfo, document, position);
            } else {
                symbol = await this.rustAnalyzer.getSymbolAtPosition(document, position);
            }
            
            if (!symbol) {
                return null;
            }

            // Check if this symbol is extractable (function, struct, enum, trait, or impl)
            if (!this.isExtractableSymbol(symbol)) {
                return null;
            }

            // Create selection for entire symbol
            const selection = new vscode.Selection(symbol.range.start, symbol.range.end);
            const selectedText = document.getText(selection);

            // Enhanced analysis using native bridge
            const enhancedAnalysis = await this.getEnhancedAnalysis(selectedText);

            // Quick analysis to determine if extraction makes sense
            if (!this.shouldShowExtractSuggestion(symbol, selectedText, enhancedAnalysis)) {
                return null;
            }

            // Create hover content with extract action
            const hoverContent = this.createHoverContent(symbol, document, selection, functionInfo, enhancedAnalysis);
            
            return new vscode.Hover(hoverContent, symbol.range);

        } catch (error) {
            console.error('Error in hover provider:', error);
            return null;
        }
    }

    private createSymbolFromFunctionInfo(functionInfo: any, document: vscode.TextDocument, position: vscode.Position): vscode.DocumentSymbol {
        // Create a synthetic DocumentSymbol from native bridge function info
        const line = functionInfo.span?.line_start || position.line;
        const endLine = functionInfo.span?.line_end || line;
        const startCol = functionInfo.span?.column_start || position.character;
        const endCol = functionInfo.span?.column_end || startCol + functionInfo.name.length;

        const range = new vscode.Range(
            new vscode.Position(line - 1, startCol - 1), // Convert to 0-based
            new vscode.Position(endLine - 1, endCol - 1)
        );

        return {
            name: functionInfo.name,
            detail: functionInfo.signature,
            kind: vscode.SymbolKind.Function,
            range: range,
            selectionRange: range,
            children: []
        };
    }

    private async getEnhancedAnalysis(code: string): Promise<{
        lifetimeSuggestions: any[];
        traitBounds: any[];
    }> {
        const analysis: {
            lifetimeSuggestions: any[];
            traitBounds: any[];
        } = {
            lifetimeSuggestions: [],
            traitBounds: []
        };

        if (!isNativeModuleAvailable()) {
            return analysis;
        }

        try {
            // Analyze lifetimes
            const lifetimeSuggestions = await analyzeLifetimes(code);
            if (lifetimeSuggestions) {
                analysis.lifetimeSuggestions = lifetimeSuggestions;
            }

            // Resolve trait bounds
            const traitBounds = await resolveTraitBounds(code);
            if (traitBounds) {
                analysis.traitBounds = traitBounds;
            }
        } catch (error) {
            console.warn('Enhanced analysis failed:', error);
        }

        return analysis;
    }

    private isExtractableSymbol(symbol: vscode.DocumentSymbol): boolean {
        const extractableKinds = [
            vscode.SymbolKind.Function,
            vscode.SymbolKind.Struct,
            vscode.SymbolKind.Enum,
            vscode.SymbolKind.Interface, // Traits
            vscode.SymbolKind.Method,
            vscode.SymbolKind.Class // Impl blocks
        ];

        return extractableKinds.includes(symbol.kind);
    }

    private shouldShowExtractSuggestion(
        symbol: vscode.DocumentSymbol, 
        code: string, 
        enhancedAnalysis: { lifetimeSuggestions: any[], traitBounds: any[] }
    ): boolean {
        // Don't suggest extraction for very small symbols
        const lineCount = symbol.range.end.line - symbol.range.start.line + 1;
        if (lineCount < 3) {
            return false;
        }

        // Don't suggest for simple getters/setters
        if (symbol.name.startsWith('get_') || symbol.name.startsWith('set_')) {
            if (lineCount < 5) {
                return false;
            }
        }

        // Don't suggest for test functions
        if (symbol.name.startsWith('test_') || symbol.name.includes('_test')) {
            return false;
        }

        // Enhanced complexity detection
        const hasComplexity = 
            code.includes('impl ') ||
            code.includes('match ') ||
            code.includes('for ') ||
            code.includes('while ') ||
            code.includes('if ') && code.includes(' else ') ||
            code.includes('Result<') ||
            code.includes('Option<') ||
            enhancedAnalysis.lifetimeSuggestions.length > 0 ||
            enhancedAnalysis.traitBounds.length > 0 ||
            code.split('\n').length > 5;

        return hasComplexity;
    }

    private createHoverContent(
        symbol: vscode.DocumentSymbol, 
        document: vscode.TextDocument, 
        selection: vscode.Selection,
        functionInfo: any,
        enhancedAnalysis: { lifetimeSuggestions: any[], traitBounds: any[] }
    ): vscode.MarkdownString {
        const content = new vscode.MarkdownString();
        
        // Add symbol information with enhanced details
        const symbolType = this.getSymbolTypeDescription(symbol.kind);
        content.appendMarkdown(`**${symbolType}:** \`${symbol.name}\`\n\n`);
        
        // Add function signature if available from native bridge
        if (functionInfo && functionInfo.signature) {
            content.appendMarkdown(`**Signature:** \`${functionInfo.signature}\`\n\n`);
        }

        // Add enhanced analysis insights
        if (enhancedAnalysis.lifetimeSuggestions.length > 0) {
            content.appendMarkdown(`**Lifetime Analysis:** ${enhancedAnalysis.lifetimeSuggestions.length} suggestions\n\n`);
        }

        if (enhancedAnalysis.traitBounds.length > 0) {
            const traitNames = enhancedAnalysis.traitBounds.map((tb: any) => tb.trait_name).join(', ');
            content.appendMarkdown(`**Trait Bounds:** ${traitNames}\n\n`);
        }

        // Add extract suggestion
        content.appendMarkdown('💡 **Extract to Module**\n\n');
        content.appendMarkdown('This code can be extracted to a separate module for better organization.\n\n');
        
        // Add command links for different extraction options
        const startLine = symbol.range.start.line + 1; // Convert to 1-based
        const endLine = symbol.range.end.line + 1;
        const filePath = document.uri.fsPath;
        
        content.appendMarkdown('**Actions:**\n');
        content.appendMarkdown(`- [Extract with Default Path](command:rustyRefactor.extractSymbol?${encodeURIComponent(JSON.stringify([filePath, startLine, endLine, symbol.name]))})\n`);
        content.appendMarkdown(`- [Extract with Custom Path](command:rustyRefactor.extractSymbolCustom?${encodeURIComponent(JSON.stringify([filePath, startLine, endLine, symbol.name]))})\n`);
        content.appendMarkdown(`- [Extract with File Search](command:rustyRefactor.extractSymbolWithSearch?${encodeURIComponent(JSON.stringify([filePath, startLine, endLine, symbol.name]))})\n\n`);
        
        // Add preview of the code
        const codePreview = document.getText(selection).split('\n').slice(0, 5).join('\n');
        content.appendMarkdown('**Code Preview:**\n');
        content.appendMarkdown('```rust\n');
        content.appendMarkdown(codePreview);
        if (document.getText(selection).split('\n').length > 5) {
            content.appendMarkdown('\n// ... more lines');
        }
        content.appendMarkdown('\n```\n');
        
        // Add complexity indicators
        const complexityIndicators = [];
        if (enhancedAnalysis.lifetimeSuggestions.length > 0) complexityIndicators.push('lifetimes');
        if (enhancedAnalysis.traitBounds.length > 0) complexityIndicators.push('trait bounds');
        if (functionInfo?.is_unsafe) complexityIndicators.push('unsafe');
        if (functionInfo?.is_async) complexityIndicators.push('async');

        if (complexityIndicators.length > 0) {
            content.appendMarkdown(`**Complexity Indicators:** ${complexityIndicators.join(', ')}\n`);
        }
        
        content.isTrusted = true; // Allow command links
        return content;
    }

    private getSymbolTypeDescription(kind: vscode.SymbolKind): string {
        switch (kind) {
            case vscode.SymbolKind.Function:
                return 'Function';
            case vscode.SymbolKind.Method:
                return 'Method';
            case vscode.SymbolKind.Struct:
                return 'Struct';
            case vscode.SymbolKind.Enum:
                return 'Enum';
            case vscode.SymbolKind.Interface:
                return 'Trait';
            case vscode.SymbolKind.Class:
                return 'Implementation';
            default:
                return 'Symbol';
        }
    }
}

/**
 * Command handler for extracting symbols from hover actions
 */
export class ExtractSymbolCommand {
    constructor(private rustAnalyzer: RustAnalyzerIntegration) {}

    async extractSymbol(
        filePath: string,
        startLine: number,
        endLine: number,
        suggestedName: string,
        useCustomPath: boolean = false,
        useFileSearch: boolean = false
    ): Promise<void> {
        try {
            // Open the document
            const uri = vscode.Uri.file(filePath);
            const document = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(document);

            // Create selection
            const selection = new vscode.Selection(
                new vscode.Position(startLine - 1, 0),
                new vscode.Position(endLine - 1, document.lineAt(endLine - 1).text.length)
            );

            // Apply selection
            editor.selection = selection;

            // Get module name with suggestion
            const moduleName = await vscode.window.showInputBox({
                prompt: 'Enter the module name',
                placeHolder: suggestedName,
                value: suggestedName,
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

            // Analyze the selected code
            const analyzer = new RustCodeAnalyzer(document, this.rustAnalyzer);
            const selectedText = document.getText(selection);
            const analysisResult = await analyzer.analyzeSelection(selection, selectedText);

            if (useFileSearch) {
                // Use file search webview
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (!workspaceFolder) {
                    throw new Error('No workspace folder found');
                }

                const { ModuleExtractorPanel } = await import('./webview/ModuleExtractorPanel');
                const selectedPath = await ModuleExtractorPanel.show(
                    moduleName,
                    selectedText,
                    analysisResult,
                    workspaceFolder,
                    vscode.Uri.joinPath(workspaceFolder.uri, 'out')
                );

                if (!selectedPath) {
                    return; // User cancelled
                }

                // Extract the module
                const { ModuleExtractor } = await import('./extractor');
                const extractor = new ModuleExtractor(
                    document,
                    analysisResult,
                    moduleName,
                    selectedPath,
                    this.rustAnalyzer,
                    selection
                );
                
                await extractor.extract();
                vscode.window.showInformationMessage(
                    `Successfully extracted ${suggestedName} to module '${moduleName}' at ${selectedPath}`
                );
            } else {
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
                const { ModuleExtractor } = await import('./extractor');
                const extractor = new ModuleExtractor(
                    document,
                    analysisResult,
                    moduleName,
                    modulePath,
                    this.rustAnalyzer,
                    selection
                );
                
                await extractor.extract();
                vscode.window.showInformationMessage(
                    `Successfully extracted ${suggestedName} to module '${moduleName}'`
                );
            }

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to extract ${suggestedName}: ${errorMessage}`);
            console.error('Extract symbol error:', error);
        }
    }
}
