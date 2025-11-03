import * as vscode from 'vscode';
import { RustAnalyzerIntegration } from './rustAnalyzerIntegration';
import { AnalyzeRustCodeTool } from './AnalyzeRustCodeTool';
import { ExtractToModuleTool } from './ExtractToModuleTool';
import { suggestImportsForTypes, findBestImport } from './nativeBridge';

/**
 * High-level orchestration tool that refactors an entire Rust file.
 * 
 * This tool automatically:
 * 1. Analyzes the file to discover extractable symbols
 * 2. Extracts each symbol to appropriate modules based on conventions
 * 3. Suggests missing imports
 * 4. Returns a complete refactoring plan
 * 
 * LLM doesn't need to do ANY work - just call this tool!
 */

interface IRefactorFileParameters {
    /**
     * The absolute path to the Rust file to refactor
     */
    filePath: string;

    /**
     * Optional: Target directory for extracted modules (defaults to RustyRoad conventions)
     * Examples: "src/models", "src/services", "src/controllers"
     */
    targetDirectory?: string;

    /**
     * Optional: Specific symbols to extract (if empty, extracts all public items)
     */
    symbolsToExtract?: string[];

    /**
     * Optional: Whether to auto-fix missing imports (default: true)
     */
    autoFixImports?: boolean;
}

interface RefactoringStep {
    step_number: number;
    action: 'analyze' | 'extract' | 'import';
    description: string;
    symbol_name?: string;
    module_name?: string;
    module_path?: string;
    status: 'pending' | 'complete' | 'failed';
    result?: any;
    error?: string;
}

interface RefactoringResult {
    success: boolean;
    file_path: string;
    total_steps: number;
    completed_steps: number;
    steps: RefactoringStep[];
    extracted_modules: {
        module_name: string;
        module_path: string;
        symbols: string[];
    }[];
    missing_imports: string[];
    suggested_imports: {
        type_name: string;
        import_path: string;
        confidence: number;
    }[];
    summary: string;
}

export class RefactorFileTool implements vscode.LanguageModelTool<IRefactorFileParameters> {
    private analyzeTool: AnalyzeRustCodeTool;
    private extractTool: ExtractToModuleTool;

