/**
 * Handles detection of impl block context within documents.
 * Single Responsibility: Detect and extract impl block context.
 */

import * as vscode from 'vscode';
import { ImplementationInfo, FunctionInfo } from './analyzer';
import { RustCodeParser } from './rustCodeParser';

export class ImplContextDetector {
    private parser: RustCodeParser;

    constructor(private document: vscode.TextDocument) {
        this.parser = new RustCodeParser();
    }

    /**
     * Detect if the selection is inside an impl block and get its context
     */
    async detectImplContext(selection: vscode.Selection): Promise<ImplementationInfo | null> {
        const fullText = this.document.getText();
        const selectionStart = this.document.offsetAt(selection.start);

        const implRegex = /impl\s*(?:<[^>]+>)?\s*(?:(\w+)\s+for\s+)?(\w+)\s*(?:<[^>]+>)?\s*\{/g;
        let match;

        while ((match = implRegex.exec(fullText)) !== null) {
            const implStart = match.index;
            const implBlockEnd = this.findBlockEnd(fullText, implStart);

            // Check if selection is within this impl block
            if (implStart < selectionStart && selectionStart < implBlockEnd) {
                const implBlock = fullText.substring(implStart, implBlockEnd);
                const methods = this.parser.parseFunctions(implBlock);

                return {
                    targetType: match[2],
                    traitName: match[1],
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
}
