import * as path from 'path';
import * as vscode from 'vscode';
import { RustCodeAnalyzer } from './analyzer';
import { logToOutput, ModuleExtractor } from './extractor';
import { IExtractToModuleParameters } from './IExtractToModuleParameters';
import { RustAnalyzerIntegration } from './rustAnalyzerIntegration';

/**
 * Language model tool for extracting Rust code to a new module.
 *
 * This tool prioritizes symbol matching when a functionName is provided,
 * falling back to line numbers if the symbol cannot be found.
 * Symbol matching is more reliable than line numbers, especially after
 * previous extractions that may have changed line numbers.
 */

export class ExtractToModuleTool implements vscode.LanguageModelTool<IExtractToModuleParameters> {
    constructor(private rustAnalyzer: RustAnalyzerIntegration) { }

    /**
     * Finds a symbol (function, struct, enum, trait) by name in the document.
     * Uses VS Code's symbol provider API for accurate, line-number-independent lookup.
     */
    private async findSymbolByName(
        document: vscode.TextDocument,
        symbolName: string
    ): Promise<{ selection: vscode.Selection; text: string; } | null> {
        try {
            // Get all document symbols
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider',
                document.uri
            );

            if (!symbols || symbols.length === 0) {
                return null;
            }

            // Recursively search for the symbol
            const findSymbol = (syms: vscode.DocumentSymbol[]): vscode.DocumentSymbol | null => {
                for (const symbol of syms) {
                    if (symbol.name === symbolName) {
                        return symbol;
                    }
                    if (symbol.children && symbol.children.length > 0) {
                        const found = findSymbol(symbol.children);
                        if (found) return found;
                    }
                }
                return null;
            };

            const symbol = findSymbol(symbols);
            if (!symbol) {
                return null;
            }

            // Expand to include attributes (e.g., #[get("/path")])
            const startLine = this.findAttributeStart(document, symbol.range.start.line);
            const selection = new vscode.Selection(
                new vscode.Position(startLine, 0),
                symbol.range.end
            );

            return {
                selection,
                text: document.getText(selection)
            };
        } catch (err) {
            console.error('Error finding symbol by name:', err);
            return null;
        }
    }

    /**
     * Scans upward to find attributes and doc comments attached to a symbol.
     */
    private findAttributeStart(document: vscode.TextDocument, symbolStartLine: number): number {
        let line = symbolStartLine - 1;
        while (line >= 0) {
            const text = document.lineAt(line).text.trim();
            if (text.startsWith('#[') || text.startsWith('///') || text === '') {
                line--;
                continue;
            }
            break;
        }
        return line + 1;
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<IExtractToModuleParameters>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const params = options.input;
        const fileName = path.basename(params.sourceFilePath);
        const targetPath = params.modulePath || `src/${params.moduleName}.rs`;

        // Determine the extraction method for the confirmation message
        const extractionMethod = params.functionName
            ? `symbol '${params.functionName}' (with line ${params.startLine}-${params.endLine} as fallback)`
            : `lines ${params.startLine}-${params.endLine}`;

        const confirmationMessages = {
            title: 'Extract Rust code to module',
            message: new vscode.MarkdownString(
                `Extract code from **${fileName}** (${extractionMethod}) to module \`${params.moduleName}\` at \`${targetPath}\`?\n\n` +
                `This will:\n` +
                `- Create a new module file with the extracted code\n` +
                `- Preserve impl blocks and proper type imports\n` +
                `- Update parent module with proper declarations\n` +
                `- Replace original code with a reference comment\n\n` +
                `${params.functionName ? `**Note:** Will attempt symbol matching first for '${params.functionName}', falling back to line numbers if needed.` : ''}`
            ),
        };

        return {
            invocationMessage: `Extracting code to module '${params.moduleName}'...`,
            confirmationMessages,
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<IExtractToModuleParameters>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const params = options.input;

        try {
            // Validate module name
            if (!/^[a-z][a-z0-9_]*$/.test(params.moduleName)) {
                throw new Error(
                    'Module name must be lowercase with underscores (snake_case). ' +
                    'Please retry with a valid module name like "my_module".'
                );
            }

            // Open the document
            const uri = vscode.Uri.file(params.sourceFilePath);
            const document = await vscode.workspace.openTextDocument(uri);

            if (document.languageId !== 'rust') {
                throw new Error(
                    `File ${params.sourceFilePath} is not a Rust file. ` +
                    'Please retry with a Rust source file (.rs extension).'
                );
            }

            // Initialize with line numbers as default
            let selection: vscode.Selection = new vscode.Selection(0, 0, 0, 0);
            let selectedText: string = '';
            let usedSymbolMatching = false;

            // Try symbol matching first if functionName is provided
            if (params.functionName) {
                logToOutput(`[ExtractToModuleTool] Attempting to find symbol by name: ${params.functionName}`);
                const symbolResult = await this.findSymbolByName(document, params.functionName);
                // pipe the result if found
                logToOutput(`[ExtractToModuleTool] Symbol matching result: ${symbolResult ? 'Found' : 'Not Found'}`);
                if (symbolResult) {
                    selection = symbolResult.selection;
                    selectedText = symbolResult.text;
                    usedSymbolMatching = true;
                    logToOutput(`[ExtractToModuleTool] Successfully found symbol '${params.functionName}' using symbol matching`);
                } else {
                    logToOutput(`[ExtractToModuleTool] Symbol '${params.functionName}' not found, falling back to line numbers`);
                }
            }

            // Fallback to line numbers if symbol matching wasn't used or failed
            if (!usedSymbolMatching) {
                const startPos = new vscode.Position(params.startLine - 1, 0);
                const endLine = document.lineAt(params.endLine - 1);
                const endPos = new vscode.Position(params.endLine - 1, endLine.text.length);
                selection = new vscode.Selection(startPos, endPos);
                selectedText = document.getText(selection);
                logToOutput(`[ExtractToModuleTool] Using line numbers ${params.startLine}-${params.endLine} for selection`);
            }

            if (!selectedText.trim()) {
                const method = usedSymbolMatching ? 'symbol matching' : 'line numbers';
                throw new Error(
                    `The selected code using ${method} does not contain any code. ` +
                    `Please retry with valid parameters that contain Rust code.`
                );
            }

            // Analyze the selected code
            const analyzer = new RustCodeAnalyzer(document, this.rustAnalyzer);

            // use the symbol api to get the whole symbol information
            const analysisResult = await analyzer.analyzeSelection(selection, selectedText);

            // Determine module path
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                throw new Error('No workspace folder found. Please open a Rust project workspace.');
            }

            const config = vscode.workspace.getConfiguration('rustyRefactor');
            const defaultPath = config.get<string>('defaultModulePath', 'src');
            let modulePath = params.modulePath || `${defaultPath}/${params.moduleName}.rs`;

            // Ensure the module path ends with .rs
            if (!modulePath.endsWith('.rs')) {
                modulePath = `${modulePath}.rs`;
            }

            // Extract the module
            const extractor = new ModuleExtractor(
                document,
                analysisResult,
                params.moduleName,
                modulePath,
                this.rustAnalyzer,
                selection // Pass original selection for accurate replacement
            );

            await extractor.extract();

            // Build structured result with actionable data
            const publicItems = [
                ...analysisResult.functions.filter(f => f.isPublic).map(f => f.name),
                ...analysisResult.structs.filter(s => s.isPublic).map(s => s.name),
                ...analysisResult.enums.filter(e => e.isPublic).map(e => e.name),
                ...analysisResult.traits.filter(t => t.isPublic).map(t => t.name),
            ];

            const functionNames = analysisResult.functions.map(f => f.name);
            const structNames = analysisResult.structs.map(s => s.name);
            const enumNames = analysisResult.enums.map(e => e.name);
            const traitNames = analysisResult.traits.map(t => t.name);

            // Create structured JSON output for LLM
            const structuredResult = {
                success: true,
                module_name: params.moduleName,
                module_path: modulePath,
                extraction_method: usedSymbolMatching ? 'symbol_matching' : 'line_numbers',
                extracted_items: {
                    functions: functionNames,
                    structs: structNames,
                    enums: enumNames,
                    traits: traitNames,
                    total_count: functionNames.length + structNames.length + enumNames.length + traitNames.length
                },
                public_exports: publicItems,
                usage: `use crate::${params.moduleName}::*;`,
                impl_context: analysisResult.isInsideImpl && analysisResult.implContext ? {
                    target_type: analysisResult.implContext.targetType,
                    trait_name: analysisResult.implContext.traitName || null
                } : null
            };

            // Create human-readable message
            let humanMessage = `✓ Successfully extracted to module '${params.moduleName}'\n\n`;
            humanMessage += `**Location:** ${modulePath}\n`;
            humanMessage += `**Method:** ${usedSymbolMatching ? 'Symbol matching' : 'Line-based'}\n\n`;
            
            if (functionNames.length > 0) humanMessage += `**Functions:** ${functionNames.join(', ')}\n`;
            if (structNames.length > 0) humanMessage += `**Structs:** ${structNames.join(', ')}\n`;
            if (enumNames.length > 0) humanMessage += `**Enums:** ${enumNames.join(', ')}\n`;
            if (traitNames.length > 0) humanMessage += `**Traits:** ${traitNames.join(', ')}\n`;
            
            if (publicItems.length > 0) {
                humanMessage += `\n**Public API:** ${publicItems.join(', ')}\n`;
                humanMessage += `**Import with:** \`use crate::${params.moduleName}::{${publicItems.join(', ')}};\`\n`;
            }

            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`${humanMessage}\n\n**Structured data:**\n\`\`\`json\n${JSON.stringify(structuredResult, null, 2)}\n\`\`\``)
            ]);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            
            // Provide specific, actionable error guidance
            let guidance = '';
            if (errorMessage.includes('snake_case')) {
                guidance = '\n\n**Fix:** Use lowercase letters with underscores (e.g., "user_service", "email_handler")';
            } else if (errorMessage.includes('not a Rust file')) {
                guidance = '\n\n**Fix:** Ensure the file path ends with .rs and points to a Rust source file';
            } else if (errorMessage.includes('does not contain any code')) {
                if (params.functionName) {
                    guidance = `\n\n**Fix:** Symbol '${params.functionName}' not found. Try:\n1. Verify the exact symbol name (case-sensitive)\n2. Check if the symbol exists in ${path.basename(params.sourceFilePath)}\n3. Use the analyze_rust_code tool first to discover available symbols`;
                } else {
                    guidance = `\n\n**Fix:** Lines ${params.startLine}-${params.endLine} appear empty. Try:\n1. Use the analyze_rust_code tool to find the correct line numbers\n2. Or provide a functionName parameter for symbol-based extraction`;
                }
            } else if (errorMessage.includes('No workspace folder')) {
                guidance = '\n\n**Fix:** This tool requires an open Rust workspace. Ask the user to open a folder containing a Cargo.toml file';
            }
            
            throw new Error(
                `❌ Extraction failed: ${errorMessage}${guidance}`
            );
        }
    }
}
