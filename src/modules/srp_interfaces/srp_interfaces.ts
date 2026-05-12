// Shared SRP refactor types
import * as vscode from 'vscode';

export interface ISrpRefactorParameters {
    /** Absolute path to the source file to refactor */
    filePath: string;

    /** Max lines per module (default: 50) */
    maxLinesPerModule?: number;

    /** Target directory for extracted modules */
    targetDirectory?: string;

    /** Whether to auto-fix missing imports after extraction (default: true) */
    autoFixImports?: boolean;
}

export interface SrpGroup {
    group_name: string;
    module_name: string;
    responsibility: string;
    symbols: string[];
    target_path: string;
}

export interface SrpPlan {
    groups: SrpGroup[];
    shared_imports: string[];
    reasoning: string;
}

export interface SrpStep {
    step: number;
    action: 'analyze' | 'plan' | 'extract' | 'import' | 'validate';
    description: string;
    status: 'pending' | 'complete' | 'failed';
    result?: any;
    error?: string;
}

export interface TsTopLevelSymbol {
    name: string;
    kind: string;
    range: vscode.Range;
    text: string;
}
