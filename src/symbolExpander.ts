import * as vscode from 'vscode';

/**
 * Handles VS Code symbol provider API interactions and symbol expansion logic.
 * Single Responsibility: Expand user selections to complete symbol boundaries.
 */
export class SymbolExpander {
    constructor(private document: vscode.TextDocument) {}

    /**
     * Gets complete symbols at the selection using VS Code's symbol provider.
     * Expands to include complete struct, function, enum, trait, and impl definitions,
     * including parent symbols and all attached attributes/traits.
     * 
     * @param selection The user's selection
     * @returns The complete code of all symbols overlapping the selection, or null if unable to expand
     */
    async getCompleteSymbolsAtSelection(selection: vscode.Selection): Promise<string | null> {
        try {
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider',
                this.document.uri
            );

            if (!symbols || symbols.length === 0) {
                return null;
            }

            const overlappingSymbols = this.findOverlappingSymbols(symbols, selection);

            if (overlappingSymbols.length === 0) {
                return null;
            }

            let minLine = selection.start.line;
            let maxLine = selection.end.line;

            for (const symbol of overlappingSymbols) {
                minLine = Math.min(minLine, symbol.range.start.line);
                maxLine = Math.max(maxLine, symbol.range.end.line);
            }

            // Expand upward to capture attributes/traits
            minLine = this.findAttributeStart(minLine);

            const expandedRange = new vscode.Range(
                new vscode.Position(minLine, 0),
                new vscode.Position(maxLine, this.document.lineAt(maxLine).text.length)
            );

            return this.document.getText(expandedRange);

        } catch (err) {
            console.error('Error getting complete symbols:', err);
            return null;
        }
    }

    /**
     * Recursively finds all symbols that overlap with the given selection.
     * Includes parent symbols to ensure complete context.
     */
    private findOverlappingSymbols(
        symbols: vscode.DocumentSymbol[],
        selection: vscode.Selection,
        parentSymbols: vscode.DocumentSymbol[] = []
    ): vscode.DocumentSymbol[] {
        const overlapping: vscode.DocumentSymbol[] = [];

        for (const symbol of symbols) {
            if (this.rangesOverlap(symbol.range, selection)) {
                overlapping.push(symbol, ...parentSymbols);
            }

            if (symbol.children && symbol.children.length > 0) {
                const childOverlaps = this.findOverlappingSymbols(
                    symbol.children,
                    selection,
                    [...parentSymbols, symbol]
                );
                overlapping.push(...childOverlaps);
            }
        }

        return overlapping;
    }

    /**
     * Checks if a range overlaps with a selection.
     */
    private rangesOverlap(range: vscode.Range, selection: vscode.Selection): boolean {
        if (range.start.line >= selection.start.line && range.start.line <= selection.end.line) {
            return true;
        }

        if (range.end.line >= selection.start.line && range.end.line <= selection.end.line) {
            return true;
        }

        if (selection.start.line >= range.start.line && selection.end.line <= range.end.line) {
            return true;
        }

        return false;
    }

    /**
     * Scans upward from a line to find the start of all attached attributes/traits.
     * Handles #[get("/path")], #[derive(...)], #[serde(...)], /// doc comments, etc.
     */
    private findAttributeStart(startLine: number): number {
        let line = startLine - 1;

        while (line >= 0) {
            const text = this.document.lineAt(line).text.trim();

            if (text.startsWith('#[') || text.startsWith('///') || text === '') {
                line--;
                continue;
            }

            break;
        }

        return line + 1;
    }
}
