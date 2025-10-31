import * as vscode from 'vscode';
import * as path from 'path'; // Used for string path manipulation only; use vscode.Uri for file system operations
import { FileSearchProvider } from '../fileSearchProvider';
import { checkModuleConversion, isNativeModuleAvailable } from '../nativeBridge';

export class ModuleExtractorPanel {
    public static readonly viewType = 'moduleExtractor';
    private static instance?: ModuleExtractorPanel;
    
    private _panel: vscode.WebviewPanel | undefined;
    private _disposables: vscode.Disposable[] = [];
    private _fileSearchProvider: FileSearchProvider;
    private _workspaceFolder: vscode.WorkspaceFolder;
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
        this._workspaceFolder = workspaceFolder;
        
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
        
        // Update HTML after setting up message handlers
        this._update();
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
            // Use POSIX join for VS Code compatibility
            const modulePath = this._currentPath.endsWith('/') || this._currentPath.endsWith('\\')
                ? `${this._currentPath}${this._moduleName}.rs`
                : `${this._currentPath}/${this._moduleName}.rs`;
            this._resolveSelection(modulePath);
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
    
        const segments = currentPath.split(path.sep).filter(Boolean);
        const config = vscode.workspace.getConfiguration('rustyRefactor');
        const rustyRoadMode = config.get<boolean>('rustyRoadMode', true);
        const baseUri = this._workspaceFolder.uri;
        const segments = currentPath.split(/[\\/]/).filter(Boolean);
        const directoryUri = segments.length > 0 ? vscode.Uri.joinPath(baseUri, ...segments) : baseUri;

        const directories: any[] = [];
        const moduleFiles: any[] = [];
        const suggestions: any[] = [];

        try {
            const entries = await vscode.workspace.fs.readDirectory(directoryUri);

            // Check for module files that could be converted
            if (this._moduleName && isNativeModuleAvailable()) {
                const moduleCandidates = entries.filter(([name, type]) =>
                    type === vscode.FileType.File &&
                    name.endsWith('.rs') &&
                    name !== 'mod.rs' &&
                    name !== 'lib.rs' &&
                    name !== 'main.rs'
                );

                for (const [fileName] of moduleCandidates) {
                    const fileModuleName = fileName.slice(0, -3);
                    try {
                        const conversionInfo = await checkModuleConversion(
                            this._workspaceFolder.uri.fsPath,
                            `${currentPath}/${fileModuleName}.rs`,
                            fileModuleName
                        );

                        if (conversionInfo.needs_conversion) {
                            moduleFiles.push({
                                name: fileModuleName,
                                type: 'module-file',
                                path: `${currentPath}/${fileModuleName}`,
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

            for (const [name, type] of entries) {
                if (type !== vscode.FileType.Directory) {
                    continue;
                }

                if (name.startsWith('.') || name === 'target' || name === 'node_modules') {
                    continue;
                }

                const itemPath = `${currentPath}/${name}`;
                const isRustyRoadDir = rustyRoadMode && ['controllers', 'models', 'views', 'services', 'middleware', 'helpers', 'lib', 'utils', 'config', 'routes', 'handlers', 'repositories', 'domain'].includes(name);

                directories.push({
                    name,
                    type: 'directory',
                    path: itemPath,
                    icon: 'folder',
                    description: isRustyRoadDir ? 'RustyRoad convention' : ''
                });
            }
        } catch (error) {
            // Directory may not exist yet; offer suggestions for root path
            console.warn(`Directory ${currentPath} not found, providing suggestions`, error);
        }

        if (rustyRoadMode && currentPath === 'src' && directories.length === 0) {
            const suggestedDirs = ['controllers', 'models', 'views', 'services', 'middleware', 'helpers', 'lib', 'utils', 'config', 'routes', 'handlers', 'repositories', 'domain'];
            for (const suggestedDir of suggestedDirs) {
                suggestions.push({
                    name: suggestedDir,
                    type: 'suggestion',
                    path: `${currentPath}/${suggestedDir}`,
                    icon: 'new-folder'
                });
            }
        }

        directories.sort((a, b) => a.name.localeCompare(b.name));

        const updateMessage = {
            command: 'updateDirectory',
            currentPath,
            parentPath: currentPath.includes(path.sep) ? currentPath.slice(0, currentPath.lastIndexOf(path.sep)) : '',
            directories,
            moduleFiles,
            suggestions,
            breadcrumb: this._generateBreadcrumb(currentPath)
        };

        this._panel?.webview.postMessage(updateMessage);
    }
    
    private _generateBreadcrumb(currentPath: string): string[] {
        const parts = currentPath.split(/[\\/]/).filter(Boolean);
        const breadcrumb: string[] = [];
        let pathSoFar = '';
        
        for (const part of parts) {
            pathSoFar = pathSoFar ? `${pathSoFar}/${part}` : part;
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
                                    <li>Module files (with file icon) can be converted to folder structure</li>
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