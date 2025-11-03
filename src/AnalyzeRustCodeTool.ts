import * as path from 'path';
import * as vscode from 'vscode';
import { RustCodeAnalyzer } from './analyzer';
import { IAnalyzeRustCodeParameters } from './IAnalyzeRustCodeParameters';
import { RustAnalyzerIntegration } from './rustAnalyzerIntegration';

/**
 * Language model tool for analyzing Rust code
 */

export class AnalyzeRustCodeTool implements vscode.LanguageModelTool<IAnalyzeRustCodeParameters> {
    constructor(private rustAnalyzer: RustAnalyzerIntegration) { }

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

            // Build structured analysis data
            const functionList = analysisResult.functions.map(f => ({
                name: f.name,
                visibility: f.isPublic ? 'public' : 'private',
                has_generics: f.hasGenerics
            }));
            
            const structList = analysisResult.structs.map(s => ({
                name: s.name,
                visibility: s.isPublic ? 'public' : 'private',
                field_count: s.fields.length,
                has_generics: s.hasGenerics
            }));
            
            const enumList = analysisResult.enums.map(e => ({
                name: e.name,
                visibility: e.isPublic ? 'public' : 'private',
                variant_count: e.variants.length,
                has_generics: e.hasGenerics
            }));

            const structuredAnalysis = {
                file: path.basename(params.filePath),
                lines: { start: params.startLine, end: params.endLine },
                functions: functionList,
                structs: structList,
                enums: enumList,
                traits: analysisResult.traits.map(t => t.name),
                implementations: analysisResult.implementations.map(impl => ({
                    target: impl.targetType,
                    trait: impl.traitName || null,
                    method_count: impl.methods.length
                })),
                dependencies: {
                    used_types: Array.from(analysisResult.usedTypes),
                    used_traits: Array.from(analysisResult.usedTraits),
                    imports: analysisResult.imports
                },
                context: analysisResult.isInsideImpl && analysisResult.implContext ? {
                    inside_impl: true,
                    target_type: analysisResult.implContext.targetType,
                    trait_name: analysisResult.implContext.traitName
                } : null,
                extractable: (analysisResult.functions.length + analysisResult.structs.length + 
                             analysisResult.enums.length + analysisResult.traits.length) > 0,
                recommended_action: null as string | null
            };

            // Determine recommendation
            if (structuredAnalysis.extractable) {
                const allSymbols = [...functionList.map(f => f.name), ...structList.map(s => s.name), 
                                    ...enumList.map(e => e.name), ...analysisResult.traits.map(t => t.name)];
                structuredAnalysis.recommended_action = `extract_to_module with functionName: "${allSymbols[0]}" for symbol-based extraction`;
            }

            // Build analysis report
            let report = `**Rust Code Analysis**\n\n`;
            report += `**File:** ${path.basename(params.filePath)} (lines ${params.startLine}-${params.endLine})\n\n`;

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
            if (structuredAnalysis.extractable) {
                const symbolNames = [...functionList.map(f => f.name), ...structList.map(s => s.name), 
                                     ...enumList.map(e => e.name), ...analysisResult.traits.map(t => t.name)];
                report += `✓ Ready for extraction!\n`;
                report += `**Available symbols:** ${symbolNames.join(', ')}\n`;
                report += `**Next step:** Use \`extract_to_module\` with \`functionName: "${symbolNames[0]}"\` for reliable symbol-based extraction\n`;
            } else {
                report += `⚠ No extractable items found (no functions, structs, enums, or traits)`;
            }

            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`${report}\n\n**Structured Analysis Data:**\n\`\`\`json\n${JSON.stringify(structuredAnalysis, null, 2)}\n\`\`\``)
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
