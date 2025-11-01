import * as vscode from 'vscode';
import * as path from 'path';
import { RustCodeAnalyzer } from './analyzer';
import { ModuleExtractor } from './extractor';
import { RustAnalyzerIntegration } from './rustAnalyzerIntegration';

/**
 * Input parameters for the extract_to_module tool
 */
export interface IExtractToModuleParameters {
    /**
     * The absolute file path of the Rust source file containing the code to extract
     */
    sourceFilePath: string;
    
    /**
     * The starting line number of the code to extract (1-based)
     */
    startLine: number;
    
    /**
     * The ending line number of the code to extract (1-based, inclusive)
     */
    endLine: number;
    
    /**
     * The name of the module to create (must be snake_case)
     */
    moduleName: string;
    
    /**
     * The relative path where the module should be created (e.g., "src/models/my_module.rs")
     * Optional - if not provided, will use default path from settings
     */
    modulePath?: string;
}

/**
 * Input parameters for the analyze_rust_code tool
 */
export interface IAnalyzeRustCodeParameters {
    /**
     * The absolute file path of the Rust source file to analyze
     */
    filePath: string;
    
    /**
     * The starting line number to analyze (1-based)
     */
    startLine: number;
    
    /**
     * The ending line number to analyze (1-based, inclusive)
     */
    endLine: number;
}

/**
 * Language model tool for extracting Rust code to a new module
 */
export class ExtractToModuleTool implements vscode.LanguageModelTool<IExtractToModuleParameters> {
    constructor(private rustAnalyzer: RustAnalyzerIntegration) {}

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<IExtractToModuleParameters>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const params = options.input;
        const fileName = path.basename(params.sourceFilePath);
        const targetPath = params.modulePath || `src/${params.moduleName}.rs`;
        
        const confirmationMessages = {
            title: 'Extract Rust code to module',
            message: new vscode.MarkdownString(
                `Extract code from **${fileName}** (lines ${params.startLine}-${params.endLine}) to module \`${params.moduleName}\` at \`${targetPath}\`?\n\n` +
                `This will:\n` +
                `- Create a new module file with the extracted code\n` +
                `- Preserve impl blocks and proper type imports\n` +
                `- Update parent module with proper declarations\n` +
                `- Replace original code with a reference comment`
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

            // Create selection from line numbers
            const startPos = new vscode.Position(params.startLine - 1, 0);
            const endLine = document.lineAt(params.endLine - 1);
            const endPos = new vscode.Position(params.endLine - 1, endLine.text.length);
            const selection = new vscode.Selection(startPos, endPos);
            const selectedText = document.getText(selection);

            if (!selectedText.trim()) {
                throw new Error(
                    'The selected lines do not contain any code. ' +
                    'Please retry with valid line numbers that contain Rust code.'
                );
            }

            // Analyze the selected code
            const analyzer = new RustCodeAnalyzer(document, this.rustAnalyzer);
            const analysisResult = await analyzer.analyzeSelection(selection, selectedText);

            // Determine module path
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                throw new Error('No workspace folder found. Please open a Rust project workspace.');
            }

            const config = vscode.workspace.getConfiguration('rustyRefactor');
            const defaultPath = config.get<string>('defaultModulePath', 'src');
            const modulePath = params.modulePath || `${defaultPath}/${params.moduleName}.rs`;

            // Extract the module
            const extractor = new ModuleExtractor(
                document,
                analysisResult,
                params.moduleName,
                modulePath,
                this.rustAnalyzer
            );

            await extractor.extract();

            // Build success message
            const publicItems = [
                ...analysisResult.functions.filter(f => f.isPublic).map(f => f.name),
                ...analysisResult.structs.filter(s => s.isPublic).map(s => s.name),
                ...analysisResult.enums.filter(e => e.isPublic).map(e => e.name),
                ...analysisResult.traits.filter(t => t.isPublic).map(t => t.name),
            ];

            let resultMessage = `Successfully extracted code to module '${params.moduleName}' at ${modulePath}\n\n`;
            resultMessage += `**Extracted items:**\n`;
            
            if (analysisResult.functions.length > 0) {
                resultMessage += `- ${analysisResult.functions.length} function(s)\n`;
            }
            if (analysisResult.structs.length > 0) {
                resultMessage += `- ${analysisResult.structs.length} struct(s)\n`;
            }
            if (analysisResult.enums.length > 0) {
                resultMessage += `- ${analysisResult.enums.length} enum(s)\n`;
            }
            if (analysisResult.traits.length > 0) {
                resultMessage += `- ${analysisResult.traits.length} trait(s)\n`;
            }
            if (analysisResult.isInsideImpl && analysisResult.implContext) {
                const impl = analysisResult.implContext;
                resultMessage += `- impl block for ${impl.targetType}`;
                if (impl.traitName) {
                    resultMessage += ` (${impl.traitName})`;
                }
                resultMessage += `\n`;
            }

            if (publicItems.length > 0) {
                resultMessage += `\n**Public exports:** ${publicItems.join(', ')}`;
            }

            resultMessage += `\n\nThe module has been registered in the parent module and can be accessed as \`${params.moduleName}::*\`.`;

            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(resultMessage)
            ]);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            throw new Error(
                `Failed to extract module: ${errorMessage}\n\n` +
                'Please check the file path, line numbers, and module name are correct and try again.'
            );
        }
    }
}

