import * as vscode from 'vscode';
import { RustAnalyzerIntegration } from './rustAnalyzerIntegration';
import { AnalyzeRustCodeTool } from './AnalyzeRustCodeTool';
import { ExtractToModuleTool } from './ExtractToModuleTool';
import { RefactorFileTool } from './RefactorFileTool';
import { SrpRefactorTool } from './SrpRefactorTool';

export const RUSTY_REFACTOR_LM_TOOL_IDS = {
    srpRefactor: 'rustyRefactor_srp_refactor',
    refactorFile: 'rustyRefactor_refactor_file',
    extractToModule: 'rustyRefactor_extract_to_module',
    analyzeRustCode: 'rustyRefactor_analyze_rust_code'
} as const;

export interface LanguageModelToolRegistrationSummary {
    registered: string[];
    failed: Array<{ id: string; error: string }>;
}

/**
 * Register all language model tools for the Rusty Refactor extension
 */
export function registerLanguageModelTools(
    context: vscode.ExtensionContext,
    rustAnalyzer: RustAnalyzerIntegration
): LanguageModelToolRegistrationSummary {
    const outputChannel = (global as any).rustyRefactorOutputChannel as vscode.OutputChannel | undefined;

    const toolDefinitions: Array<{ id: string; label: string; factory: () => vscode.LanguageModelTool<any> }> = [
        // Preferred primary flow first: whole-file SRP refactor
        { id: RUSTY_REFACTOR_LM_TOOL_IDS.srpRefactor, label: 'srp_refactor', factory: () => new SrpRefactorTool(rustAnalyzer) },
        // High-level Rust file orchestration
        { id: RUSTY_REFACTOR_LM_TOOL_IDS.refactorFile, label: 'refactor_file', factory: () => new RefactorFileTool(rustAnalyzer) },
        // Focused extraction primitive
        { id: RUSTY_REFACTOR_LM_TOOL_IDS.extractToModule, label: 'extract_to_module', factory: () => new ExtractToModuleTool(rustAnalyzer) },
        // Analysis primitive
        { id: RUSTY_REFACTOR_LM_TOOL_IDS.analyzeRustCode, label: 'analyze_rust_code', factory: () => new AnalyzeRustCodeTool(rustAnalyzer) },
    ];

    const registered: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const tool of toolDefinitions) {
        try {
            context.subscriptions.push(vscode.lm.registerTool(tool.id, tool.factory()));
            registered.push(tool.label);
            outputChannel?.appendLine(`[LM Tools] Registered: ${tool.id}`);
        } catch (error) {
            // Keep partial tool registration resilient if a single tool fails,
            // but do not hide failures from diagnostics.
            const errorMessage = error instanceof Error ? error.message : String(error);
            failed.push({ id: tool.id, error: errorMessage });
            outputChannel?.appendLine(`[LM Tools] Failed to register ${tool.id}: ${errorMessage}`);
            console.error(`[Rusty Refactor] Failed to register LM tool ${tool.id}:`, error);
        }
    }

    outputChannel?.appendLine(`[LM Tools] Registration summary: ${registered.length} registered, ${failed.length} failed`);

    return { registered, failed };
}
