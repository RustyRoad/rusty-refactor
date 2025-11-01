/**
 * Handles detection and analysis of types, traits, and code properties.
 * Single Responsibility: Extract semantic information from code.
 */

import { AnalysisResult } from './analyzer';

export class CodeAnalyzer {
    private static readonly STD_TYPES = [
        'Vec', 'String', 'HashMap', 'HashSet', 'Option', 'Result',
        'Box', 'Rc', 'Arc', 'Cell', 'RefCell', 'Mutex', 'RwLock'
    ];

    private static readonly STD_TRAITS = [
        'Clone', 'Copy', 'Debug', 'Display', 'Default', 'PartialEq',
        'Eq', 'PartialOrd', 'Ord', 'Hash', 'From', 'Into', 'Iterator'
    ];

    /**
     * Detect all used types in the code
     */
    detectUsedTypes(code: string, result: AnalysisResult): Set<string> {
        const types = new Set<string>();

        // Extract types from function signatures, struct fields, etc.
        const typeRegex = /:\s*([A-Z]\w+(?:<[^>]+>)?)/g;
        let match;

        while ((match = typeRegex.exec(code)) !== null) {
            const typeName = match[1].split('<')[0]; // Get base type without generics
            if (!CodeAnalyzer.STD_TYPES.includes(typeName)) {
                types.add(typeName);
            }
        }

        // Add struct and enum names
        result.structs.forEach(s => types.add(s.name));
        result.enums.forEach(e => types.add(e.name));

        return types;
    }

    /**
     * Detect all used traits in the code
     */
    detectUsedTraits(code: string): Set<string> {
        const traits = new Set<string>();

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

    /**
     * Check if code contains generic parameters
     */
    hasGenerics(code: string): boolean {
        return /<[^>]+>/.test(code);
    }

    /**
     * Determine the visibility level of code
     */
    determineVisibility(code: string): 'pub' | 'pub(crate)' | 'private' {
        if (/pub\(crate\)/.test(code)) {
            return 'pub(crate)';
        } else if (/pub\s/.test(code)) {
            return 'pub';
        }
        return 'private';
    }
}
