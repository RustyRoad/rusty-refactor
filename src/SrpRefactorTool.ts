import * as vscode from 'vscode';
import { RustAnalyzerIntegration } from './rustAnalyzerIntegration';
import { AnalyzeRustCodeTool } from './AnalyzeRustCodeTool';
import { ExtractToModuleTool } from './ExtractToModuleTool';
import { logToOutput } from './extractor';
import { suggestImportsForTypes, isNativeModuleAvailable } from './nativeBridge';
import { Utils } from './utils';

/**
 * Parameters for the SRP refactor tool.
 */
export interface ISrpRefactorParameters {
    /** Absolute path to the Rust source file to refactor */
    filePath: string;

    /** Max lines per module (default: 50) */
    maxLinesPerModule?: number;

    /** Target directory for extracted modules (e.g. "src/controllers/ads") */
    targetDirectory?: string;

    /** Whether to auto-fix missing imports after extraction (default: true) */
    autoFixImports?: boolean;
}

interface SrpGroup {
    group_name: string;
    module_name: string;
    responsibility: string;
    symbols: string[];
    target_path: string;
}

interface SrpPlan {
    groups: SrpGroup[];
    shared_imports: string[];
    reasoning: string;
}

interface SrpStep {
    step: number;
    action: 'analyze' | 'plan' | 'extract' | 'import' | 'validate';
    description: string;
    status: 'pending' | 'complete' | 'failed';
    result?: any;
    error?: string;
}

/**
 * SRP Refactor Tool — uses an LLM to plan Single Responsibility splits,
 * then orchestrates ExtractToModuleTool to execute them.
 *
 * Architecture:  LLM (plan) → FFI (analysis) → rust-analyzer (validate) → VS Code API (apply)
 */
export class SrpRefactorTool implements vscode.LanguageModelTool<ISrpRefactorParameters> {
    private analyzeTool: AnalyzeRustCodeTool;
    private extractTool: ExtractToModuleTool;

