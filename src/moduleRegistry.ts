import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Handles finding and updating parent module files to register new modules
 */
export class ModuleRegistry {
    constructor(private workspaceRoot: string) {}

    /**
     * Find the appropriate parent module file where the mod declaration should be added
     */
    async findParentModuleFile(currentFilePath: string, newModulePath: string): Promise<string | null> {
        const newModuleDir = path.dirname(path.join(this.workspaceRoot, newModulePath));
        
        // Check for potential parent files in order of priority
        const candidates = [
            path.join(newModuleDir, 'mod.rs'),
            path.join(newModuleDir, '..', 'mod.rs'),
            path.join(this.workspaceRoot, 'src', 'lib.rs'),
            path.join(this.workspaceRoot, 'src', 'main.rs'),
        ];

        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }

        // If no parent found, try to use rust-analyzer to find the module structure
        const lspParent = await this.findParentViaLSP(currentFilePath);
        if (lspParent) {
            return lspParent;
        }

        // Default to lib.rs or main.rs
        const libPath = path.join(this.workspaceRoot, 'src', 'lib.rs');
        const mainPath = path.join(this.workspaceRoot, 'src', 'main.rs');
        
        if (fs.existsSync(libPath)) {
            return libPath;
        } else if (fs.existsSync(mainPath)) {
            return mainPath;
        }

        return null;
    }

    /**
     * Use rust-analyzer LSP to find parent module
     */
    private async findParentViaLSP(filePath: string): Promise<string | null> {
        try {
            const doc = await vscode.workspace.openTextDocument(filePath);
            const symbolInfo = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
                'vscode.executeDocumentSymbolProvider',
                doc.uri
            );

            // This is a simplified approach - rust-analyzer can provide better info
            // but we'd need to query it more directly
            return null;
        } catch (error) {
            console.error('Error querying LSP:', error);
            return null;
        }
    }

    /**
     * Add mod declaration to parent module file
     */
    async registerModule(
        parentModulePath: string,
        moduleName: string,
        relativeModulePath: string,
        isPublic: boolean = true
    ): Promise<void> {
        const uri = vscode.Uri.file(parentModulePath);
        const doc = await vscode.workspace.openTextDocument(uri);
        const text = doc.getText();

        // Check if module is already declared
        const modRegex = new RegExp(`^\\s*(?:pub\\s+)?mod\\s+${moduleName}\\s*;`, 'm');
        if (modRegex.test(text)) {
            console.log(`Module ${moduleName} already declared in ${parentModulePath}`);
            return;
        }

        // Find the best position to insert the mod declaration
        const insertPosition = this.findModInsertPosition(doc);
        
        // Generate mod declaration
        let modDeclaration = '';
        
        // Check if we need a #[path] attribute
        const parentDir = path.dirname(parentModulePath);
        const expectedPath = path.join(parentDir, moduleName + '.rs');
        const actualPath = path.join(this.workspaceRoot, relativeModulePath);
        
        if (expectedPath !== actualPath) {
            // Need #[path] attribute
            const relPath = path.relative(parentDir, actualPath).replace(/\\/g, '/');
            modDeclaration += `#[path = "${relPath}"]\n`;
        }
        
        modDeclaration += `${isPublic ? 'pub ' : ''}mod ${moduleName};\n`;

        // Apply edit
        const edit = new vscode.WorkspaceEdit();
        edit.insert(uri, insertPosition, modDeclaration);
        await vscode.workspace.applyEdit(edit);

        // Save the file
        await doc.save();
    }

    /**
     * Add pub use statement to parent module file
     */
    async addPublicReexports(
        parentModulePath: string,
        moduleName: string,
        publicItems: string[]
    ): Promise<void> {
        if (publicItems.length === 0) {
            return;
        }

        const uri = vscode.Uri.file(parentModulePath);
        const doc = await vscode.workspace.openTextDocument(uri);

        const insertPosition = this.findUseInsertPosition(doc);
        
        let useStatement = '';
        if (publicItems.length === 1) {
            useStatement = `pub use ${moduleName}::${publicItems[0]};\n`;
        } else {
            useStatement = `pub use ${moduleName}::{${publicItems.join(', ')}};\n`;
        }

        const edit = new vscode.WorkspaceEdit();
        edit.insert(uri, insertPosition, useStatement);
        await vscode.workspace.applyEdit(edit);

        await doc.save();
    }

    /**
     * Find the best position to insert mod declarations
     */
    private findModInsertPosition(document: vscode.TextDocument): vscode.Position {
        let lastModLine = -1;
        let firstItemLine = document.lineCount;

        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i).text.trim();
            
            // Track last mod declaration
            if (line.match(/^(?:pub\s+)?mod\s+\w+/)) {
                lastModLine = i;
            }
            
            // Track first non-mod, non-use, non-comment item
            if (
                line &&
                !line.startsWith('//') &&
                !line.startsWith('#[') &&
                !line.startsWith('use ') &&
                !line.match(/^(?:pub\s+)?mod\s+/) &&
                i < firstItemLine
            ) {
                firstItemLine = i;
            }
        }

        // Insert after last mod declaration
        if (lastModLine >= 0) {
            return new vscode.Position(lastModLine + 1, 0);
        }

        // Or after use statements
        const usePosition = this.findLastUseLine(document);
        if (usePosition > 0) {
            return new vscode.Position(usePosition + 1, 0);
        }

        // Or at the beginning (after initial comments/attributes)
        return this.findFirstCodeLine(document);
    }

    /**
     * Find the best position to insert use statements
     */
    private findUseInsertPosition(document: vscode.TextDocument): vscode.Position {
        const lastUseLine = this.findLastUseLine(document);
        
        if (lastUseLine >= 0) {
            return new vscode.Position(lastUseLine + 1, 0);
        }

        return this.findFirstCodeLine(document);
    }

    private findLastUseLine(document: vscode.TextDocument): number {
        let lastUseLine = -1;

        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i).text.trim();
            if (line.startsWith('use ')) {
                lastUseLine = i;
            }
        }

        return lastUseLine;
    }

    private findFirstCodeLine(document: vscode.TextDocument): vscode.Position {
        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i).text.trim();
            if (line && !line.startsWith('//') && !line.startsWith('#[')) {
                return new vscode.Position(i, 0);
            }
        }

        return new vscode.Position(0, 0);
    }

    /**
     * Get module name from file path (for nested modules)
     */
    getModuleName(filePath: string): string {
        const baseName = path.basename(filePath, '.rs');
        return baseName === 'mod' ? path.basename(path.dirname(filePath)) : baseName;
    }

    /**
     * Check if a path needs a #[path] attribute
     */
    needsPathAttribute(parentPath: string, moduleName: string, actualPath: string): boolean {
        const parentDir = path.dirname(parentPath);
        const expectedPath = path.join(parentDir, moduleName + '.rs');
        return expectedPath !== actualPath;
    }
}
