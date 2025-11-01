/**
 * Handles all regex-based parsing of Rust code elements.
 * Single Responsibility: Extract and parse functions, structs, enums, traits, and implementations.
 */

import { FunctionInfo, StructInfo, FieldInfo, EnumInfo, TraitInfo, ImplementationInfo } from './analyzer';

export class RustCodeParser {
    /**
     * Parse function definitions from code
     */
    parseFunctions(code: string): FunctionInfo[] {
        const functions: FunctionInfo[] = [];
        const functionRegex = /(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+(\w+)\s*(<[^>]+>)?\s*\([^)]*\)(?:\s*->\s*[^{]+)?/g;

        let match;
        while ((match = functionRegex.exec(code)) !== null) {
            functions.push({
                name: match[1],
                signature: match[0],
                isPublic: match[0].trim().startsWith('pub'),
                hasGenerics: !!match[2],
                usedExternalTypes: this.extractTypesFromSignature(match[0])
            });
        }

        return functions;
    }

    /**
     * Parse struct definitions from code
     */
    parseStructs(code: string): StructInfo[] {
        const structs: StructInfo[] = [];
        const structRegex = /(?:pub(?:\([^)]*\))?\s+)?struct\s+(\w+)\s*(<[^>]+>)?\s*\{([^}]*)\}/g;

        let match;
        while ((match = structRegex.exec(code)) !== null) {
            structs.push({
                name: match[1],
                isPublic: match[0].trim().startsWith('pub'),
                hasGenerics: !!match[2],
                fields: this.parseFields(match[3])
            });
        }

        return structs;
    }

    /**
     * Parse struct fields from field text
     */
    parseFields(fieldsText: string): FieldInfo[] {
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

    /**
     * Parse enum definitions from code
     */
    parseEnums(code: string): EnumInfo[] {
        const enums: EnumInfo[] = [];
        const enumRegex = /(?:pub(?:\([^)]*\))?\s+)?enum\s+(\w+)\s*(<[^>]+>)?\s*\{([^}]*)\}/g;

        let match;
        while ((match = enumRegex.exec(code)) !== null) {
            const variants = match[3]
                .split(',')
                .map(v => v.trim().split(/[\s({]/)[0])
                .filter(v => v);

            enums.push({
                name: match[1],
                isPublic: match[0].trim().startsWith('pub'),
                hasGenerics: !!match[2],
                variants
            });
        }

        return enums;
    }

    /**
     * Parse trait definitions from code
     */
    parseTraits(code: string): TraitInfo[] {
        const traits: TraitInfo[] = [];
        const traitRegex = /(?:pub(?:\([^)]*\))?\s+)?trait\s+(\w+)\s*(<[^>]+>)?/g;

        let match;
        while ((match = traitRegex.exec(code)) !== null) {
            traits.push({
                name: match[1],
                isPublic: match[0].trim().startsWith('pub'),
                hasGenerics: !!match[2]
            });
        }

        return traits;
    }

    /**
     * Parse impl blocks and extract methods
     */
    parseImplementations(code: string): ImplementationInfo[] {
        const implementations: ImplementationInfo[] = [];
        const implRegex = /impl\s*(?:<[^>]+>)?\s*(?:(\w+)\s+for\s+)?(\w+)\s*(?:<[^>]+>)?\s*\{/g;

        let match;
        while ((match = implRegex.exec(code)) !== null) {
            const implStart = match.index;
            const implBlock = this.extractBlock(code, implStart);
            const methods = this.parseFunctions(implBlock);

            implementations.push({
                targetType: match[2],
                traitName: match[1],
                methods
            });
        }

        return implementations;
    }

    /**
     * Extract a block of code from opening brace to closing brace
     */
    extractBlock(code: string, startIndex: number): string {
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

    /**
     * Extract import statements from code
     */
    extractImports(code: string): string[] {
        const imports: string[] = [];
        const importRegex = /use\s+([^;]+);/g;

        let match;
        while ((match = importRegex.exec(code)) !== null) {
            imports.push(match[1].trim());
        }

        return imports;
    }

    /**
     * Extract types from a function signature
     */
    extractTypesFromSignature(signature: string): string[] {
        const types: string[] = [];
        const typeRegex = /([A-Z]\w+)(?:<[^>]+>)?/g;

        let match;
        while ((match = typeRegex.exec(signature)) !== null) {
            types.push(match[1]);
        }

        return types;
    }
}
