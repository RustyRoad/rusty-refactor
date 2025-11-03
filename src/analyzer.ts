import * as vscode from 'vscode';
import { RustAnalyzerIntegration } from './rustAnalyzerIntegration';
import { SymbolExpander } from './symbolExpander';
import { RustCodeParser } from './rustCodeParser';
import { CodeAnalyzer } from './codeAnalyzer';
import { ImplContextDetector } from './implContextDetector';
import { getCachedAnalysis, cacheAnalysis, getCacheStats } from './nativeBridge';
import * as crypto from 'crypto';

export interface AnalysisResult {
    selectedCode: string;
    usedTypes: Set<string>;
    usedTraits: Set<string>;
    functions: FunctionInfo[];
    structs: StructInfo[];
    enums: EnumInfo[];
    traits: TraitInfo[];
    implementations: ImplementationInfo[];
    imports: string[];
    visibility: 'pub' | 'pub(crate)' | 'private';
    hasGenericParams: boolean;
    dependencies: Set<string>;
    isInsideImpl: boolean;
    implContext?: ImplementationInfo;
}

export interface FunctionInfo {
    name: string;
    signature: string;
    isPublic: boolean;
    hasGenerics: boolean;
    usedExternalTypes: string[];
}

export interface StructInfo {
    name: string;
    isPublic: boolean;
    hasGenerics: boolean;
    fields: FieldInfo[];
}

export interface FieldInfo {
    name: string;
    type: string;
    isPublic: boolean;
}

export interface EnumInfo {
    name: string;
    isPublic: boolean;
    hasGenerics: boolean;
    variants: string[];
}

export interface TraitInfo {
    name: string;
    isPublic: boolean;
    hasGenerics: boolean;
}

export interface ImplementationInfo {
    targetType: string;
    traitName?: string;
    methods: FunctionInfo[];
}

export class RustCodeAnalyzer {
    private symbolExpander: SymbolExpander;
    private parser: RustCodeParser;
    private codeAnalyzer: CodeAnalyzer;
    private implContextDetector: ImplContextDetector;

    constructor(
        private document: vscode.TextDocument,
        private rustAnalyzer: RustAnalyzerIntegration
    ) {
        this.symbolExpander = new SymbolExpander(document);
        this.parser = new RustCodeParser();
        this.codeAnalyzer = new CodeAnalyzer();
        this.implContextDetector = new ImplContextDetector(document);
    }

    async analyzeSelection(selection: vscode.Selection, selectedText: string): Promise<AnalysisResult> {
        const logToOutput = (message: string) => {
            const timestamp = new Date().toISOString();
            console.log(`[RustCodeAnalyzer] ${timestamp} - ${message}`);
            // Also try to log to VS Code output channel if available
            const outputChannel = (global as any).rustyRefactorOutputChannel;
            if (outputChannel) {
                outputChannel.appendLine(`[${timestamp}] [RustCodeAnalyzer] ${message}`);
            }
        };

        logToOutput(`Starting analysis for selection at line ${selection.start.line}-${selection.end.line}`);
        logToOutput(`Selected text length: ${selectedText.length} characters`);

        // Check cache first
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            try {
                const cacheKey = this.getCacheKey(this.document.uri.fsPath, selectedText);
                const cachedResult = await getCachedAnalysis(workspaceFolder.uri.fsPath, cacheKey);
                if (cachedResult) {
                    logToOutput(`⚡ Cache HIT! Using cached analysis`);
                    // Get stats to log hit rate
                    const stats = await getCacheStats(workspaceFolder.uri.fsPath);
                    logToOutput(`Cache stats: ${stats.hits} hits, ${stats.misses} misses (${(stats.hit_rate * 100).toFixed(1)}% hit rate)`);
                    return JSON.parse(cachedResult);
                }
                logToOutput(`Cache MISS - performing fresh analysis`);
            } catch (err) {
                logToOutput(`Cache error (continuing with analysis): ${err}`);
            }
        }

        // Get complete code by expanding to symbol boundaries
        logToOutput('Expanding selection to complete symbols...');
        const completeCode = await this.symbolExpander.getCompleteSymbolsAtSelection(selection);
        const codeToAnalyze = completeCode || selectedText;
        
        if (completeCode && completeCode !== selectedText) {
            logToOutput(`Selection expanded from ${selectedText.length} to ${codeToAnalyze.length} characters`);
        } else {
            logToOutput('Using original selection (no expansion needed)');
        }

        logToOutput(`Code to analyze preview: ${codeToAnalyze.substring(0, 150)}${codeToAnalyze.length > 150 ? '...' : ''}`);

        const result: AnalysisResult = {
            selectedCode: codeToAnalyze,
            usedTypes: new Set<string>(),
            usedTraits: new Set<string>(),
            functions: [],
            structs: [],
            enums: [],
            traits: [],
            implementations: [],
            imports: [],
            visibility: 'private',
            hasGenericParams: false,
            dependencies: new Set<string>(),
            isInsideImpl: false,
            implContext: undefined
        };