/**
 * Language model tool for analyzing Rust code
 */
export class AnalyzeRustCodeTool implements vscode.LanguageModelTool<IAnalyzeRustCodeParameters> {
    constructor(private rustAnalyzer: RustAnalyzerIntegration) {}

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<IAnalyzeRustCodeParameters>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const params = options.input;
        const fileName = path.basename(params.filePath);

        const confirmationMessages = {
            title: 'Analyze Rust code',
            message: new vscode.MarkdownString(
                `Analyze code in **${fileName}** (lines ${params.startLine}-${params.endLine})?`
            ),
        };

        return {
            invocationMessage: 'Analyzing Rust code...',
            confirmationMessages,
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<IAnalyzeRustCodeParameters>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const params = options.input;

        try {
            // Open the document
            const uri = vscode.Uri.file(params.filePath);
            const document = await vscode.workspace.openTextDocument(uri);

            if (document.languageId !== 'rust') {
                throw new Error(
                    `File ${params.filePath} is not a Rust file. ` +
                    'Please retry with a Rust source file (.rs extension).'
                );
            }

            // Create selection from line numbers
            const startPos = new vscode.Position(params.startLine - 1, 0);
            const endLine = document.lineAt(params.endLine - 1);
            const endPos = new vscode.Position(params.endLine - 1, endLine.text.length);
            const selection = new vscode.Selection(startPos, endPos);
            const selectedText = document.getText(selection);

            if (!selectedText.trim()) {
                throw new Error(
                    'The selected lines do not contain any code. ' +
                    'Please retry with valid line numbers that contain Rust code.'
                );
            }

            // Analyze the selected code
            const analyzer = new RustCodeAnalyzer(document, this.rustAnalyzer);
            const analysisResult = await analyzer.analyzeSelection(selection, selectedText);

            // Build analysis report
            let report = `**Rust Code Analysis Report**\n\n`;
            report += `**File:** ${path.basename(params.filePath)}\n`;
            report += `**Lines:** ${params.startLine}-${params.endLine}\n\n`;

            // Functions
            if (analysisResult.functions.length > 0) {
                report += `**Functions (${analysisResult.functions.length}):**\n`;
                analysisResult.functions.forEach(func => {
                    report += `- \`${func.name}\``;
                    if (func.isPublic) report += ' (public)';
                    if (func.hasGenerics) report += ' (generic)';
                    report += '\n';
                });
                report += '\n';
            }

            // Structs
            if (analysisResult.structs.length > 0) {
                report += `**Structs (${analysisResult.structs.length}):**\n`;
                analysisResult.structs.forEach(struct => {
                    report += `- \`${struct.name}\``;
                    if (struct.isPublic) report += ' (public)';
                    if (struct.hasGenerics) report += ' (generic)';
                    report += ` - ${struct.fields.length} field(s)`;
                    report += '\n';
                });
                report += '\n';
            }

            // Enums
            if (analysisResult.enums.length > 0) {
                report += `**Enums (${analysisResult.enums.length}):**\n`;
                analysisResult.enums.forEach(enumDef => {
                    report += `- \`${enumDef.name}\``;
                    if (enumDef.isPublic) report += ' (public)';
                    if (enumDef.hasGenerics) report += ' (generic)';
                    report += ` - ${enumDef.variants.length} variant(s)`;
                    report += '\n';
                });
                report += '\n';
            }

            // Traits
            if (analysisResult.traits.length > 0) {
                report += `**Traits (${analysisResult.traits.length}):**\n`;
                analysisResult.traits.forEach(trait => {
                    report += `- \`${trait.name}\``;
                    if (trait.isPublic) report += ' (public)';
                    if (trait.hasGenerics) report += ' (generic)';
                    report += '\n';
                });
                report += '\n';
            }

            // Implementations
            if (analysisResult.implementations.length > 0) {
                report += `**Implementations (${analysisResult.implementations.length}):**\n`;
                analysisResult.implementations.forEach(impl => {
                    if (impl.traitName) {
                        report += `- impl ${impl.traitName} for ${impl.targetType}`;
                    } else {
                        report += `- impl ${impl.targetType}`;
                    }
                    report += ` - ${impl.methods.length} method(s)`;
                    report += '\n';
                });
                report += '\n';
            }

            // Context information
            if (analysisResult.isInsideImpl && analysisResult.implContext) {
                const impl = analysisResult.implContext;
                report += `**Context:** Inside impl block for \`${impl.targetType}\``;
                if (impl.traitName) {
                    report += ` (implementing \`${impl.traitName}\`)`;
                }
                report += '\n\n';
            }

            // Dependencies
            if (analysisResult.usedTypes.size > 0) {
                report += `**Used Types:** ${Array.from(analysisResult.usedTypes).join(', ')}\n\n`;
            }

            if (analysisResult.usedTraits.size > 0) {
                report += `**Used Traits:** ${Array.from(analysisResult.usedTraits).join(', ')}\n\n`;
            }

            // Imports
            if (analysisResult.imports.length > 0) {
                report += `**Imports (${analysisResult.imports.length}):**\n`;
                analysisResult.imports.forEach(imp => {
                    report += `- \`use ${imp};\`\n`;
                });
                report += '\n';
            }

            // Visibility
            report += `**Overall Visibility:** ${analysisResult.visibility}\n`;

            // Generic info
            if (analysisResult.hasGenericParams) {
                report += `**Contains Generic Parameters:** Yes\n`;
            }

            report += `\n**Recommendation:** `;
            if (analysisResult.functions.length > 0 || analysisResult.structs.length > 0 || 
                analysisResult.enums.length > 0 || analysisResult.traits.length > 0) {
                report += `This code can be extracted to a separate module using the \`extract_to_module\` tool.`;
            } else {
                report += `This code may not be suitable for module extraction.`;
            }

            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(report)
            ]);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            throw new Error(
                `Failed to analyze code: ${errorMessage}\n\n` +
                'Please check the file path and line numbers are correct and try again.'
            );
        }
    }
}

/**
 * Register all language model tools for the Rusty Refactor extension
 */
export function registerLanguageModelTools(
    context: vscode.ExtensionContext,
    rustAnalyzer: RustAnalyzerIntegration
): void {
    // Register extract to module tool
    context.subscriptions.push(
        vscode.lm.registerTool(
            'rustyRefactor_extract_to_module',
            new ExtractToModuleTool(rustAnalyzer)
        )
    );

    // Register analyze code tool
    context.subscriptions.push(
        vscode.lm.registerTool(
            'rustyRefactor_analyze_rust_code',
            new AnalyzeRustCodeTool(rustAnalyzer)
        )
    );

    console.log('Rusty Refactor language model tools registered');
}