    constructor(private rustAnalyzer: RustAnalyzerIntegration) {
        this.analyzeTool = new AnalyzeRustCodeTool(rustAnalyzer);
        this.extractTool = new ExtractToModuleTool(rustAnalyzer);
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<IRefactorFileParameters>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const params = options.input;
        const fileName = params.filePath.split(/[\\/]/).pop() || 'file';

        const confirmationMessages = {
            title: 'Refactor Rust File',
            message: new vscode.MarkdownString(
                `Automatically refactor **${fileName}**?\n\n` +
                `This will:\n` +
                `- Analyze all symbols in the file\n` +
                `- Extract symbols to appropriate modules\n` +
                `- Suggest and fix missing imports\n` +
                `- Follow RustyRoad conventions (models/, services/, etc.)\n\n` +
                `${params.targetDirectory ? `**Target:** ${params.targetDirectory}\n` : ''}` +
                `${params.symbolsToExtract?.length ? `**Extract only:** ${params.symbolsToExtract.join(', ')}\n` : '**Extract:** All public symbols\n'}`
            ),
        };

        return {
            invocationMessage: `Refactoring ${fileName}...`,
            confirmationMessages,
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<IRefactorFileParameters>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const params = options.input;
        const steps: RefactoringStep[] = [];
        const extractedModules: RefactoringResult['extracted_modules'] = [];

        try {
            // Step 1: Analyze the entire file
            const analyzeStep: RefactoringStep = {
                step_number: 1,
                action: 'analyze',
                description: 'Analyzing file to discover symbols',
                status: 'pending'
            };
            steps.push(analyzeStep);

            const uri = vscode.Uri.file(params.filePath);
            const document = await vscode.workspace.openTextDocument(uri);
            const lineCount = document.lineCount;

            const analyzeResult = await this.analyzeTool.invoke({
                input: {
                    filePath: params.filePath,
                    startLine: 1,
                    endLine: lineCount
                }
            } as any, _token);

            // Parse the structured analysis result
            const analysisText = analyzeResult.content[0]?.toString() || '';
            const jsonMatch = analysisText.match(/```json\n([\s\S]*?)\n```/);
            if (!jsonMatch) {
                throw new Error('Failed to parse analysis result');
            }

            const analysis = JSON.parse(jsonMatch[1]);
            analyzeStep.status = 'complete';
            analyzeStep.result = analysis;

            // Determine which symbols to extract
            const symbolsToExtract = params.symbolsToExtract || [
                ...analysis.functions.map((f: any) => f.name),
                ...analysis.structs.map((s: any) => s.name),
                ...analysis.enums.map((e: any) => e.name),
                ...analysis.traits || []
            ];

            // Step 2-N: Extract each symbol
            let stepNumber = 2;
            for (const symbolName of symbolsToExtract) {
                const extractStep: RefactoringStep = {
                    step_number: stepNumber++,
                    action: 'extract',
                    description: `Extracting symbol '${symbolName}'`,
                    symbol_name: symbolName,
                    status: 'pending'
                };
                steps.push(extractStep);

                try {
                    // Determine module path based on symbol type and conventions
                    const modulePath = this.determineModulePath(symbolName, analysis, params.targetDirectory);
                    const moduleName = this.toSnakeCase(symbolName);

                    extractStep.module_name = moduleName;
                    extractStep.module_path = modulePath;

                    // Extract the symbol
                    const extractResult = await this.extractTool.invoke({
                        input: {
                            sourceFilePath: params.filePath,
                            startLine: 1,
                            endLine: lineCount,
                            functionName: symbolName,
                            moduleName: moduleName,
                            modulePath: modulePath
                        }
                    } as any, _token);

                    extractStep.status = 'complete';
                    extractStep.result = extractResult;

                    // Track extracted module
                    const existingModule = extractedModules.find(m => m.module_path === modulePath);
                    if (existingModule) {
                        existingModule.symbols.push(symbolName);
                    } else {
                        extractedModules.push({
                            module_name: moduleName,
                            module_path: modulePath,
                            symbols: [symbolName]
                        });
                    }
                } catch (error) {
                    extractStep.status = 'failed';
                    extractStep.error = error instanceof Error ? error.message : String(error);
                }
            }

            // Step N+1: Suggest imports for any missing types
            const importStep: RefactoringStep = {
                step_number: stepNumber++,
                action: 'import',
                description: 'Analyzing and suggesting imports',
                status: 'pending'
            };
            steps.push(importStep);

            const suggestedImports: RefactoringResult['suggested_imports'] = [];
            if (params.autoFixImports !== false && analysis.dependencies?.used_types?.length > 0) {
                try {
                    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
                    const importSuggestions = await suggestImportsForTypes(
                        workspaceRoot,
                        analysis.dependencies.used_types
                    );

                    const matches = JSON.parse(importSuggestions);
                    for (const match of matches) {
                        if (match.confidence > 0.5) {
                            suggestedImports.push({
                                type_name: match.item.name,
                                import_path: match.item.full_path,
                                confidence: match.confidence
                            });
                        }
                    }

                    importStep.status = 'complete';
                    importStep.result = suggestedImports;
                } catch (error) {
                    importStep.status = 'failed';
                    importStep.error = error instanceof Error ? error.message : String(error);
                }
            } else {
                importStep.status = 'complete';
                importStep.description = 'Auto-fix imports disabled or no missing types';
            }

            // Build the final result
            const completedSteps = steps.filter(s => s.status === 'complete').length;
            const result: RefactoringResult = {
                success: steps.every(s => s.status !== 'failed'),
                file_path: params.filePath,
                total_steps: steps.length,
                completed_steps: completedSteps,
                steps: steps,
                extracted_modules: extractedModules,
                missing_imports: analysis.dependencies?.used_types || [],
                suggested_imports: suggestedImports,
                summary: this.generateSummary(steps, extractedModules, suggestedImports)
            };

            // Return structured result
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    `${result.summary}\n\n**Refactoring Result:**\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``
                )
            ]);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            
            const result: RefactoringResult = {
                success: false,
                file_path: params.filePath,
                total_steps: steps.length,
                completed_steps: steps.filter(s => s.status === 'complete').length,
                steps: steps,
                extracted_modules: extractedModules,
                missing_imports: [],
                suggested_imports: [],
                summary: `❌ Refactoring failed: ${errorMessage}`
            };

            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    `${result.summary}\n\n**Partial Result:**\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``
                )
            ]);
        }
    }

    private determineModulePath(symbolName: string, analysis: any, targetDir?: string): string {
        if (targetDir) {
            return `${targetDir}/${this.toSnakeCase(symbolName)}.rs`;
        }

        // Apply RustyRoad conventions
        // Check if it's a service (has methods, might be stateful)
        const hasImpl = analysis.implementations?.some((impl: any) => 
            impl.target === symbolName && impl.method_count > 0
        );

        // Check if it's a data model (struct with fields, no methods or simple methods)
        const isStruct = analysis.structs?.some((s: any) => s.name === symbolName);
        const isEnum = analysis.enums?.some((e: any) => e.name === symbolName);

        if (hasImpl && !isStruct) {
            return `src/services/${this.toSnakeCase(symbolName)}.rs`;
        } else if (isStruct || isEnum) {
            return `src/models/${this.toSnakeCase(symbolName)}.rs`;
        } else {
            return `src/utils/${this.toSnakeCase(symbolName)}.rs`;
        }
    }

    private toSnakeCase(str: string): string {
        return str
            .replace(/([A-Z])/g, '_$1')
            .toLowerCase()
            .replace(/^_/, '');
    }

    private generateSummary(
        steps: RefactoringStep[],
        extractedModules: RefactoringResult['extracted_modules'],
        suggestedImports: RefactoringResult['suggested_imports']
    ): string {
        const completed = steps.filter(s => s.status === 'complete').length;
        const failed = steps.filter(s => s.status === 'failed').length;

        let summary = `✓ Refactoring complete: ${completed}/${steps.length} steps successful`;
        
        if (failed > 0) {
            summary = `⚠ Refactoring partial: ${completed}/${steps.length} steps successful, ${failed} failed`;
        }

        summary += `\n\n**Extracted Modules:**\n`;
        for (const module of extractedModules) {
            summary += `- \`${module.module_path}\`: ${module.symbols.join(', ')}\n`;
        }

        if (suggestedImports.length > 0) {
            summary += `\n**Suggested Imports:**\n`;
            for (const imp of suggestedImports.slice(0, 5)) {
                summary += `- \`use ${imp.import_path};\` (${(imp.confidence * 100).toFixed(0)}% match)\n`;
            }
        }

        return summary;
    }
}