        try {
            // Check if selection is inside an impl block
            logToOutput('Detecting impl block context...');
            const implContext = await this.implContextDetector.detectImplContext(selection);
            if (implContext) {
                result.isInsideImpl = true;
                result.implContext = implContext;
                logToOutput(`Found impl context for target type: ${implContext.targetType}${implContext.traitName ? ` (trait: ${implContext.traitName})` : ''}`);
            } else {
                logToOutput('No impl block context detected');
            }

            // Parse all code elements
            logToOutput('Parsing functions...');
            result.functions = this.parser.parseFunctions(codeToAnalyze);
            logToOutput(`Found ${result.functions.length} functions: ${result.functions.map(f => f.name).join(', ')}`);

            logToOutput('Parsing structs...');
            result.structs = this.parser.parseStructs(codeToAnalyze);
            logToOutput(`Found ${result.structs.length} structs: ${result.structs.map(s => s.name).join(', ')}`);

            logToOutput('Parsing enums...');
            result.enums = this.parser.parseEnums(codeToAnalyze);
            logToOutput(`Found ${result.enums.length} enums: ${result.enums.map(e => e.name).join(', ')}`);

            logToOutput('Parsing traits...');
            result.traits = this.parser.parseTraits(codeToAnalyze);
            logToOutput(`Found ${result.traits.length} traits: ${result.traits.map(t => t.name).join(', ')}`);

            logToOutput('Parsing implementations...');
            result.implementations = this.parser.parseImplementations(codeToAnalyze);
            logToOutput(`Found ${result.implementations.length} implementations`);

            logToOutput('Extracting imports...');
            result.imports = this.parser.extractImports(codeToAnalyze);
            logToOutput(`Found ${result.imports.length} imports: ${result.imports.join(', ')}`);

            // Analyze code properties
            logToOutput('Detecting used types...');
            result.usedTypes = this.codeAnalyzer.detectUsedTypes(codeToAnalyze, result);
            logToOutput(`Used types: ${Array.from(result.usedTypes).join(', ')}`);

            logToOutput('Detecting used traits...');
            result.usedTraits = this.codeAnalyzer.detectUsedTraits(codeToAnalyze);
            logToOutput(`Used traits: ${Array.from(result.usedTraits).join(', ')}`);

            logToOutput('Checking for generic parameters...');
            result.hasGenericParams = this.codeAnalyzer.hasGenerics(codeToAnalyze);
            logToOutput(`Has generic parameters: ${result.hasGenericParams}`);

            logToOutput('Determining visibility...');
            result.visibility = this.codeAnalyzer.determineVisibility(codeToAnalyze);
            logToOutput(`Visibility: ${result.visibility}`);

            // Get additional info from rust-analyzer if available
            const config = vscode.workspace.getConfiguration('rustyRefactor');
            if (config.get<boolean>('integrationWithRustAnalyzer', true)) {
                logToOutput('Enriching with rust-analyzer data...');
                await this.enrichWithRustAnalyzer(result, selection);
                logToOutput('Rust-analyzer enrichment completed');
            } else {
                logToOutput('Rust-analyzer integration disabled');
            }

            logToOutput('Analysis completed successfully');
            
            // Cache the result for future use
            if (workspaceFolder) {
                try {
                    const cacheKey = this.getCacheKey(this.document.uri.fsPath, selectedText);
                    // Convert Sets to Arrays for JSON serialization
                    const serializable = {
                        ...result,
                        usedTypes: Array.from(result.usedTypes),
                        usedTraits: Array.from(result.usedTraits),
                        dependencies: Array.from(result.dependencies)
                    };
                    await cacheAnalysis(workspaceFolder.uri.fsPath, cacheKey, JSON.stringify(serializable));
                    logToOutput('✓ Analysis cached successfully');
                } catch (err) {
                    logToOutput(`Warning: Failed to cache analysis: ${err}`);
                }
            }
            
            return result;

        } catch (error) {
            logToOutput(`Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            if (error instanceof Error && error.stack) {
                logToOutput(`Error stack: ${error.stack}`);
            }
            throw error;
        }
    }

    private getCacheKey(filePath: string, code: string): string {
        // Create a cache key based on file path and code hash
        const hash = crypto.createHash('sha256');
        hash.update(filePath);
        hash.update(code);
        return hash.digest('hex');
    }

    private async enrichWithRustAnalyzer(result: AnalysisResult, selection: vscode.Selection): Promise<void> {
        // Get type information from rust-analyzer
        const typeInfo = await this.rustAnalyzer.getTypeInfo(this.document, selection);
        if (typeInfo) {
            typeInfo.forEach(type => result.usedTypes.add(type));
        }

        // Get trait information
        const traitInfo = await this.rustAnalyzer.getTraitInfo(this.document, selection);
        if (traitInfo) {
            traitInfo.forEach(trait => result.usedTraits.add(trait));
        }
    }
}
