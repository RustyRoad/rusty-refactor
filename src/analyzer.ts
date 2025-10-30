import * as vscode from 'vscode';
import { RustAnalyzerIntegration } from './rustAnalyzerIntegration';

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
    constructor(
        private document: vscode.TextDocument,
        private rustAnalyzer: RustAnalyzerIntegration
    ) {}

    async analyzeSelection(selection: vscode.Selection, selectedText: string): Promise<AnalysisResult> {
        const result: AnalysisResult = {
            selectedCode: selectedText,
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
        const implContext = await this.detectImplContext(selection);
        if (implContext) {
            result.isInsideImpl = true;
            result.implContext = implContext;
        }

        // Parse functions
        result.functions = this.parseFunctions(selectedText);
        
        // Parse structs
        result.structs = this.parseStructs(selectedText);
        
        // Parse enums
        result.enums = this.parseEnums(selectedText);
        
        // Parse traits
        result.traits = this.parseTraits(selectedText);
        
        // Parse implementations
        result.implementations = this.parseImplementations(selectedText);
        
        // Extract imports
        result.imports = this.extractImports(selectedText);
        
        // Detect used types
        result.usedTypes = this.detectUsedTypes(selectedText, result);
        
        // Detect used traits
        result.usedTraits = this.detectUsedTraits(selectedText);
        
        // Check for generics
        result.hasGenericParams = this.hasGenerics(selectedText);
        
        // Determine visibility
        result.visibility = this.determineVisibility(selectedText);
        
        // Get additional info from rust-analyzer if available
        const config = vscode.workspace.getConfiguration('rustyRefactor');
        if (config.get<boolean>('integrationWithRustAnalyzer', true)) {
            await this.enrichWithRustAnalyzer(result, selection);
        }
        
        return result;
    }

    private parseFunctions(code: string): FunctionInfo[] {
        const functions: FunctionInfo[] = [];
        const functionRegex = /(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+(\w+)\s*(<[^>]+>)?\s*\([^)]*\)(?:\s*->\s*[^{]+)?/g;
        
        let match;
        while ((match = functionRegex.exec(code)) !== null) {
            const isPublic = match[0].trim().startsWith('pub');
            const hasGenerics = !!match[2];
            const name = match[1];
            
            functions.push({
                name,
                signature: match[0],
                isPublic,
                hasGenerics,
                usedExternalTypes: this.extractTypesFromSignature(match[0])
            });
        }
        
        return functions;
    }

    private parseStructs(code: string): StructInfo[] {
        const structs: StructInfo[] = [];
        const structRegex = /(?:pub(?:\([^)]*\))?\s+)?struct\s+(\w+)\s*(<[^>]+>)?\s*\{([^}]*)\}/g;
        
        let match;
        while ((match = structRegex.exec(code)) !== null) {
            const isPublic = match[0].trim().startsWith('pub');
            const hasGenerics = !!match[2];
            const name = match[1];
            const fieldsText = match[3];
            
            structs.push({
                name,
                isPublic,
                hasGenerics,
                fields: this.parseFields(fieldsText)
            });
        }
        
        return structs;
    }

    private parseFields(fieldsText: string): FieldInfo[] {
        const fields: FieldInfo[] = [];
        const fieldLines = fieldsText.split(',').map(line => line.trim()).filter(line => line);
        
        for (const line of fieldLines) {
            const fieldMatch = line.match(/(?:(pub(?:\([^)]*\))?)\s+)?(\w+)\s*:\s*([^,]+)/);
            if (fieldMatch) {
                fields.push({
                    name: fieldMatch[2],
                    type: fieldMatch[3].trim(),
                    isPublic: !!fieldMatch[1]
                });
            }
        }
        
        return fields;
    }

    private parseEnums(code: string): EnumInfo[] {
        const enums: EnumInfo[] = [];
        const enumRegex = /(?:pub(?:\([^)]*\))?\s+)?enum\s+(\w+)\s*(<[^>]+>)?\s*\{([^}]*)\}/g;
        
        let match;
        while ((match = enumRegex.exec(code)) !== null) {
            const isPublic = match[0].trim().startsWith('pub');
            const hasGenerics = !!match[2];
            const name = match[1];
            const variantsText = match[3];
            
            const variants = variantsText
                .split(',')
                .map(v => v.trim().split(/[\s({]/)[0])
                .filter(v => v);
            
            enums.push({
                name,
                isPublic,
                hasGenerics,
                variants
            });
        }
        
        return enums;
    }

    private parseTraits(code: string): TraitInfo[] {
        const traits: TraitInfo[] = [];
        const traitRegex = /(?:pub(?:\([^)]*\))?\s+)?trait\s+(\w+)\s*(<[^>]+>)?/g;
        
        let match;
        while ((match = traitRegex.exec(code)) !== null) {
            const isPublic = match[0].trim().startsWith('pub');
            const hasGenerics = !!match[2];
            const name = match[1];
            
            traits.push({
                name,
                isPublic,
                hasGenerics
            });
        }
        
        return traits;
    }

    private parseImplementations(code: string): ImplementationInfo[] {
        const implementations: ImplementationInfo[] = [];
        const implRegex = /impl\s*(?:<[^>]+>)?\s*(?:(\w+)\s+for\s+)?(\w+)\s*(?:<[^>]+>)?\s*\{/g;
        
        let match;
        while ((match = implRegex.exec(code)) !== null) {
            const traitName = match[1];
            const targetType = match[2];
            
            // Extract methods from the impl block
            const implStart = match.index;
            const implBlock = this.extractBlock(code, implStart);
            const methods = this.parseFunctions(implBlock);
            
            implementations.push({
                targetType,
                traitName,
                methods
            });
        }
        
        return implementations;
    }

    private extractBlock(code: string, startIndex: number): string {
        let braceCount = 0;
        let inBlock = false;
        let result = '';
        
        for (let i = startIndex; i < code.length; i++) {
            const char = code[i];
            if (char === '{') {
                braceCount++;
                inBlock = true;
            } else if (char === '}') {
                braceCount--;
                if (braceCount === 0) {
                    return result;
                }
            }
            if (inBlock) {
                result += char;
            }
        }
        
        return result;
    }

    private extractImports(code: string): string[] {
        const imports: string[] = [];
        const importRegex = /use\s+([^;]+);/g;
        
        let match;
        while ((match = importRegex.exec(code)) !== null) {
            imports.push(match[1].trim());
        }
        
        return imports;
    }

    private detectUsedTypes(code: string, result: AnalysisResult): Set<string> {
        const types = new Set<string>();
        
        // Common Rust types and standard library types
        const stdTypes = ['Vec', 'String', 'HashMap', 'HashSet', 'Option', 'Result', 
                         'Box', 'Rc', 'Arc', 'Cell', 'RefCell', 'Mutex', 'RwLock'];
        
        // Extract types from function signatures, struct fields, etc.
        const typeRegex = /:\s*([A-Z]\w+(?:<[^>]+>)?)/g;
        let match;
        while ((match = typeRegex.exec(code)) !== null) {
            const typeName = match[1].split('<')[0]; // Get base type without generics
            if (!stdTypes.includes(typeName)) {
                types.add(typeName);
            }
        }
        
        // Add struct and enum names
        result.structs.forEach(s => types.add(s.name));
        result.enums.forEach(e => types.add(e.name));
        
        return types;
    }

    private detectUsedTraits(code: string): Set<string> {
        const traits = new Set<string>();
        
        // Common Rust traits
        const stdTraits = ['Clone', 'Copy', 'Debug', 'Display', 'Default', 'PartialEq', 
                          'Eq', 'PartialOrd', 'Ord', 'Hash', 'From', 'Into', 'Iterator'];
        
        // Find trait bounds in generics
        const traitBoundRegex = /<[^>]*:\s*([A-Z]\w+)/g;
        let match;
        while ((match = traitBoundRegex.exec(code)) !== null) {
            traits.add(match[1]);
        }
        
        // Find trait implementations
        const implTraitRegex = /impl\s+([A-Z]\w+)\s+for/g;
        while ((match = implTraitRegex.exec(code)) !== null) {
            traits.add(match[1]);
        }
        
        return traits;
    }

    private extractTypesFromSignature(signature: string): string[] {
        const types: string[] = [];
        const typeRegex = /([A-Z]\w+)(?:<[^>]+>)?/g;
        
        let match;
        while ((match = typeRegex.exec(signature)) !== null) {
            types.push(match[1]);
        }
        
        return types;
    }

    private hasGenerics(code: string): boolean {
        return /<[^>]+>/.test(code);
    }

    private determineVisibility(code: string): 'pub' | 'pub(crate)' | 'private' {
        if (/pub\(crate\)/.test(code)) {
            return 'pub(crate)';
        } else if (/pub\s/.test(code)) {
            return 'pub';
        }
        return 'private';
    }

    /**
     * Detect if the selection is inside an impl block and get its context
     */
    private async detectImplContext(selection: vscode.Selection): Promise<ImplementationInfo | null> {
        const fullText = this.document.getText();
        const selectionStart = this.document.offsetAt(selection.start);
        
        // Find all impl blocks in the document
        const implRegex = /impl\s*(?:<[^>]+>)?\s*(?:(\w+)\s+for\s+)?(\w+)\s*(?:<[^>]+>)?\s*\{/g;
        let match;
        
        while ((match = implRegex.exec(fullText)) !== null) {
            const implStart = match.index;
            const implBlockEnd = this.findBlockEnd(fullText, implStart);
            
            // Check if selection is within this impl block
            if (implStart < selectionStart && selectionStart < implBlockEnd) {
                const traitName = match[1];
                const targetType = match[2];
                const implBlock = fullText.substring(implStart, implBlockEnd);
                const methods = this.parseFunctions(implBlock);
                
                return {
                    targetType,
                    traitName,
                    methods
                };
            }
        }
        
        return null;
    }

    /**
     * Find the end of a block (matching closing brace)
     */
    private findBlockEnd(text: string, startIndex: number): number {
        let braceCount = 0;
        let inBlock = false;
        
        for (let i = startIndex; i < text.length; i++) {
            const char = text[i];
            if (char === '{') {
                braceCount++;
                inBlock = true;
            } else if (char === '}') {
                braceCount--;
                if (braceCount === 0 && inBlock) {
                    return i;
                }
            }
        }
        
        return text.length;
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
