import * as vscode from 'vscode';

/**
 * Common utility functions used across the extension
 */
export class Utils {
    /**
     * Convert a string to snake_case
     */
    static toSnakeCase(str: string): string {
        return str
            .replace(/([A-Z])/g, '_$1')
            .toLowerCase()
            .replace(/^_/, '');
    }

    /**
     * Convert snake_case to PascalCase
     */
    static toPascalCase(str: string): string {
        return str
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join('');
    }

    /**
     * Validate Rust identifier (function, struct, module names)
     */
    static isValidRustIdentifier(name: string): boolean {
        // Must start with letter or underscore, followed by letters, digits, or underscores
        return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
    }

    /**
     * Validate Rust module name (must be snake_case)
     */
    static isValidModuleName(name: string): boolean {
        // Must be snake_case: lowercase with underscores
        return /^[a-z][a-z0-9_]*$/.test(name);
    }

    /**
     * Extract visibility modifier from code
     */
    static extractVisibility(code: string): 'pub' | 'pub(crate)' | 'pub(super)' | 'private' {
        if (code.includes('pub(crate)')) {
            return 'pub(crate)';
        } else if (code.includes('pub(super)')) {
            return 'pub(super)';
        } else if (/pub\s/.test(code)) {
            return 'pub';
        }
        return 'private';
    }

    /**
     * Check if a line is a comment
     */
    static isComment(line: string): boolean {
        const trimmed = line.trim();
        return trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*');
    }

    /**
     * Remove comments from code
     */
    static removeComments(code: string): string {
        // Remove single-line comments
        let result = code.replace(/\/\/.*$/gm, '');
        
        // Remove multi-line comments
        result = result.replace(/\/\*[\s\S]*?\*\//g, '');
        
        return result;
    }

    /**
     * Extract generic parameters from a type signature
     */
    static extractGenericParams(signature: string): string[] {
        const match = signature.match(/<([^>]+)>/);
        if (!match) {
            return [];
        }
        
        return match[1]
            .split(',')
            .map(param => param.trim())
            .filter(param => param.length > 0);
    }

    /**
     * Get the indentation level of a line
     */
    static getIndentation(line: string): string {
        const match = line.match(/^(\s+)/);
        return match ? match[1] : '';
    }

    /**
     * Show a progress notification
     */
    static async withProgress<T>(
        title: string,
        task: (progress: vscode.Progress<{ message?: string; increment?: number }>) => Promise<T>
    ): Promise<T> {
        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title,
                cancellable: false
            },
            task
        );
    }

    /**
     * Show an error message with optional actions
     */
    static async showError(message: string, ...actions: string[]): Promise<string | undefined> {
        return vscode.window.showErrorMessage(message, ...actions);
    }

    /**
     * Show an info message with optional actions
     */
    static async showInfo(message: string, ...actions: string[]): Promise<string | undefined> {
        return vscode.window.showInformationMessage(message, ...actions);
    }

    /**
     * Get workspace root path
     */
    static getWorkspaceRoot(): string | undefined {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return undefined;
        }
        return workspaceFolders[0].uri.fsPath;
    }

    /**
     * Check if rust-analyzer is available
     */
    static isRustAnalyzerAvailable(): boolean {
        const extension = vscode.extensions.getExtension('rust-lang.rust-analyzer');
        return extension !== undefined && extension.isActive;
    }

    /**
     * Format a file path for display
     */
    static formatPath(path: string): string {
        const workspaceRoot = Utils.getWorkspaceRoot();
        if (workspaceRoot && path.startsWith(workspaceRoot)) {
            return path.substring(workspaceRoot.length + 1);
        }
        return path;
    }

    /**
     * Escape special regex characters
     */
    static escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Count occurrences of a substring in a string
     */
    static countOccurrences(str: string, substring: string): number {
        let count = 0;
        let position = 0;
        
        while ((position = str.indexOf(substring, position)) !== -1) {
            count++;
            position += substring.length;
        }
        
        return count;
    }

    /**
     * Check if code contains async functions
     */
    static hasAsyncCode(code: string): boolean {
        return /async\s+fn/.test(code) || /\.await/.test(code);
    }

    /**
     * Check if code uses unsafe
     */
    static hasUnsafeCode(code: string): boolean {
        return /unsafe\s+/.test(code);
    }

    /**
     * Extract all identifiers from code
     */
    static extractIdentifiers(code: string): Set<string> {
        const identifiers = new Set<string>();
        const regex = /\b[a-zA-Z_][a-zA-Z0-9_]*\b/g;
        
        let match;
        while ((match = regex.exec(code)) !== null) {
            identifiers.add(match[0]);
        }
        
        return identifiers;
    }

    /**
     * Get line count of code
     */
    static getLineCount(code: string): number {
        return code.split('\n').length;
    }

    /**
     * Trim empty lines from start and end
     */
    static trimEmptyLines(code: string): string {
        const lines = code.split('\n');
        
        // Trim from start
        while (lines.length > 0 && lines[0].trim() === '') {
            lines.shift();
        }
        
        // Trim from end
        while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
            lines.pop();
        }
        
        return lines.join('\n');
    }

    /**
     * Add proper indentation to code
     */
    static indent(code: string, spaces: number = 4): string {
        const indentation = ' '.repeat(spaces);
        return code
            .split('\n')
            .map(line => line.length > 0 ? indentation + line : line)
            .join('\n');
    }
}
