import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { AnalysisResult } from './analyzer';
import { RustAnalyzerIntegration } from './rustAnalyzerIntegration';
import { suggestImportsForFile } from './rustCompilerBridge';
import {
    extractFunctionWithTypes,
    enhancedCargoCheck,
    suggestImportsForTypes,
    analyzeLifetimes,
    resolveTraitBounds,
    checkModuleConversion,
    convertModuleToFolder,
    isNativeModuleAvailable
} from './nativeBridge';
import { AIDocGenerator } from './aiDocGenerator';

export const logToOutput = (message: string) => {
    const timestamp = new Date().toISOString();
    console.log(`[ModuleExtractor] ${timestamp} - ${message}`);
    // Also try to log to VS Code output channel if available
    const outputChannel = (global as any).rustyRefactorOutputChannel;
    if (outputChannel) {
        outputChannel.appendLine(`[${timestamp}] [ModuleExtractor] ${message}`);
    }
};


export class ModuleExtractor {
    private aiDocGenerator: AIDocGenerator;
    private originalSelection: vscode.Selection;

    constructor(
        private document: vscode.TextDocument,
        private analysis: AnalysisResult,
        private moduleName: string,
        private modulePath: string,
        private rustAnalyzer?: RustAnalyzerIntegration,
        originalSelection?: vscode.Selection
    ) {
        this.aiDocGenerator = new AIDocGenerator();
        // Store the original selection range to use for code replacement
        // This prevents issues when multiple extractions happen in sequence
        this.originalSelection = originalSelection || vscode.window.activeTextEditor!.selection;
    }

    async extract(): Promise<void> {
        const config = vscode.workspace.getConfiguration('rustyRefactor');
        const startTime = new Date();

        logToOutput(`Starting extraction for module: ${this.moduleName}`);
        logToOutput(`Target path: ${this.modulePath}`);
        logToOutput(`Original file: ${this.document.fileName}`);
        logToOutput(`Selected code length: ${this.analysis.selectedCode.length} characters`);

        try {
            // Check if we need to convert a module file to folder first
            logToOutput('Checking for module conversion requirements...');
            await this.handleModuleConversion();
            logToOutput('Module conversion check completed');

            // Generate module content
            logToOutput('Generating module content...');
            let moduleContent = await this.generateModuleContent();
            logToOutput(`Module content generated (${moduleContent.length} characters)`);
            logToOutput(`Content preview: ${moduleContent.substring(0, 200)}${moduleContent.length > 200 ? '...' : ''}`);

            // Ask if user wants AI documentation (handles both auto and prompt cases)
            logToOutput('Checking AI documentation preferences...');
            const shouldUseAI = await this.aiDocGenerator.shouldGenerateDocumentation();
            logToOutput(`AI documentation requested: ${shouldUseAI}`);

            if (shouldUseAI) {
                logToOutput('Generating AI documentation...');
                // Show progress while generating documentation
                moduleContent = await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: 'Generating AI documentation...',
                    cancellable: false
                }, async () => {
                    const documented = await this.aiDocGenerator.generateDocumentation(
                        moduleContent,
                        this.moduleName
                    );
                    if (documented) {
                        logToOutput('AI documentation generated successfully');
                        logToOutput(`Documented content length: ${documented.length} characters`);
                    } else {
                        logToOutput('AI documentation generation returned null, using original content');
                    }
                    return documented || moduleContent;
                });
            } else {
                logToOutput('AI documentation not requested for module');
            }

            // Create module file
            logToOutput('Creating module file...');
            await this.createModuleFile(moduleContent);
            logToOutput('Module file created successfully');

            // Validate the extracted code compiles with rust-analyzer
            if (this.rustAnalyzer && config.get<boolean>('integrationWithRustAnalyzer', true)) {
                logToOutput('Validating extracted module with rust-analyzer...');
                await this.validateExtractedModule();
                logToOutput('Module validation passed');
            }

            // Find and update parent module
            logToOutput('Updating parent module...');
            await this.updateParentModule();
            logToOutput('Parent module updated successfully');

            // Remove original code from current file with AI summary
            logToOutput('Removing original code from source file...');
            await this.removeOriginalCode(shouldUseAI);
            logToOutput('Original code removed successfully');

            // Format files if configured
            if (config.get<boolean>('autoFormatAfterRefactor', true)) {
                logToOutput('Formatting files...');
                await this.formatFiles();
                logToOutput('File formatting completed');
            } else {
                logToOutput('Auto-format disabled in configuration');
            }