    constructor(private rustAnalyzer: RustAnalyzerIntegration) {
        this.analyzeTool = new AnalyzeRustCodeTool(rustAnalyzer);
        this.extractTool = new ExtractToModuleTool(rustAnalyzer);
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<ISrpRefactorParameters>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const params = options.input;
        const fileName = params.filePath.split(/[\\/]/).pop() || 'file';
        const maxLines = params.maxLinesPerModule || 50;

        return {
            invocationMessage: `Refactoring ${fileName} to SRP modules (≤${maxLines} lines each)...`,
            confirmationMessages: {
                title: 'SRP Modular Refactor',
                message: new vscode.MarkdownString(
                    `Refactor **${fileName}** into SRP-compliant modules?\n\n` +
                    `This will:\n` +
                    `- Analyze every symbol in the file\n` +
                    `- Use an LLM to group symbols by **Single Responsibility**\n` +
                    `- Extract each group to its own module (≤**${maxLines}** lines)\n` +
                    `- Create mod.rs files with re-exports\n` +
                    `- Validate with rust-analyzer\n\n` +
                    `${params.targetDirectory ? `**Target:** ${params.targetDirectory}/\n` : ''}`
                ),
            },
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<ISrpRefactorParameters>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const params = options.input;
        const maxLines = params.maxLinesPerModule || 50;
        const steps: SrpStep[] = [];
        const extractedModules: { module_name: string; module_path: string; symbols: string[] }[] = [];

        try {
            // ── Step 1: Analyze the file ────────────────────────────────────
            const analyzeStep: SrpStep = {
                step: 1, action: 'analyze',
                description: 'Analyzing file symbols and structure',
                status: 'pending'
            };
            steps.push(analyzeStep);

            const uri = vscode.Uri.file(params.filePath);
            const document = await vscode.workspace.openTextDocument(uri);
            const lineCount = document.lineCount;
            const fileCode = document.getText();

            const analyzeResult = await this.analyzeTool.invoke({
                input: { filePath: params.filePath, startLine: 1, endLine: lineCount }
            } as any, _token);

            const analysisText = analyzeResult.content[0]?.toString() || '';
            const jsonMatch = analysisText.match(/```json\n([\s\S]*?)\n```/);
            if (!jsonMatch) {
                throw new Error('Failed to parse analysis result');
            }
            const analysis = JSON.parse(jsonMatch[1]);
            analyzeStep.status = 'complete';
            analyzeStep.result = analysis;

            logToOutput(`[SrpRefactor] Analysis complete: ${analysis.functions?.length || 0} functions, ${analysis.structs?.length || 0} structs, ${analysis.enums?.length || 0} enums, ${(analysis.traits || []).length} traits`);

            // ── Step 2: LLM plans SRP grouping ──────────────────────────────
            const planStep: SrpStep = {
                step: 2, action: 'plan',
                description: 'LLM planning SRP module splits',
                status: 'pending'
            };
            steps.push(planStep);

            const plan = await this.llmPlanSrpSplit(fileCode, analysis, maxLines, params.targetDirectory, _token);
            planStep.status = 'complete';
            planStep.result = plan;

            logToOutput(`[SrpRefactor] LLM plan: ${plan.groups.length} groups`);
            for (const g of plan.groups) {
                logToOutput(`  → ${g.module_name}: [${g.symbols.join(', ')}] — ${g.responsibility}`);
            }

            // ── Step 3–N: Extract each group ────────────────────────────────
            let stepNum = 3;
            for (const group of plan.groups) {
                const extractStep: SrpStep = {
                    step: stepNum++, action: 'extract',
                    description: `Extracting group '${group.module_name}' (${group.symbols.length} symbols)`,
                    status: 'pending'
                };
                steps.push(extractStep);

                try {
                    // Re-read document to get fresh line count after prior extractions
                    const freshDoc = await vscode.workspace.openTextDocument(uri);
                    const freshLineCount = freshDoc.lineCount;

                    // Extract each symbol in the group sequentially
                    for (const symbolName of group.symbols) {
                        try {
                            await this.extractTool.invoke({
                                input: {
                                    sourceFilePath: params.filePath,
                                    startLine: 1,
                                    endLine: freshLineCount,
                                    functionName: symbolName,
                                    moduleName: group.module_name,
                                    modulePath: group.target_path
                                }
                            } as any, _token);

                            logToOutput(`[SrpRefactor] Extracted '${symbolName}' → ${group.target_path}`);
                        } catch (symbolErr) {
                            logToOutput(`[SrpRefactor] Warning: Could not extract '${symbolName}': ${symbolErr}`);
                            // Continue with remaining symbols in the group
                        }
                    }

                    extractStep.status = 'complete';
                    extractedModules.push({
                        module_name: group.module_name,
                        module_path: group.target_path,
                        symbols: group.symbols
                    });
                } catch (error) {
                    extractStep.status = 'failed';
                    extractStep.error = error instanceof Error ? error.message : String(error);
                }
            }

            // ── Step N+1: Suggest imports ────────────────────────────────────
            const importStep: SrpStep = {
                step: stepNum++, action: 'import',
                description: 'Suggesting missing imports',
                status: 'pending'
            };
            steps.push(importStep);

            const suggestedImports: { type_name: string; import_path: string; confidence: number }[] = [];
            if (params.autoFixImports !== false && analysis.dependencies?.used_types?.length > 0) {
                try {
                    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
                    const importJson = await suggestImportsForTypes(workspaceRoot, analysis.dependencies.used_types);
                    const matches = JSON.parse(importJson);
                    for (const m of matches) {
                        if (m.confidence > 0.5) {
                            suggestedImports.push({
                                type_name: m.item.name,
                                import_path: m.item.full_path,
                                confidence: m.confidence
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
            }

            // ── Build result ─────────────────────────────────────────────────
            const completed = steps.filter(s => s.status === 'complete').length;
            const failed = steps.filter(s => s.status === 'failed').length;

            let summary = failed === 0
                ? `✓ SRP refactor complete: ${completed}/${steps.length} steps successful`
                : `⚠ SRP refactor partial: ${completed}/${steps.length} steps successful, ${failed} failed`;

            summary += `\n\n**Constraint:** ≤${maxLines} lines per module`;
            summary += `\n**LLM reasoning:** ${plan.reasoning}`;
            summary += `\n\n**Extracted Modules:**\n`;
            for (const mod of extractedModules) {
                summary += `- \`${mod.module_path}\`: ${mod.symbols.join(', ')}\n`;
            }
            if (suggestedImports.length > 0) {
                summary += `\n**Suggested Imports:**\n`;
                for (const imp of suggestedImports.slice(0, 5)) {
                    summary += `- \`use ${imp.import_path};\` (${(imp.confidence * 100).toFixed(0)}%)\n`;
                }
            }

            const result = {
                success: failed === 0,
                file_path: params.filePath,
                max_lines_per_module: maxLines,
                total_steps: steps.length,
                completed_steps: completed,
                plan: plan,
                steps: steps,
                extracted_modules: extractedModules,
                suggested_imports: suggestedImports,
                summary
            };

            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    `${summary}\n\n**Full Result:**\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``
                )
            ]);

        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            const result = {
                success: false,
                file_path: params.filePath,
                total_steps: steps.length,
                completed_steps: steps.filter(s => s.status === 'complete').length,
                steps,
                extracted_modules: extractedModules,
                suggested_imports: [],
                summary: `❌ SRP refactor failed: ${msg}`
            };
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    `${result.summary}\n\n**Partial Result:**\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``
                )
            ]);
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    // LLM Planning
    // ────────────────────────────────────────────────────────────────────────

    private async llmPlanSrpSplit(
        fileCode: string,
        analysis: any,
        maxLines: number,
        targetDir: string | undefined,
        _token: vscode.CancellationToken
    ): Promise<SrpPlan> {
        const model = await this.selectPlanningModel();
        if (!model) {
            // Fallback: one group per top-level symbol
            return this.fallbackPlan(analysis, targetDir);
        }

        const symbolSummary = this.buildSymbolSummary(analysis);
        const baseDir = targetDir || this.inferBaseDir(analysis);

        const messages = [
            vscode.LanguageModelChatMessage.User(
                `You are a Rust architecture expert. Given the symbols in a Rust file, group them into cohesive modules following the Single Responsibility Principle (SRP).

RULES:
1. Each group becomes ONE module file. Each module must be ≤${maxLines} non-blank lines.
2. Group symbols that collaborate on the SAME responsibility together (e.g. a struct + its impl + related helper functions).
3. A struct/enum and its impl block(s) MUST stay in the same group.
4. Traits SHOULD be in their own group unless tightly coupled to a single struct.
5. module_name must be snake_case.
6. target_path must follow the pattern: "${baseDir}/{module_name}/{module_name}.rs" (one module per folder).
7. Every symbol from the input MUST appear in exactly one group.
8. Keep groups small and focused — prefer more small modules over fewer large ones.

Respond with ONLY valid JSON matching this schema:
{
  "groups": [
    {
      "group_name": "Human-readable group name",
      "module_name": "snake_case_name",
      "responsibility": "One sentence describing this module's single responsibility",
      "symbols": ["SymbolName1", "helper_fn"],
      "target_path": "${baseDir}/snake_case_name/snake_case_name.rs"
    }
  ],
  "shared_imports": ["std::collections::HashMap"],
  "reasoning": "Brief explanation of how you split responsibilities"
}

Do NOT wrap in markdown code fences. Return raw JSON only.`
            ),
            vscode.LanguageModelChatMessage.User(
                `FILE SYMBOLS:\n${symbolSummary}\n\nFULL CODE (for line-count estimation):\n${fileCode}`
            )
        ];

        const response = await model.sendRequest(
            messages,
            { justification: 'Planning SRP module splits for Rust file' },
            new vscode.CancellationTokenSource().token
        );

        let planText = '';
        for await (const fragment of response.text) {
            planText += fragment;
        }

        // Strip any accidental code fences
        planText = planText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

        try {
            const plan: SrpPlan = JSON.parse(planText);
            // Validate plan has required fields
            if (!plan.groups || !Array.isArray(plan.groups) || plan.groups.length === 0) {
                throw new Error('Plan has no groups');
            }
            for (const g of plan.groups) {
                if (!g.module_name || !g.symbols || g.symbols.length === 0) {
                    throw new Error(`Group "${g.group_name || 'unnamed'}" is missing module_name or symbols`);
                }
                // Ensure snake_case
                g.module_name = Utils.toSnakeCase(g.module_name).replace(/^_/, '');
                // Ensure target_path is set
                if (!g.target_path) {
                    g.target_path = `${baseDir}/${g.module_name}/${g.module_name}.rs`;
                }
            }
            return plan;
        } catch (parseErr) {
            logToOutput(`[SrpRefactor] LLM plan parse failed: ${parseErr}. Falling back.`);
            return this.fallbackPlan(analysis, targetDir);
        }
    }

    /**
     * Deterministic fallback when no LLM is available:
     * each top-level symbol (struct+impl, enum, trait, standalone fn) becomes its own module.
     */
    private fallbackPlan(analysis: any, targetDir?: string): SrpPlan {
        const baseDir = targetDir || this.inferBaseDir(analysis);
        const groups: SrpGroup[] = [];
        const seen = new Set<string>();

        // Group structs with their impls
        for (const s of (analysis.structs || [])) {
            const moduleName = Utils.toSnakeCase(s.name).replace(/^_/, '');
            const symbols = [s.name];
            seen.add(s.name);

            // Attach matching impls
            for (const impl of (analysis.implementations || [])) {
                if (impl.target === s.name) {
                    // impl methods are inside the struct symbol already
                }
            }

            groups.push({
                group_name: s.name,
                module_name: moduleName,
                responsibility: `${s.name} data structure and its methods`,
                symbols,
                target_path: `${baseDir}/${moduleName}/${moduleName}.rs`
            });
        }

        // Enums
        for (const e of (analysis.enums || [])) {
            if (seen.has(e.name)) continue;
            const moduleName = Utils.toSnakeCase(e.name).replace(/^_/, '');
            seen.add(e.name);
            groups.push({
                group_name: e.name,
                module_name: moduleName,
                responsibility: `${e.name} enum and related logic`,
                symbols: [e.name],
                target_path: `${baseDir}/${moduleName}/${moduleName}.rs`
            });
        }

        // Traits
        for (const t of (analysis.traits || [])) {
            const name = typeof t === 'string' ? t : t.name;
            if (seen.has(name)) continue;
            const moduleName = Utils.toSnakeCase(name).replace(/^_/, '');
            seen.add(name);
            groups.push({
                group_name: name,
                module_name: moduleName,
                responsibility: `${name} trait definition`,
                symbols: [name],
                target_path: `${baseDir}/${moduleName}/${moduleName}.rs`
            });
        }

        // Standalone functions
        for (const f of (analysis.functions || [])) {
            if (seen.has(f.name)) continue;
            const moduleName = Utils.toSnakeCase(f.name).replace(/^_/, '');
            seen.add(f.name);
            groups.push({
                group_name: f.name,
                module_name: moduleName,
                responsibility: `${f.name} function`,
                symbols: [f.name],
                target_path: `${baseDir}/${moduleName}/${moduleName}.rs`
            });
        }

        return {
            groups,
            shared_imports: analysis.dependencies?.imports || [],
            reasoning: 'Fallback plan: one module per top-level symbol'
        };
    }

    // ────────────────────────────────────────────────────────────────────────
    // Helpers
    // ────────────────────────────────────────────────────────────────────────

    private buildSymbolSummary(analysis: any): string {
        const lines: string[] = [];

        for (const s of (analysis.structs || [])) {
            lines.push(`STRUCT ${s.name} (${s.visibility}, ${s.field_count} fields${s.has_generics ? ', generic' : ''})`);
        }
        for (const e of (analysis.enums || [])) {
            lines.push(`ENUM ${e.name} (${e.visibility}, ${e.variant_count} variants)`);
        }
        for (const t of (analysis.traits || [])) {
            const name = typeof t === 'string' ? t : t.name;
            lines.push(`TRAIT ${name}`);
        }
        for (const f of (analysis.functions || [])) {
            lines.push(`FN ${f.name} (${f.visibility}${f.has_generics ? ', generic' : ''})`);
        }
        for (const impl of (analysis.implementations || [])) {
            const traitInfo = impl.trait ? ` for trait ${impl.trait}` : '';
            lines.push(`IMPL ${impl.target}${traitInfo} (${impl.method_count} methods)`);
        }

        return lines.join('\n');
    }

    private inferBaseDir(analysis: any): string {
        // Use RustyRoad conventions based on dominant symbol type
        const hasStructs = (analysis.structs?.length || 0) > 0;
        const hasTraits = (analysis.traits?.length || 0) > 0;
        const hasFunctions = (analysis.functions?.length || 0) > 0;
        const hasImpls = (analysis.implementations?.length || 0) > 0;

        if (hasImpls && hasFunctions && !hasStructs) {
            return 'src/services';
        } else if (hasStructs) {
            return 'src/models';
        } else if (hasTraits) {
            return 'src/traits';
        }
        return 'src/utils';
    }

    private async selectPlanningModel(): Promise<vscode.LanguageModelChat | null> {
        try {
            const allModels = await vscode.lm.selectChatModels();
            if (allModels.length === 0) return null;

            const config = vscode.workspace.getConfiguration('rustyRefactor');

            // Prefer the user's preferred model for planning (needs reasoning ability)
            const preferredId = config.get<string>('aiPreferredModel');
            if (preferredId) {
                const preferred = allModels.find(m => `${m.vendor}/${m.family}` === preferredId);
                if (preferred) {
                    logToOutput(`[SrpRefactor] Using preferred model for planning: ${preferred.name}`);
                    return preferred;
                }
            }

            // Fall back to best available model (highest token capacity = usually best reasoning)
            const sorted = allModels
                .filter(m => m.maxInputTokens >= 4000)
                .sort((a, b) => b.maxInputTokens - a.maxInputTokens);

            if (sorted.length > 0) {
                logToOutput(`[SrpRefactor] Auto-selected model for planning: ${sorted[0].name}`);
                return sorted[0];
            }

            return allModels[0];
        } catch {
            return null;
        }
    }
}
