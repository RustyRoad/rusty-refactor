import * as vscode from 'vscode';

/**
 * Integration with rust-analyzer for enhanced type and trait detection
 */
export class RustAnalyzerIntegration {
    private disposables: vscode.Disposable[] = [];

    constructor() {
        // Monitor rust-analyzer extension
        this.checkRustAnalyzer();
    }

    private checkRustAnalyzer(): boolean {
        const rustAnalyzer = vscode.extensions.getExtension('rust-lang.rust-analyzer');
        if (!rustAnalyzer) {
            console.log('rust-analyzer extension not found');
            return false;
        }
        
        if (!rustAnalyzer.isActive) {
            console.log('rust-analyzer extension not active');
            return false;
        }
        
        return true;
    }

    /**
     * Get type information for code at the given selection using rust-analyzer
     */
    async getTypeInfo(document: vscode.TextDocument, selection: vscode.Selection): Promise<string[] | null> {
        if (!this.checkRustAnalyzer()) {
            return null;
        }

        try {
            // Use vscode's built-in hover provider which rust-analyzer implements
            const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
                'vscode.executeHoverProvider',
                document.uri,
                selection.start
            );

            if (!hovers || hovers.length === 0) {
                return null;
            }

            const types = new Set<string>();
            
            for (const hover of hovers) {
                if (hover.contents) {
                    for (const content of hover.contents) {
                        const text = typeof content === 'string' 
                            ? content 
                            : content.value;
                        
                        // Extract type names from rust-analyzer hover info
                        const typeMatches = text.match(/(?:struct|enum|trait)\s+(\w+)/g);
                        if (typeMatches) {
                            typeMatches.forEach(match => {
                                const typeName = match.split(/\s+/).pop();
                                if (typeName) {
                                    types.add(typeName);
                                }
                            });
                        }
                    }
                }
            }

            return types.size > 0 ? Array.from(types) : null;
        } catch (error) {
            console.error('Error getting type info from rust-analyzer:', error);
            return null;
        }
    }

    /**
     * Get trait information for code at the given selection using rust-analyzer
     */
    async getTraitInfo(document: vscode.TextDocument, selection: vscode.Selection): Promise<string[] | null> {
        if (!this.checkRustAnalyzer()) {
            return null;
        }

        try {
            // Use document symbols to find trait implementations
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider',
                document.uri
            );

            if (!symbols) {
                return null;
            }

            const traits = new Set<string>();
            
            // Recursively search for traits in the selection range
            const findTraits = (symbol: vscode.DocumentSymbol) => {
                if (symbol.range.intersection(selection)) {
                    // Check if this is a trait or implementation
                    if (symbol.kind === vscode.SymbolKind.Interface) {
                        traits.add(symbol.name);
                    }
                    
                    // Check children
                    if (symbol.children) {
                        symbol.children.forEach(findTraits);
                    }
                }
            };

            symbols.forEach(findTraits);

            return traits.size > 0 ? Array.from(traits) : null;
        } catch (error) {
            console.error('Error getting trait info from rust-analyzer:', error);
            return null;
        }
    }

    /**
     * Get implementation information using rust-analyzer
     */
    async getImplementationInfo(document: vscode.TextDocument, position: vscode.Position): Promise<any | null> {
        if (!this.checkRustAnalyzer()) {
            return null;
        }

        try {
            const implementations = await vscode.commands.executeCommand(
                'vscode.executeImplementationProvider',
                document.uri,
                position
            );

            return implementations || null;
        } catch (error) {
            console.error('Error getting implementation info:', error);
            return null;
        }
    }

    /**
     * Get definition information for a symbol
     */
    async getDefinition(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Location[] | null> {
        if (!this.checkRustAnalyzer()) {
            return null;
        }

        try {
            const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeDefinitionProvider',
                document.uri,
                position
            );

            return definitions || null;
        } catch (error) {
            console.error('Error getting definition:', error);
            return null;
        }
    }

    /**
     * Get references to a symbol
     */
    async getReferences(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Location[] | null> {
        if (!this.checkRustAnalyzer()) {
            return null;
        }

        try {
            const references = await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeReferenceProvider',
                document.uri,
                position
            );

            return references || null;
        } catch (error) {
            console.error('Error getting references:', error);
            return null;
        }
    }

    /**
     * Request rust-analyzer to analyze the workspace
     */
    async analyzeWorkspace(): Promise<void> {
        try {
            await vscode.commands.executeCommand('rust-analyzer.analyzeWorkspace');
        } catch (error) {
            console.error('Error triggering workspace analysis:', error);
        }
    }

    /**
     * Check if a position is within a function, struct, etc.
     */
    async getSymbolAtPosition(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.DocumentSymbol | null> {
        if (!this.checkRustAnalyzer()) {
            return null;
        }

        try {
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider',
                document.uri
            );

            if (!symbols) {
                return null;
            }

            // Recursively find the symbol at position
            const findSymbol = (symbol: vscode.DocumentSymbol): vscode.DocumentSymbol | null => {
                if (symbol.range.contains(position)) {
                    // Check children first for more specific match
                    if (symbol.children) {
                        for (const child of symbol.children) {
                            const found = findSymbol(child);
                            if (found) {
                                return found;
                            }
                        }
                    }
                    return symbol;
                }
                return null;
            };

            for (const symbol of symbols) {
                const found = findSymbol(symbol);
                if (found) {
                    return found;
                }
            }

            return null;
        } catch (error) {
            console.error('Error getting symbol at position:', error);
            return null;
        }
    }

    dispose() {
        this.disposables.forEach(d => d.dispose());
    }
}
