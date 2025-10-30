import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { checkModuleConversion, isNativeModuleAvailable } from './nativeBridge';

interface DirectoryItem extends vscode.QuickPickItem {
    fullPath: string;
    isDirectory: boolean;
    requiresConversion?: boolean;
    moduleName?: string;
}

export class FileSearchProvider {
    private workspaceRoot: string;
    private rustyRoadDirectories: string[] = [
        'src/controllers',
        'src/models',
        'src/views',
        'src/services',
        'src/middleware',
        'src/helpers',
        'src/lib',
        'src/utils',
        'src/config',
        'src/routes',
        'src/handlers',
        'src/repositories',
        'src/domain',
    ];

    constructor(private workspaceFolder: vscode.WorkspaceFolder) {
        this.workspaceRoot = workspaceFolder.uri.fsPath;
    }

    /**
     * Let user browse directories and select where to place the extracted module
     */
    async selectDestination(moduleName: string): Promise<string | undefined> {
        const config = vscode.workspace.getConfiguration('rustyRefactor');
        const rustyRoadMode = config.get<boolean>('rustyRoadMode', true);
        
        let currentPath = 'src';
        
        while (true) {
            const items = await this.getDirectoryItems(currentPath, rustyRoadMode, moduleName);
            
            if (items.length === 0) {
                break;
            }

            const quickPick = vscode.window.createQuickPick<DirectoryItem>();
            quickPick.title = 'Select destination for extracted module';
            quickPick.placeholder = `Current: ${currentPath} (Select a directory or "Create here")`;
            quickPick.items = items;
            quickPick.matchOnDescription = true;
            quickPick.matchOnDetail = true;

            const selected = await new Promise<DirectoryItem | undefined>((resolve) => {
                quickPick.onDidAccept(() => {
                    const selection = quickPick.selectedItems[0];
                    resolve(selection);
                    quickPick.dispose();
                });
                quickPick.onDidHide(() => {
                    resolve(undefined);
                    quickPick.dispose();
                });
                quickPick.show();
            });

            if (!selected) {
                return undefined; // User cancelled
            }

            if (selected.label === '$(check) Create module here') {
                // User selected current directory
                return path.join(currentPath, `${moduleName}.rs`);
            }

            if (selected.label === '$(folder) ..') {
                // Go back to parent directory
                const parentPath = path.dirname(currentPath);
                currentPath = parentPath === '.' ? 'src' : parentPath;
                continue;
            }

            if (selected.requiresConversion && selected.moduleName) {
                // User selected a module that needs conversion
                // Return a special path that indicates conversion is needed
                return path.join(currentPath, selected.moduleName, `${moduleName}.rs`);
            }

            if (selected.isDirectory) {
                // Navigate into directory
                currentPath = selected.fullPath;
                continue;
            } else {
                // Selected a file (shouldn't happen, but handle it)
                return selected.fullPath;
            }
        }

        // Default to current path if loop exits
        return path.join(currentPath, `${moduleName}.rs`);
    }