            // Clean up unused imports using rust-analyzer
            if (this.rustAnalyzer && config.get<boolean>('integrationWithRustAnalyzer', true)) {
                logToOutput('Cleaning up unused imports...');
                await this.cleanupUnusedImports();
                logToOutput('Unused import cleanup completed');
            } else {
                logToOutput('Rust-analyzer integration disabled or not available');
            }

            const endTime = new Date();
            const duration = endTime.getTime() - startTime.getTime();
            logToOutput(`Extraction completed successfully in ${duration}ms`);

        } catch (error) {
            const endTime = new Date();
            const duration = endTime.getTime() - startTime.getTime();
            logToOutput(`Extraction failed after ${duration}ms: ${error instanceof Error ? error.message : 'Unknown error'}`);
            if (error instanceof Error && error.stack) {
                logToOutput(`Error stack: ${error.stack}`);
            }
            throw error;
        }
    }

    private async handleModuleConversion(): Promise<void> {
        if (!isNativeModuleAvailable()) {
            return; // Skip if native module not available
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        // Extract the module name from the path
        // e.g., src/models/subscription.rs -> check if models.rs exists
        const pathParts = this.modulePath.split(path.sep);
        if (pathParts.length < 2) {
            return; // Not a nested path
        }

        const parentModuleName = pathParts[pathParts.length - 2];

        try {
            const conversionInfo = await checkModuleConversion(
                workspaceFolder.uri.fsPath,
                this.modulePath,
                parentModuleName
            );

            if (conversionInfo.needs_conversion && conversionInfo.existing_file_path) {
                // Ask user if they want to convert
                const answer = await vscode.window.showInformationMessage(
                    `The module '${parentModuleName}' is currently a file. Would you like to convert it to a folder structure?`,
                    'Yes, convert it',
                    'No, cancel'
                );

                if (answer === 'Yes, convert it') {
                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: `Converting ${parentModuleName}.rs to ${parentModuleName}/mod.rs...`,
                        cancellable: false
                    }, async () => {
                        await convertModuleToFolder(
                            conversionInfo.existing_file_path!,
                            conversionInfo.target_folder_path,
                            conversionInfo.target_mod_file_path
                        );
                    });

                    vscode.window.showInformationMessage(
                        `Successfully converted ${parentModuleName}.rs to ${parentModuleName}/mod.rs`
                    );
                } else {
                    throw new Error('Module conversion cancelled by user');
                }
            }
        } catch (error) {
            console.error('Error handling module conversion:', error);
            throw error;
        }
    }

    private async generateModuleContent(): Promise<string> {
        const config = vscode.workspace.getConfiguration('rustyRefactor');
        const addDocComments = config.get<boolean>('addModuleDocComments', true);

        let content = '';

        // Add module doc comment
        if (addDocComments) {
            content += `//! ${this.capitalizeFirstLetter(this.moduleName)} module\n`;
            content += `//!\n`;
            content += `//! This module was automatically extracted by Rusty Refactor.\n\n`;
        }

        // Try enhanced analysis using native bridge if available
        try {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
            if (workspaceRoot) {
                // Get enhanced imports based on unresolved types
                const enhancedImports = await this.getEnhancedImports(workspaceRoot);
                if (enhancedImports) {
                    content += enhancedImports + '\n\n';
                }
            }
        } catch (e) {
            console.warn('Enhanced analysis failed, falling back to basic analysis:', e);
            // Fallback to regular imports
            const imports = await this.generateImports();
            if (imports) {
                content += imports + '\n\n';
            }
        }

        // Add the selected code (potentially wrapped in impl block)
        content += this.wrapInImplIfNeeded();

        // Ensure file ends with newline
        if (!content.endsWith('\n')) {
            content += '\n';
        }

        return content;
    }

    private async getEnhancedImports(workspaceRoot: string): Promise<string | null> {
        try {
            // Try to extract a function with proper type inference
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document === this.document) {
                const selection = editor.selection;
                const result = await extractFunctionWithTypes(
                    this.document.fileName,
                    selection.start.line + 1, // VSCode is 0-based, our bridge expects 1-based
                    selection.start.character + 1,
                    selection.end.line + 1,
                    selection.end.character + 1,
                    `extracted_${this.moduleName}`
                );

                if (result && result.required_imports.length > 0) {
                    // Generate import statements
                    return result.required_imports
                        .map(imp => `use ${imp};`)
                        .join('\n');
                }
            }

            // Fallback: run enhanced cargo check to find unresolved imports
            const analysis = await enhancedCargoCheck(workspaceRoot, this.document.fileName);
            if (analysis && analysis.suggested_imports.length > 0) {
                // Filter high-confidence imports
                const confidentImports = analysis.suggested_imports.filter(imp => imp.confidence > 0.7);
                if (confidentImports.length > 0) {
                    return confidentImports
                        .map(imp => `${imp.is_glob ? `use ${imp.path}::*;` : `use ${imp.path};`}`)
                        .join('\n');
                }
            }

            return null;
        } catch (e) {
            console.warn('Enhanced import analysis failed:', e);
            return null;
        }
    }

    private wrapInImplIfNeeded(): string {
        const code = this.analysis.selectedCode.trim();

        // Check if code already has impl block
        if (code.match(/^impl\s/)) {
            return code;
        }

        // Check if selection was inside an impl block
        if (this.analysis.isInsideImpl && this.analysis.implContext) {
            const impl = this.analysis.implContext;

            // Wrap in impl block
            let implHeader = `impl ${impl.targetType}`;

            // Add trait if this is a trait implementation
            if (impl.traitName) {
                implHeader = `impl ${impl.traitName} for ${impl.targetType}`;
            }

            return `${implHeader} {\n${this.indentCode(code)}\n}`;
        }

        return code;
    }

    private indentCode(code: string): string {
        return code.split('\n').map(line => '    ' + line).join('\n');
    }

    private async generateImports(): Promise<string> {
        let imports = '';

        // Get all imports from the original file
        const originalFileImports = this.extractAllImportsFromOriginalFile();

        // Analyze which imports are actually used in the selected code
        const usedImports = this.filterUsedImports(originalFileImports, this.analysis.selectedCode);

        // Adjust import paths for the new module location
        const adjustedImports = this.adjustImportPaths(usedImports);

        // Ask Rust compiler bridge for any additional import suggestions (accurate, compiler-driven)
        try {
            const suggested = await suggestImportsForFile(this.document.uri.fsPath);
            if (suggested && suggested.length > 0) {
                // Normalize suggestions (they come as e.g. "stripe::Price" or "crate::...::Type")
                suggested.forEach(s => {
                    if (!adjustedImports.includes(s)) {
                        adjustedImports.push(s);
                    }
                });
            }
        } catch (err) {
            console.error('Error fetching import suggestions from Rust worker:', err);
        }

        // Add only the imports that are actually used
        if (adjustedImports.length > 0) {
            imports += '// Imports from original file\n';
            adjustedImports.forEach(imp => {
                imports += `use ${imp};\n`;
            });
        }

        // Add import for impl target type if it's defined in the same module
        if (this.analysis.isInsideImpl && this.analysis.implContext) {
            const targetType = this.analysis.implContext.targetType;

            // Check if target type is not already in imports and needs super::
            const needsSuperImport = !adjustedImports.some(imp =>
                imp.includes(targetType)
            );

            if (needsSuperImport) {
                imports += `\n// Type from parent module\n`;
                imports += `use super::${targetType};\n`;

                // Add trait name if it's a trait impl and not in imports
                if (this.analysis.implContext.traitName) {
                    const traitNotImported = !adjustedImports.some(imp =>
                        imp.includes(this.analysis.implContext!.traitName!)
                    );
                    if (traitNotImported) {
                        imports += `use super::${this.analysis.implContext.traitName};\n`;
                    }
                }
            }
        }

        return imports;
    }

    /**
     * Adjust import paths when moving code to a new module location.
     * Converts relative imports (super::, self::) to absolute imports (crate::)
     * to avoid path resolution issues in the new location.
     */
    private adjustImportPaths(imports: string[]): string[] {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return imports;
        }

        const adjustedImports: string[] = [];
        const originalFilePath = this.document.uri.fsPath;
        const originalModulePath = this.getModulePathFromFilePath(originalFilePath, workspaceFolder.uri.fsPath);

        for (const importPath of imports) {
            // Skip external crate imports (they don't need adjustment)
            if (!importPath.startsWith('super::') &&
                !importPath.startsWith('self::') &&
                !importPath.startsWith('crate::')) {
                adjustedImports.push(importPath);
                continue;
            }

            // Convert super:: and self:: to absolute crate:: paths
            let adjustedPath = importPath;

            if (importPath.startsWith('super::')) {
                // Convert super:: references to absolute crate:: paths
                adjustedPath = this.resolveSuperImport(importPath, originalModulePath);
            } else if (importPath.startsWith('self::')) {
                // Convert self:: to current module path
                adjustedPath = this.resolveSelfImport(importPath, originalModulePath);
            }
            // crate:: imports don't need adjustment

            adjustedImports.push(adjustedPath);
        }

        return adjustedImports;
    }

    /**
     * Get the module path (e.g., "models::subscription") from a file path
     */
    private getModulePathFromFilePath(filePath: string, workspaceRoot: string): string[] {
        const relativePath = path.relative(workspaceRoot, filePath);
        const parts = relativePath.split(path.sep);

        // Remove 'src' if present
        if (parts[0] === 'src') {
            parts.shift();
        }

        // Remove file extension
        const lastPart = parts[parts.length - 1];
        if (lastPart) {
            if (lastPart === 'mod.rs' || lastPart === 'lib.rs' || lastPart === 'main.rs') {
                parts.pop();
            } else if (lastPart.endsWith('.rs')) {
                parts[parts.length - 1] = lastPart.slice(0, -3);
            }
        }

        return parts.filter(p => p); // Remove empty strings
    }

    /**
     * Resolve a super:: import to an absolute crate:: path
     */
    private resolveSuperImport(importPath: string, currentModulePath: string[]): string {
        const parts = importPath.split('::');
        const modulePath = [...currentModulePath];

        // Count and remove 'super' prefixes
        let i = 0;
        while (i < parts.length && parts[i] === 'super') {
            if (modulePath.length > 0) {
                modulePath.pop(); // Go up one level
            }
            i++;
        }

        // Build the absolute path
        const remainingParts = parts.slice(i);
        const absolutePath = [...modulePath, ...remainingParts];

        return 'crate::' + absolutePath.join('::');
    }

    /**
     * Resolve a self:: import to an absolute crate:: path
     */
    private resolveSelfImport(importPath: string, currentModulePath: string[]): string {
        const parts = importPath.split('::');

        // Remove 'self' prefix
        const remainingParts = parts.slice(1);
        const absolutePath = [...currentModulePath, ...remainingParts];

        return 'crate::' + absolutePath.join('::');
    }

    private extractAllImportsFromOriginalFile(): string[] {
        const imports: string[] = [];
        const text = this.document.getText();
        const lines = text.split('\n');

        for (const line of lines) {
            const trimmed = line.trim();

            // Match use statements
            const useMatch = trimmed.match(/^use\s+([^;]+);/);
            if (useMatch) {
                imports.push(useMatch[1]);
            }
        }

        return imports;
    }

    private filterUsedImports(imports: string[], code: string): string[] {
        const usedImports: string[] = [];

        for (const importStatement of imports) {
            // Parse the import to extract identifiers
            const identifiers = this.extractIdentifiersFromImport(importStatement);

            // For external crate imports, check both namespace and identifier usage
            if (this.isExternalCrateImport(importStatement)) {
                const crateName = this.extractCrateName(importStatement);

                // Check if the crate namespace appears in the code (e.g., stripe::Price)
                if (crateName && code.includes(crateName + '::')) {
                    usedImports.push(importStatement);
                    continue;
                }

                // Also check if any imported identifier is used directly
                const hasUsedIdentifier = identifiers.some(identifier => {
                    if (identifier === '*') {
                        return false; // Already checked namespace above
                    }
                    const regex = new RegExp(`\\b${this.escapeRegex(identifier)}\\b`);
                    return regex.test(code);
                });

                if (hasUsedIdentifier) {
                    usedImports.push(importStatement);
                    continue;
                }
            } else {
                // For internal imports (crate::, super::, self::)
                const isUsed = identifiers.some(identifier => {
                    if (identifier === '*') {
                        // Wildcard imports - check if the namespace is used
                        const namespace = this.extractNamespaceFromImport(importStatement);
                        if (namespace && code.includes(namespace)) {
                            return true;
                        }
                        return false;
                    }

                    // Create regex to match the identifier as a whole word
                    const regex = new RegExp(`\\b${this.escapeRegex(identifier)}\\b`);
                    return regex.test(code);
                });

                if (isUsed) {
                    usedImports.push(importStatement);
                }
            }
        }

        return usedImports;
    }

    /**
     * Check if an import is from an external crate (not crate::, super::, self::)
     */
    private isExternalCrateImport(importStatement: string): boolean {
        return !importStatement.startsWith('crate::') &&
            !importStatement.startsWith('super::') &&
            !importStatement.startsWith('self::') &&
            !importStatement.startsWith('std::');
    }

    /**
     * Extract the crate name from an import statement
     * e.g., "stripe::Price" -> "stripe"
     */
    private extractCrateName(importStatement: string): string | null {
        const parts = importStatement.split('::');
        if (parts.length > 0) {
            return parts[0].trim();
        }
        return null;
    }

    /**
     * Extract namespace from a wildcard import
     * e.g., "stripe::types::*" -> "stripe"
     */
    private extractNamespaceFromImport(importStatement: string): string | null {
        if (importStatement.includes('*')) {
            const parts = importStatement.split('::');
            if (parts.length > 0) {
                return parts[0].trim();
            }
        }
        return null;
    }

    private extractIdentifiersFromImport(importStatement: string): string[] {
        const identifiers: string[] = [];

        // Handle wildcard imports - always include them
        if (importStatement.includes('*')) {
            return ['*'];
        }

        // Handle braced imports: super::{Email, User}
        const bracedMatch = importStatement.match(/\{([^}]+)\}/);
        if (bracedMatch) {
            const items = bracedMatch[1].split(',').map(item => item.trim());
            items.forEach(item => {
                // Handle "self" and "as" aliases
                if (item === 'self') {
                    // Extract module name before the braces
                    const moduleMatch = importStatement.match(/([\w:]+)::\{/);
                    if (moduleMatch) {
                        const parts = moduleMatch[1].split('::');
                        identifiers.push(parts[parts.length - 1]);
                    }
                } else if (item.includes(' as ')) {
                    // Handle aliases: "Database as DB"
                    const [_, alias] = item.split(' as ').map(s => s.trim());
                    identifiers.push(alias);
                } else {
                    identifiers.push(item);
                }
            });
        } else {
            // Handle simple imports: std::collections::HashMap or stripe::Price
            const parts = importStatement.split('::');
            const lastPart = parts[parts.length - 1].trim();

            // Handle "as" aliases
            if (lastPart.includes(' as ')) {
                const [original, alias] = lastPart.split(' as ').map(s => s.trim());
                identifiers.push(alias);
                // Also check for original name in case it's used with namespace
                identifiers.push(original);
            } else {
                identifiers.push(lastPart);
            }

            // For external crates, also add the full namespace path as an identifier
            // This helps catch usages like `stripe::Price::list(...)` when import is `use stripe::Price`
            if (parts.length > 1 && this.isExternalCrateImport(importStatement)) {
                identifiers.push(parts[0]); // Add crate name
            }
        }

        return identifiers;
    }

    private escapeRegex(str: string): string {
        if (str === '*') {
            return str;
        }
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    private isDefinedInSelection(typeName: string): boolean {
        return this.analysis.structs.some(s => s.name === typeName) ||
            this.analysis.enums.some(e => e.name === typeName) ||
            this.analysis.traits.some(t => t.name === typeName);
    }

    private async createModuleFile(content: string): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error('No workspace folder found');
        }

        const fullPath = path.join(workspaceFolder.uri.fsPath, this.modulePath);
        const uri = vscode.Uri.file(fullPath);

        // Create directory if it doesn't exist
        const dirPath = path.dirname(fullPath);
        const dirUri = vscode.Uri.file(dirPath);

        try {
            await vscode.workspace.fs.stat(dirUri);
        } catch {
            await vscode.workspace.fs.createDirectory(dirUri);
        }

        // Write the file
        const encoder = new TextEncoder();
        await vscode.workspace.fs.writeFile(uri, encoder.encode(content));
    }

    private async updateParentModule(): Promise<void> {
        const parentModulePath = await this.findParentModuleFile();

        if (!parentModulePath) {
            vscode.window.showWarningMessage(
                `Could not find parent module. Please manually add: mod ${this.moduleName};`
            );
            return;
        }

        await this.registerModuleInParent(parentModulePath);
    }

    private async findParentModuleFile(): Promise<string | null> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return null;
        }

        const targetPath = path.join(workspaceFolder.uri.fsPath, this.modulePath);
        const targetDir = path.dirname(targetPath);

        const possibleParentFiles = [
            path.join(targetDir, 'mod.rs'),
            path.join(targetDir, 'lib.rs'),
            path.join(targetDir, 'main.rs'),
            path.join(path.dirname(targetDir), 'mod.rs'),
            path.join(path.dirname(targetDir), 'lib.rs'),
            path.join(path.dirname(targetDir), 'main.rs'),
        ];

        const dirName = path.basename(targetDir);
        const parentDir = path.dirname(targetDir);
        possibleParentFiles.push(path.join(parentDir, `${dirName}.rs`));

        for (const filePath of possibleParentFiles) {
            if (fs.existsSync(filePath)) {
                return filePath;
            }
        }

        if (targetDir.includes(path.join('src', 'controllers')) ||
            targetDir.includes(path.join('src', 'models')) ||
            targetDir.includes(path.join('src', 'services'))) {

            const srcLib = path.join(workspaceFolder.uri.fsPath, 'src', 'lib.rs');
            const srcMain = path.join(workspaceFolder.uri.fsPath, 'src', 'main.rs');

            if (fs.existsSync(srcLib)) {
                return srcLib;
            }
            if (fs.existsSync(srcMain)) {
                return srcMain;
            }
        }

        return null;
    }

    private async registerModuleInParent(parentFilePath: string): Promise<void> {
        const parentUri = vscode.Uri.file(parentFilePath);

        try {
            const parentDoc = await vscode.workspace.openTextDocument(parentUri);
            const parentText = parentDoc.getText();

            const modDeclarationRegex = new RegExp(`^\\s*(?:pub\\s+)?mod\\s+${this.moduleName}\\s*;`, 'gm');
            if (modDeclarationRegex.test(parentText)) {
                logToOutput(`Module ${this.moduleName} already declared in parent`);
                return;
            }

            const insertPosition = this.findModuleInsertPosition(parentDoc);
            const modDeclaration = this.generateModDeclarationForParent(parentFilePath);
            const useStatement = this.generatePublicUseStatement();

            const edit = new vscode.WorkspaceEdit();
            edit.insert(parentUri, insertPosition, modDeclaration + '\n');

            if (useStatement) {
                const usePosition = new vscode.Position(insertPosition.line + 1, 0);
                edit.insert(parentUri, usePosition, useStatement + '\n');
            }

            await vscode.workspace.applyEdit(edit);
            await parentDoc.save();

        } catch (error) {
            console.error('Error updating parent module:', error);
            throw new Error(`Failed to update parent module: ${error}`);
        }
    }

    private generateModDeclarationForParent(parentFilePath: string): string {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return `pub mod ${this.moduleName};`;
        }

        const targetPath = path.join(workspaceFolder.uri.fsPath, this.modulePath);
        const parentDir = path.dirname(parentFilePath);

        // Check if the target path is in a subdirectory relative to the parent
        // e.g., parent is src/mod.rs, target is src/models/subscription.rs
        const parentDirName = path.basename(parentDir);
        const targetFileName = path.basename(targetPath, '.rs');

        // If the parent is mod.rs in a folder, modules in that folder can be declared simply
        if (path.basename(parentFilePath) === 'mod.rs') {
            const targetDir = path.dirname(targetPath);
            const parentContainingDir = parentDir;

            // If target is directly in the same folder as mod.rs
            if (path.normalize(targetDir) === path.normalize(parentContainingDir)) {
                return `pub mod ${this.moduleName};`;
            }
        }

        // Calculate relative path for #[path] attribute if needed
        let relativePath = path.relative(parentDir, targetPath);
        relativePath = relativePath.replace(/\\/g, '/');

        if (relativePath.endsWith('.rs')) {
            relativePath = relativePath.slice(0, -3);
        }

        // If the path is just the module name (no subdirectories), no #[path] needed
        if (!relativePath.includes('/') && relativePath === this.moduleName) {
            return `pub mod ${this.moduleName};`;
        }

        // Need #[path] attribute for non-standard locations
        return `#[path = "${relativePath}.rs"]\npub mod ${this.moduleName};`;
    }

    private generatePublicUseStatement(): string {
        const publicItems: string[] = [];

        this.analysis.functions.forEach(func => {
            if (func.isPublic) {
                publicItems.push(func.name);
            }
        });

        this.analysis.structs.forEach(struct => {
            if (struct.isPublic) {
                publicItems.push(struct.name);
            }
        });

        this.analysis.enums.forEach(enumDef => {
            if (enumDef.isPublic) {
                publicItems.push(enumDef.name);
            }
        });

        this.analysis.traits.forEach(trait => {
            if (trait.isPublic) {
                publicItems.push(trait.name);
            }
        });

        if (publicItems.length === 0) {
            return '';
        }

        return `pub use ${this.moduleName}::*;`;
    }

    private findModuleInsertPosition(document: vscode.TextDocument): vscode.Position {
        let lastModLine = -1;
        let lastUseLine = -1;
        let firstContentLine = -1;

        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i).text.trim();

            if (line.startsWith('mod ') || line.startsWith('pub mod ') || line.includes('#[path')) {
                lastModLine = i;
            }
            else if (line.startsWith('use ') || line.startsWith('pub use ')) {
                lastUseLine = i;
            }
            else if (line && !line.startsWith('//') && !line.startsWith('#[') && firstContentLine === -1) {
                firstContentLine = i;
            }
        }

        if (lastModLine >= 0) {
            return new vscode.Position(lastModLine + 1, 0);
        }

        if (lastUseLine >= 0) {
            return new vscode.Position(lastUseLine + 1, 0);
        }

        if (firstContentLine >= 0) {
            return new vscode.Position(firstContentLine, 0);
        }

        return new vscode.Position(0, 0);
    }

    private async removeOriginalCode(useAISummary: boolean = false): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        // Use the stored original selection, not the current editor selection
        // This ensures we replace the correct code even if multiple extractions happened
        const rangeToReplace = this.originalSelection;

        // Simply delete the extracted code - don't leave comments
        // The module system and imports make it clear where the code went
        const comment = ''; // Empty string = delete the selection

        // Use WorkspaceEdit API for atomic, validated changes
        const edit = new vscode.WorkspaceEdit();
        edit.replace(editor.document.uri, rangeToReplace, comment);
        
        // Apply the edit - this validates before applying
        const success = await vscode.workspace.applyEdit(edit);
        if (!success) {
            throw new Error('Failed to replace original code - edit was rejected by VS Code');
        }
        
        logToOutput('Original code removed from source file');
    }

    private async validateExtractedModule(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error('No workspace folder found for validation');
        }

        const fullPath = path.join(workspaceFolder.uri.fsPath, this.modulePath);
        const uri = vscode.Uri.file(fullPath);
        const maxRetries = 3;
        let attempt = 0;

        while (attempt < maxRetries) {
            attempt++;
            logToOutput(`Validation attempt ${attempt}/${maxRetries}`);

            try {
                // Open the document to trigger rust-analyzer
                const doc = await vscode.workspace.openTextDocument(uri);
                
                // Wait for rust-analyzer to process the file
                logToOutput('Waiting for rust-analyzer to process new module...');
                await new Promise(resolve => setTimeout(resolve, 2000));

                // Get diagnostics from rust-analyzer
                const diagnostics = vscode.languages.getDiagnostics(uri);
                const errors = diagnostics.filter(d => 
                    d.severity === vscode.DiagnosticSeverity.Error &&
                    d.source === 'rust-analyzer'
                );

                if (errors.length === 0) {
                    logToOutput('Module validation successful - no compilation errors');
                    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                    return; // Success!
                }

                logToOutput(`Validation found ${errors.length} compilation error(s)`);
                errors.forEach((err, index) => {
                    logToOutput(`Error ${index + 1}: ${err.message} at line ${err.range.start.line + 1}`);
                });

                // If this is the last attempt, fail
                if (attempt >= maxRetries) {
                    await vscode.window.showTextDocument(doc);
                    throw new Error(
                        `Extracted module has ${errors.length} compilation error(s) after ${maxRetries} attempts. ` +
                        `First error: ${errors[0].message} at line ${errors[0].range.start.line + 1}. ` +
                        `The extraction has been aborted. Please check the output panel for details.`
                    );
                }

                // Try to auto-fix with Copilot
                logToOutput(`Attempting auto-fix with Copilot (attempt ${attempt}/${maxRetries})...`);
                const fixed = await this.attemptAutoFixWithCopilot(doc, errors);
                
                if (!fixed) {
                    logToOutput('Auto-fix failed, aborting validation');
                    await vscode.window.showTextDocument(doc);
                    throw new Error(
                        `Could not auto-fix compilation errors. ` +
                        `Extraction aborted. Please check the file at ${this.modulePath}`
                    );
                }

                logToOutput('Auto-fix applied, re-validating...');
                // Loop will retry validation

            } catch (error) {
                if (error instanceof Error && error.message.includes('compilation error')) {
                    throw error; // Re-throw validation errors
                }
                logToOutput(`Validation check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
                throw error;
            }
        }
    }

    private async attemptAutoFixWithCopilot(
        doc: vscode.TextDocument,
        errors: vscode.Diagnostic[]
    ): Promise<boolean> {
        try {
            // Show the document for code actions
            await vscode.window.showTextDocument(doc);

            let fixesApplied = 0;

            // Try to apply quick fixes for each error
            for (const error of errors) {
                logToOutput(`Attempting to fix: ${error.message}`);

                // Get code actions for this diagnostic
                const codeActions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
                    'vscode.executeCodeActionProvider',
                    doc.uri,
                    error.range
                );

                if (!codeActions || codeActions.length === 0) {
                    logToOutput(`No code actions available for: ${error.message}`);
                    continue;
                }

                // Look for rust-analyzer quick fixes
                const quickFix = codeActions.find(action => 
                    action.kind?.value.startsWith('quickfix') &&
                    (action.title.includes('Import') || 
                     action.title.includes('Add') ||
                     action.title.includes('Insert') ||
                     action.title.includes('Fix'))
                );

                if (quickFix && quickFix.edit) {
                    logToOutput(`Applying quick fix: ${quickFix.title}`);
                    const success = await vscode.workspace.applyEdit(quickFix.edit);
                    if (success) {
                        fixesApplied++;
                        logToOutput(`✓ Applied: ${quickFix.title}`);
                    } else {
                        logToOutput(`✗ Failed to apply: ${quickFix.title}`);
                    }
                } else {
                    logToOutput(`No suitable quick fix found for: ${error.message}`);
                }

                // Small delay between fixes
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            if (fixesApplied > 0) {
                logToOutput(`Applied ${fixesApplied} auto-fix(es)`);
                
                // Save the document
                await doc.save();
                logToOutput('Document saved after auto-fixes');
                
                return true;
            }

            logToOutput('No fixes could be applied automatically');
            return false;

        } catch (error) {
            logToOutput(`Auto-fix error: ${error instanceof Error ? error.message : 'Unknown error'}`);
            return false;
        }
    }

    private async formatFiles(): Promise<void> {
        await vscode.commands.executeCommand('editor.action.formatDocument');

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            const fullPath = path.join(workspaceFolder.uri.fsPath, this.modulePath);
            const uri = vscode.Uri.file(fullPath);

            try {
                const doc = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(doc);
                await vscode.commands.executeCommand('editor.action.formatDocument');
                await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            } catch (error) {
                console.error('Error formatting new module file:', error);
            }
        }
    }

    private async cleanupUnusedImports(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        const fullPath = path.join(workspaceFolder.uri.fsPath, this.modulePath);
        const uri = vscode.Uri.file(fullPath);

        try {
            const doc = await vscode.workspace.openTextDocument(uri);
            await new Promise(resolve => setTimeout(resolve, 1000));

            const diagnostics = vscode.languages.getDiagnostics(uri);
            const unusedImportDiagnostics = diagnostics.filter(d =>
                d.message.includes('unused import') ||
                d.message.includes('never used') ||
                (d.source === 'rust-analyzer' && d.severity === vscode.DiagnosticSeverity.Warning)
            );

            if (unusedImportDiagnostics.length > 0) {
                await vscode.window.showTextDocument(doc);

                for (const diagnostic of unusedImportDiagnostics) {
                    const codeActions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
                        'vscode.executeCodeActionProvider',
                        uri,
                        diagnostic.range
                    );

                    const removeAction = codeActions?.find(action =>
                        action.title.includes('Remove') &&
                        (action.title.includes('unused') || action.title.includes('import'))
                    );

                    if (removeAction?.edit) {
                        await vscode.workspace.applyEdit(removeAction.edit);
                    }
                }

                await doc.save();
                await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            }
        } catch (error) {
            console.error('Error cleaning up unused imports:', error);
        }
    }

    private capitalizeFirstLetter(str: string): string {
        return str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, ' ');
    }

    /**
     * Normalize file paths for consistent display across platforms.
     * Converts to forward slashes and ensures relative path from workspace.
     */
    private normalizePath(filePath: string): string {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            const relativePath = path.relative(workspaceFolder.uri.fsPath, filePath);
            return relativePath.replace(/\\/g, '/');
        }
        return filePath.replace(/\\/g, '/');
    }
}
