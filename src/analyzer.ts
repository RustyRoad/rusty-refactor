import * as vscode from 'vscode';
import { RustAnalyzerIntegration } from './rustAnalyzerIntegration';
import { SymbolExpander } from './symbolExpander';
import { RustCodeParser } from './rustCodeParser';
import { CodeAnalyzer } from './codeAnalyzer';
import { ImplContextDetector } from './implContextDetector';

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
        // Get complete code by expanding to symbol boundaries
        const completeCode = await this.symbolExpander.getCompleteSymbolsAtSelection(selection);
        const codeToAnalyze = completeCode || selectedText;

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

        // Check if selection is inside an impl block
        const implContext = await this.implContextDetector.detectImplContext(selection);
        if (implContext) {
            result.isInsideImpl = true;
            result.implContext = implContext;
        }

        // Parse all code elements
        result.functions = this.parser.parseFunctions(codeToAnalyze);
        result.structs = this.parser.parseStructs(codeToAnalyze);
        result.enums = this.parser.parseEnums(codeToAnalyze);
        result.traits = this.parser.parseTraits(codeToAnalyze);
        result.implementations = this.parser.parseImplementations(codeToAnalyze);
        result.imports = this.parser.extractImports(codeToAnalyze);

        // Analyze code properties
        result.usedTypes = this.codeAnalyzer.detectUsedTypes(codeToAnalyze, result);
        result.usedTraits = this.codeAnalyzer.detectUsedTraits(codeToAnalyze);
        result.hasGenericParams = this.codeAnalyzer.hasGenerics(codeToAnalyze);
        result.visibility = this.codeAnalyzer.determineVisibility(codeToAnalyze);

        // Get additional info from rust-analyzer if available
        const config = vscode.workspace.getConfiguration('rustyRefactor');
        if (config.get<boolean>('integrationWithRustAnalyzer', true)) {
            await this.enrichWithRustAnalyzer(result, selection);
        }

        return result;
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
