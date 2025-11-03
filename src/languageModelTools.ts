import * as vscode from 'vscode';
import { RustAnalyzerIntegration } from './rustAnalyzerIntegration';
import { AnalyzeRustCodeTool } from './AnalyzeRustCodeTool';
import { ExtractToModuleTool } from './ExtractToModuleTool';
import { RefactorFileTool } from './RefactorFileTool';

/**
 * Register all language model tools for the Rusty Refactor extension
 */
export function registerLanguageModelTools(
    context: vscode.ExtensionContext,
    rustAnalyzer: RustAnalyzerIntegration
): void {
    // Register high-level orchestration tool (runs everything in sequence)
    context.subscriptions.push(
        vscode.lm.registerTool(
            'rustyRefactor_refactor_file',
            new RefactorFileTool(rustAnalyzer)
        )
    );

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

    console.log('Rusty Refactor language model tools registered (3 tools: refactor_file, extract_to_module, analyze_rust_code)');
}
