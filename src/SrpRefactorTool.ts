import * as path from 'path';
import * as vscode from 'vscode';
import { RustAnalyzerIntegration } from './rustAnalyzerIntegration';
import { AnalyzeRustCodeTool } from './AnalyzeRustCodeTool';
import { ExtractToModuleTool } from './ExtractToModuleTool';
import { logToOutput } from './extractor';
import { suggestImportsForTypes } from './nativeBridge';
import { Utils } from './utils';

/**
 * Parameters for the SRP refactor tool.
 * - Rust: LLM plan + Rust analyzers + native-assisted suggestions + extractor tool
 * - TypeScript: LLM plan + VS Code symbol provider + WorkspaceEdit extraction
 */

export * from './modules/srp_interfaces/srp_interfaces';
export * from './modules/srp_refactor_tool/srp_refactor_tool';
