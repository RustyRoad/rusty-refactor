import * as path from 'path';
import * as vscode from 'vscode';
import { RustCodeAnalyzer } from './analyzer';
import { logToOutput, ModuleExtractor } from './extractor';
import { IExtractToModuleParameters } from './IExtractToModuleParameters';
import { RustAnalyzerIntegration } from './rustAnalyzerIntegration';
import { Utils } from './utils';

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

    /**
     * Validates that the module path follows Rust and RustyRoad conventions:
     * - Modules should be organized as: parent_folder/module_folder/implementation.rs
     * - Each module folder should have a mod.rs that re-exports
     * - Example: src/controllers/ads/facebook/facebook_ads.rs
     *           with src/controllers/ads/facebook/mod.rs
     */
    private validateModulePath(modulePath: string, moduleName: string): void {
        const normalizedPath = modulePath.replace(/\\/g, '/');
        const pathParts = normalizedPath.split('/');
        const fileName = path.basename(normalizedPath);
        
        // Must end with .rs
        if (!fileName.endsWith('.rs')) {
            throw new Error(
                `Invalid module path: "${modulePath}"\n\n` +
                `**Error**: Path must end with .rs extension.\n\n` +
                `**Fix**: Add .rs extension to the file name.`
            );
        }
        
        const fileNameWithoutExt = fileName.replace('.rs', '');
        const parentDir = pathParts[pathParts.length - 2]; // The folder containing this file
        
        // Special case: if this is mod.rs, it's valid
        if (fileName === 'mod.rs') {
            return; // mod.rs is always valid
        }
        
        // Check if this is a flat structure (e.g., src/controllers/ads/facebook_ads.rs)
        // This violates the "one module per folder" rule
        if (pathParts.length >= 3 && parentDir !== 'src') {
            const grandParentDir = pathParts[pathParts.length - 3];
            
            // Check if the file is in its own dedicated folder
            // We allow some flexibility: folder can be named after module or a simplified version
            const possibleFolderNames = [
                moduleName,
                fileNameWithoutExt,
                // Handle common suffixes
                fileNameWithoutExt.replace(/_controller$/, ''),
                fileNameWithoutExt.replace(/_service$/, ''),
                fileNameWithoutExt.replace(/_model$/, ''),
                fileNameWithoutExt.replace(/_repository$/, ''),
            ];
            
            const isInOwnFolder = possibleFolderNames.includes(parentDir);
            
            if (!isInOwnFolder) {
                throw new Error(
                    `Invalid module path: "${modulePath}"\n\n` +
                    `**Rust Convention Violation**: Module file must be in its own folder.\n\n` +
                    `You're trying to create "${fileName}" directly in "${parentDir}/", ` +
                    `but it should be in a dedicated folder.\n\n` +
                    `**Correct Pattern**:\n` +
                    `\`\`\`\n${grandParentDir}/${parentDir}/${moduleName}/\n` +
                    `  ├── mod.rs              (auto-created with re-exports)\n` +
                    `  └── ${fileName}         (your implementation)\n\`\`\`\n\n` +
                    `**Fix**: Use this path instead:\n` +
                    `  "${pathParts.slice(0, -1).join('/')}/${moduleName}/${fileName}"\n\n` +
                    `**Example**: Instead of "src/controllers/ads/facebook_ads.rs", use:\n` +
                    `  "src/controllers/ads/facebook/facebook_ads.rs"\n` +
                    `  (mod.rs will be auto-created)`
                );
            }
        }
    }

    /**
     * Ensures the module folder exists and creates mod.rs if needed.
     * Works with rust-analyzer to register the module properly.
     */
    private async ensureModuleFolderStructure(
        modulePath: string,
        moduleName: string
    ): Promise<void> {
        const normalizedPath = modulePath.replace(/\\/g, '/');
        const fileName = path.basename(normalizedPath);
        
        // Skip if this is already a mod.rs file
        if (fileName === 'mod.rs') {
            return;
        }
        
        const moduleDir = path.dirname(modulePath);
        const modRsPath = path.join(moduleDir, 'mod.rs');
        
        // Check if mod.rs exists
        const modRsUri = vscode.Uri.file(modRsPath);
        let modRsExists = false;
        try {
            await vscode.workspace.fs.stat(modRsUri);
            modRsExists = true;
        } catch {
            modRsExists = false;
        }
        
        const fileNameWithoutExt = fileName.replace('.rs', '');
        
        if (!modRsExists) {
            // Create mod.rs with proper re-exports
            const modRsContent = [
                `//! ${path.basename(moduleDir)} module`,
                `//!`,
                `//! Auto-generated by Rusty Refactor`,
                ``,
                `pub mod ${fileNameWithoutExt};`,
                `pub use ${fileNameWithoutExt}::*;`,
                ``
            ].join('\n');
            
            await vscode.workspace.fs.writeFile(modRsUri, Buffer.from(modRsContent, 'utf8'));
            logToOutput(`[ExtractToModuleTool] Created mod.rs: ${modRsPath}`);
            logToOutput(`[ExtractToModuleTool] Re-exported: ${fileNameWithoutExt}`);
        } else {
            // mod.rs exists, check if it already exports this module
            const modRsDoc = await vscode.workspace.openTextDocument(modRsUri);
            const modRsText = modRsDoc.getText();
            
            const hasModDeclaration = modRsText.includes(`pub mod ${fileNameWithoutExt};`);
            const hasReExport = modRsText.includes(`pub use ${fileNameWithoutExt}::*;`);
            
            if (!hasModDeclaration || !hasReExport) {
                // Append the module declaration and re-export
                const edit = new vscode.WorkspaceEdit();
                const lastLine = modRsDoc.lineAt(modRsDoc.lineCount - 1);
                const insertPos = lastLine.range.end;
                
                let textToAdd = '';
                if (!hasModDeclaration) {
                    textToAdd += `\npub mod ${fileNameWithoutExt};`;
                }
                if (!hasReExport) {
                    textToAdd += `\npub use ${fileNameWithoutExt}::*;`;
                }
                
                edit.insert(modRsUri, insertPos, textToAdd);
                await vscode.workspace.applyEdit(edit);
                await modRsDoc.save();
                
                logToOutput(`[ExtractToModuleTool] Updated mod.rs with: ${fileNameWithoutExt}`);
            } else {
                logToOutput(`[ExtractToModuleTool] mod.rs already exports: ${fileNameWithoutExt}`);
            }
        }
        
        // Trigger rust-analyzer to recognize the new module structure
        try {
            await vscode.commands.executeCommand('rust-analyzer.reloadWorkspace');
            logToOutput(`[ExtractToModuleTool] Triggered rust-analyzer reload`);
        } catch (err) {
            logToOutput(`[ExtractToModuleTool] Warning: Could not trigger rust-analyzer reload: ${err}`);
        }
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

            // Normalize the module path to be relative to workspace
            // This handles both absolute paths and paths with duplicate workspace roots
            modulePath = Utils.extractWorkspaceRoot(modulePath);
            
            // Normalize path separators to forward slashes
            modulePath = modulePath.replace(/\\/g, '/');

            // Ensure the module path ends with .rs
            if (!modulePath.endsWith('.rs')) {
                modulePath = `${modulePath}.rs`;
            }

            logToOutput(`[ExtractToModuleTool] Normalized module path: ${modulePath}`);

            // Validate module path follows "one module per folder" convention
            this.validateModulePath(modulePath, params.moduleName);

            // Ensure folder structure exists and create mod.rs if needed
            await this.ensureModuleFolderStructure(modulePath, params.moduleName);

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
