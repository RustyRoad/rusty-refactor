import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { FileSearchProvider } from '../fileSearchProvider';
import { checkModuleConversion, isNativeModuleAvailable } from '../nativeBridge';

export class ModuleExtractorPanel {
    public static readonly viewType = 'moduleExtractor';
    private static instance?: ModuleExtractorPanel;
    
    private _panel: vscode.WebviewPanel | undefined;
    private _disposables: vscode.Disposable[] = [];
    private _fileSearchProvider: FileSearchProvider;
    private _currentPath: string = 'src';
    private _moduleName: string = '';
    private _selectedCode: string = '';
    private _analysisResult: any;
    
    // Store the promise and resolve function for when user makes a selection
    private _selectionPromise?: Promise<string | undefined>;
    private _resolveSelection?: (value: string | undefined) => void;
    
    public static createOrShow(
        extensionUri: vscode.Uri, 
        workspaceFolder: vscode.WorkspaceFolder, 
        moduleName: string,
        selectedCode: string,
        analysisResult: any
    ): ModuleExtractorPanel {
        if (ModuleExtractorPanel.instance) {
            ModuleExtractorPanel.instance._panel?.reveal();
            ModuleExtractorPanel.instance.updateData(moduleName, selectedCode, analysisResult);
            return ModuleExtractorPanel.instance;
        }
        
        const panel = vscode.window.createWebviewPanel(
            ModuleExtractorPanel.viewType,
            'Module Extractor',
            vscode.ViewColumn.Two, // Open in side panel
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        );
        
        const provider = new ModuleExtractorPanel(panel, extensionUri, workspaceFolder);
        provider.updateData(moduleName, selectedCode, analysisResult);
        ModuleExtractorPanel.instance = provider;
        
        return provider;
    }

    public static show(
        moduleName: string,
        selectedCode: string,
        analysisResult: any,
        workspaceFolder: vscode.WorkspaceFolder,
        extensionUri: vscode.Uri
    ): Promise<string | undefined> {
        if (!ModuleExtractorPanel.instance) {
            ModuleExtractorPanel.createOrShow(extensionUri, workspaceFolder, moduleName, selectedCode, analysisResult);
        } else {
            ModuleExtractorPanel.instance.updateData(moduleName, selectedCode, analysisResult);
            ModuleExtractorPanel.instance._panel?.reveal();
        }
        
        // Create a new promise for this selection
        if (ModuleExtractorPanel.instance) {
            ModuleExtractorPanel.instance._selectionPromise = new Promise((resolve) => {
                ModuleExtractorPanel.instance!._resolveSelection = resolve;
            });
            
            return ModuleExtractorPanel.instance._selectionPromise!;
        }
        
        // Fallback if instance creation failed
        return Promise.reject(new Error('Failed to create webview panel'));
    }