    /**
     * Get directory items for quick pick
     */
    private async getDirectoryItems(currentPath: string, rustyRoadMode: boolean, moduleName?: string): Promise<DirectoryItem[]> {
        const items: DirectoryItem[] = [];
        
        // Add "Create here" option
        items.push({
            label: '$(check) Create module here',
            description: `Will create in: ${currentPath}/`,
            fullPath: currentPath,
            isDirectory: false,
        });

        // Add parent directory option if not at root
        if (currentPath !== 'src' && currentPath !== '.') {
            items.push({
                label: '$(folder) ..',
                description: 'Go to parent directory',
                fullPath: path.dirname(currentPath),
                isDirectory: true,
            });
        }

        // Get actual directories
        const fullPath = path.join(this.workspaceRoot, currentPath);
        
        if (!fs.existsSync(fullPath)) {
            // Directory doesn't exist, offer to create suggested directories
            if (rustyRoadMode && currentPath === 'src') {
                for (const suggestedDir of this.rustyRoadDirectories) {
                    const relativePath = suggestedDir.replace(/^src\/?/, '');
                    if (relativePath) {
                        items.push({
                            label: `$(new-folder) ${relativePath}`,
                            description: '(RustyRoad convention - will be created)',
                            detail: `Create ${suggestedDir}`,
                            fullPath: suggestedDir,
                            isDirectory: true,
                        });
                    }
                }
            }
            return items;
        }

        try {
            const entries = fs.readdirSync(fullPath, { withFileTypes: true });
            
            // Check for module files that could be converted to folders
            if (moduleName && isNativeModuleAvailable()) {
                const moduleFiles = entries.filter(entry => 
                    entry.isFile() && 
                    entry.name.endsWith('.rs') && 
                    entry.name !== 'mod.rs' &&
                    entry.name !== 'lib.rs' &&
                    entry.name !== 'main.rs'
                );
                
                for (const file of moduleFiles) {
                    const fileModuleName = file.name.slice(0, -3); // Remove .rs
                    try {
                        const conversionInfo = await checkModuleConversion(
                            this.workspaceRoot,
                            path.join(currentPath, `${fileModuleName}.rs`),
                            fileModuleName
                        );
                        
                        if (conversionInfo.needs_conversion) {
                            items.push({
                                label: `$(file-code) ${fileModuleName}`,
                                description: '(Module file - can be converted to folder)',
                                detail: `Extract into ${fileModuleName}/`,
                                fullPath: path.join(currentPath, fileModuleName),
                                isDirectory: true,
                                requiresConversion: true,
                                moduleName: fileModuleName,
                            });
                        }
                    } catch (error) {
                        console.error('Error checking module conversion:', error);
                    }
                }
            }
            
            // Filter to only directories and Rust files
            const directories = entries
                .filter(entry => entry.isDirectory())
                .filter(entry => !entry.name.startsWith('.') && entry.name !== 'target' && entry.name !== 'node_modules')
                .sort((a, b) => a.name.localeCompare(b.name));

            // Add RustyRoad suggested directories if in RustyRoad mode
            if (rustyRoadMode && currentPath === 'src') {
                const existingDirs = new Set(directories.map(d => d.name));
                const suggestedDirs = ['controllers', 'models', 'views', 'services', 'middleware', 'helpers', 'lib', 'utils', 'config', 'routes', 'handlers', 'repositories', 'domain'];
                
                for (const suggestedDir of suggestedDirs) {
                    if (!existingDirs.has(suggestedDir)) {
                        items.push({
                            label: `$(new-folder) ${suggestedDir}`,
                            description: '(RustyRoad convention - will be created)',
                            fullPath: path.join(currentPath, suggestedDir),
                            isDirectory: true,
                        });
                    }
                }
            }

            // Add existing directories
            for (const entry of directories) {
                const itemPath = path.join(currentPath, entry.name);
                const isRustyRoadDir = rustyRoadMode && this.isRustyRoadDirectory(itemPath);
                
                items.push({
                    label: `$(folder) ${entry.name}`,
                    description: isRustyRoadDir ? '(RustyRoad)' : '',
                    fullPath: itemPath,
                    isDirectory: true,
                });
            }

        } catch (error) {
            console.error('Error reading directory:', error);
        }

        return items;
    }

    /**
     * Check if path is a RustyRoad conventional directory
     */
    private isRustyRoadDirectory(dirPath: string): boolean {
        return this.rustyRoadDirectories.some(rustyDir => dirPath.includes(rustyDir));
    }

    /**
     * Search for files/directories matching a query
     */
    async searchFiles(query: string, maxResults: number = 50): Promise<string[]> {
        const config = vscode.workspace.getConfiguration('rustyRefactor');
        const searchDepth = config.get<number>('searchDepth', 5);
        
        const results: string[] = [];
        
        try {
            const files = await vscode.workspace.findFiles(
                `**/${query}*`,
                '{**/target/**,**/node_modules/**,.git/**}',
                maxResults
            );
            
            for (const file of files) {
                const relativePath = vscode.workspace.asRelativePath(file);
                results.push(relativePath);
            }
        } catch (error) {
            console.error('Error searching files:', error);
        }
        
        return results;
    }
}