    private constructor(
        panel: vscode.WebviewPanel,
        private readonly _extensionUri: vscode.Uri,
        workspaceFolder: vscode.WorkspaceFolder
    ) {
        this._panel = panel;
        this._fileSearchProvider = new FileSearchProvider(workspaceFolder);
        
        // Set the webview's initial html content
        this._update();
        
        // Listen for when the panel is disposed
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        
        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'selectDirectory':
                        this._selectDirectory(message.path);
                        break;
                    case 'confirmSelection':
                        this._confirmSelection();
                        break;
                    case 'cancel':
                        this._cancel();
                        break;
                    case 'ready':
                        this._loadInitialData();
                        break;
                }
            },
            undefined,
            this._disposables
        );
    }
    
    public updateData(moduleName: string, selectedCode: string, analysisResult: any) {
        this._moduleName = moduleName;
        this._selectedCode = selectedCode;
        this._analysisResult = analysisResult;
        this._panel?.webview.postMessage({
            command: 'updateData',
            moduleName,
            selectedCode,
            analysisResult
        });
    }

    private async _loadInitialData() {
        // Update the current path display
        this._panel?.webview.postMessage({
            command: 'updateCurrentPath',
            currentPath: this._currentPath
        });
        
        // Load directory items
        this._loadDirectoryItems(this._currentPath);
    }
    
    private async _selectDirectory(dirPath: string) {
        this._currentPath = dirPath;
        this._loadDirectoryItems(dirPath);
    }
    
    private async _confirmSelection() {
        if (this._resolveSelection) {
            this._resolveSelection(path.join(this._currentPath, `${this._moduleName}.rs`));
            this._resolveSelection = undefined;
        }
        this._panel?.dispose();
    }
    
    private _cancel() {
        if (this._resolveSelection) {
            this._resolveSelection(undefined);
            this._resolveSelection = undefined;
        }
        this._panel?.dispose();
    }
    
    private async _loadDirectoryItems(currentPath: string) {
        const config = vscode.workspace.getConfiguration('rustyRefactor');
        const rustyRoadMode = config.get<boolean>('rustyRoadMode', true);
        
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) return;
        
        try {
            // Get file system entries
            const fullPath = path.join(workspaceFolder.uri.fsPath, currentPath);
            let directories: any[] = [];
            let moduleFiles: any[] = [];
            let suggestions: any[] = [];
            
            // Get items using FileSearchProvider logic
            if (!fs.existsSync(fullPath)) {
                // Directory doesn't exist, offer to create suggested directories
                if (rustyRoadMode && currentPath === 'src') {
                    const suggestedDirs = ['controllers', 'models', 'views', 'services', 'middleware', 'helpers', 'lib', 'utils', 'config', 'routes', 'handlers', 'repositories', 'domain'];
                    for (const suggestedDir of suggestedDirs) {
                        suggestions.push({
                            name: suggestedDir,
                            type: 'suggestion',
                            path: path.join(currentPath, suggestedDir),
                            icon: 'new-folder'
                        });
                    }
                }
            } else {
                // Read existing directories and files
                const entries = fs.readdirSync(fullPath, { withFileTypes: true });
                
                // Check for module files that could be converted
                if (this._moduleName && isNativeModuleAvailable()) {
                    const moduleFilesFiltered = entries.filter(entry => 
                        entry.isFile() && 
                        entry.name.endsWith('.rs') && 
                        entry.name !== 'mod.rs' &&
                        entry.name !== 'lib.rs' &&
                        entry.name !== 'main.rs'
                    );
                    
                    for (const file of moduleFilesFiltered) {
                        const fileModuleName = file.name.slice(0, -3);
                        try {
                            const conversionInfo = await checkModuleConversion(
                                workspaceFolder.uri.fsPath,
                                path.join(currentPath, `${fileModuleName}.rs`),
                                fileModuleName
                            );
                            
                            if (conversionInfo.needs_conversion) {
                                moduleFiles.push({
                                    name: fileModuleName,
                                    type: 'module-file',
                                    path: path.join(currentPath, fileModuleName),
                                    icon: 'file-code',
                                    description: 'Can be converted to folder',
                                    detail: `Convert ${fileModuleName}.rs to ${fileModuleName}/mod.rs`
                                });
                            }
                        } catch (error) {
                            console.error('Error checking module conversion:', error);
                        }
                    }
                }
                
                // Get existing directories
                for (const entry of entries) {
                    if (entry.isDirectory() && 
                        !entry.name.startsWith('.') && 
                        entry.name !== 'target' && 
                        entry.name !== 'node_modules') {
                        
                        const itemPath = path.join(currentPath, entry.name);
                        const isRustyRoadDir = rustyRoadMode && ['controllers', 'models', 'views', 'services', 'middleware', 'helpers', 'lib', 'utils', 'config', 'routes', 'handlers', 'repositories', 'domain'].includes(entry.name);
                        
                        directories.push({
                            name: entry.name,
                            type: 'directory',
                            path: itemPath,
                            icon: 'folder',
                            description: isRustyRoadDir ? 'RustyRoad convention' : ''
                        });
                    }
                }
            }
            
            // Sort directories
            directories.sort((a, b) => a.name.localeCompare(b.name));
            
            // Send data to webview
            this._panel?.webview.postMessage({
                command: 'updateDirectory',
                currentPath,
                parentPath: path.dirname(currentPath),
                directories,
                moduleFiles,
                suggestions,
                breadcrumb: this._generateBreadcrumb(currentPath)
            });
            
        } catch (error) {
            console.error('Error loading directory items:', error);
        }
    }
    
    private _generateBreadcrumb(currentPath: string): string[] {
        const parts = currentPath.split(path.sep);
        const breadcrumb: string[] = [];
        let pathSoFar = '';
        
        for (const part of parts) {
            pathSoFar = pathSoFar ? path.join(pathSoFar, part) : part;
            breadcrumb.push(part);
        }
        
        return breadcrumb;
    }

    private _update() {
        const webview = this._panel!.webview;
        
        webview.html = this._getHtmlForWebview(webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // Get path to resource on disk
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'styles.css')
        );
        
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'main.js')
        );
        
        const codiconsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css')
        );

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="
                    default-src 'none';
                    script-src ${webview.cspSource};
                    style-src ${webview.cspSource} ${codiconsUri};
                    font-src ${webview.cspSource};
                    img-src ${webview.cspSource} data:;
                ">
                <link href="${codiconsUri}" rel="stylesheet" />
                <link href="${styleUri}" rel="stylesheet" />
                <title>Module Extractor</title>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h2 class="title"><i class="codicon codicon-export"></i> Module Extractor</h2>
                    </div>
                    
                    <div class="info-section">
                        <div class="module-info">
                            <div class="info-item">
                                <label>Module Name:</label>
                                <span class="module-name">${this._moduleName}</span>
                            </div>
                            <div class="info-item">
                                <label>Selected Code:</label>
                                <span class="code-preview">${this._selectedCode.substring(0, 100)}${this._selectedCode.length > 100 ? '...' : ''}</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="breadcrumb-container">
                        <div class="breadcrumb" id="breadcrumb">
                            <!-- Breadcrumb will be populated by JavaScript -->
                        </div>
                    </div>
                    
                    <div class="content">
                        <div class="sidebar">
                            <div class="file-tree">
                                <div class="tree-header">
                                    <div class="current-path">Current: ${this._currentPath}</div>
                                </div>
                                <div id="file-tree-content" class="tree-content">
                                    <!-- Tree will be populated by JavaScript -->
                                </div>
                            </div>
                        </div>
                        
                        <div class="main-content">
                            <div class="actions">
                                <button id="cancel-btn" class="btn btn-secondary">
                                    <i class="codicon codicon-x"></i> Cancel
                                </button>
                                <button id="create-btn" class="btn btn-primary" disabled>
                                    <i class="codicon codicon-check"></i> Extract to <span class="highlight">${this._moduleName}.rs</span>
                                </button>
                            </div>
                            
                            <div class="conversion-info" id="conversion-info" style="display: none;">
                                <div class="info-box warning">
                                    <i class="codicon codicon-warning"></i>
                                    <div>
                                        <strong>Module Conversion Required</strong>
                                        <p>The selected module is currently a file and will be converted to a folder structure.</p>
                                    </div>
                                </div>
                            </div>
                            
                            <div class="help-info">
                                <h3><i class="codicon codicon-info"></i> How to use</h3>
                                <ol>
                                    <li>Select a destination directory from the file tree</li>
                                    <li>Click "Create module here" to extract to the current directory</li>
                                    <li>Click on any directory to navigate into it</li>
                                    <li>Module files (with file icon) can be converted to_folder structure</li>
                                </ol>
                            </div>
                        </div>
                    </div>
                </div>
                
                <script src="${scriptUri}"></script>
            </body>
            </html>
        `;
    }

    public dispose() {
        ModuleExtractorPanel.instance = undefined;
        if (this._resolveSelection) {
            this._resolveSelection(undefined);
        }
        
        this._panel?.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
}