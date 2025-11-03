import * as vscode from 'vscode';
import * as path from 'path'; // Used for string path manipulation only; use vscode.Uri for file system operations
import { FileSearchProvider } from '../fileSearchProvider';
import { checkModuleConversion, isNativeModuleAvailable } from '../nativeBridge';

export class ModuleExtractorPanel {
    public static readonly viewType = 'moduleExtractor';
    private static readonly RUSTY_ROAD_DIRECTORIES: readonly string[] = [
        'controllers',
        'models',
        'views',
        'services',
        'middleware',
        'helpers',
        'lib',
        'utils',
        'config',
        'routes',
        'handlers',
        'repositories',
        'domain'
    ];
    private static instance?: ModuleExtractorPanel;
    private static outputChannel?: vscode.OutputChannel;
    
    /**
     * Sets the output channel for logging messages from ModuleExtractorPanel.
     * 
     * This must be called during extension activation to enable output channel logging.
     * 
     * @param channel The VS Code OutputChannel to use for logging.
     */
    public static setOutputChannel(channel: vscode.OutputChannel) {
        ModuleExtractorPanel.outputChannel = channel;
    }
    
    private static log(message: string) {
        if (ModuleExtractorPanel.outputChannel) {
            ModuleExtractorPanel.outputChannel.appendLine(`[ModuleExtractorPanel] ${message}`);
        }
        console.log(`[ModuleExtractorPanel] ${message}`);
    }
    
    private _panel: vscode.WebviewPanel | undefined;
    private _disposables: vscode.Disposable[] = [];
    private _fileSearchProvider: FileSearchProvider;
    private _workspaceFolder: vscode.WorkspaceFolder;
    private _currentPath: string = '';
    private _moduleName: string = '';
    private _selectedCode: string = '';
    private _analysisResult: any;
    private _disposed = false; // Prevent re-entrant dispose loops
    
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
        ModuleExtractorPanel.log(`createOrShow called for module: ${moduleName}`);
        if (ModuleExtractorPanel.instance) {
            ModuleExtractorPanel.log('Reusing existing panel instance');
            ModuleExtractorPanel.instance._panel?.reveal();
            ModuleExtractorPanel.instance.updateData(moduleName, selectedCode, analysisResult);
            return ModuleExtractorPanel.instance;
        }
        
        ModuleExtractorPanel.log('Creating new webview panel');
        const panel = vscode.window.createWebviewPanel(
            ModuleExtractorPanel.viewType,
            'Module Extractor',
            vscode.ViewColumn.Two, // Open in side panel
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        );
        
        ModuleExtractorPanel.log('Webview panel created successfully');
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
        ModuleExtractorPanel.log(`show called for module: ${moduleName}`);
        if (!ModuleExtractorPanel.instance) {
            ModuleExtractorPanel.createOrShow(extensionUri, workspaceFolder, moduleName, selectedCode, analysisResult);
        } else {
            ModuleExtractorPanel.log('Updating existing panel');
            ModuleExtractorPanel.instance.updateData(moduleName, selectedCode, analysisResult);
            ModuleExtractorPanel.instance._panel?.reveal();
        }
        
        // Create a new promise for this selection
        if (ModuleExtractorPanel.instance) {
            ModuleExtractorPanel.log('Creating selection promise');
            ModuleExtractorPanel.instance._selectionPromise = new Promise((resolve) => {
                ModuleExtractorPanel.instance!._resolveSelection = resolve;
            });
            
            return ModuleExtractorPanel.instance._selectionPromise!;
        }
        
        // Fallback if instance creation failed
        ModuleExtractorPanel.log('ERROR: Failed to create panel instance');
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
                try {
                    ModuleExtractorPanel.log(`Received message from webview: ${message.command}`);
                    
                    switch (message.command) {
                        case 'selectDirectory':
                            ModuleExtractorPanel.log(`Selecting directory: ${message.path}`);
                            await this._selectDirectory(message.path);
                            break;
                        case 'confirmSelection':
                            ModuleExtractorPanel.log('Confirming selection');
                            this._confirmSelection();
                            break;
                        case 'cancel':
                            ModuleExtractorPanel.log('Cancelling');
                            this._cancel();
                            break;
                        case 'ready':
                            ModuleExtractorPanel.log('Webview is ready, loading initial data');
                            await this._loadInitialData();
                            break;
                        case 'log':
                            // Handle log messages from webview
                            if (message.level && message.message) {
                                const logMessage = `[Webview] ${message.message}`;
                                if (message.data) {
                                    ModuleExtractorPanel.log(`${logMessage} - ${JSON.stringify(message.data)}`);
                                } else {
                                    ModuleExtractorPanel.log(logMessage);
                                }
                            }
                            break;
                        default:
                            ModuleExtractorPanel.log(`Unknown message command: ${message.command}`);
                            break;
                    }
                } catch (error) {
                    ModuleExtractorPanel.log(`Error handling webview message: ${error instanceof Error ? error.message : 'Unknown error'}`);
                    console.error('Error handling webview message:', error);
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
        
        // Send update immediately if webview is ready, otherwise it will be sent when ready message is received
        this._panel?.webview.postMessage({
            command: 'updateData',
            moduleName,
            selectedCode,
            analysisResult
        });
    }

    private async _loadInitialData() {
        ModuleExtractorPanel.log(`Loading initial data for path: ${this._currentPath}`);
        console.log('Loading initial data for path:', this._currentPath);
        
        try {
            // Send the current data to webview first
            this._panel?.webview.postMessage({
                command: 'updateData',
                moduleName: this._moduleName,
                selectedCode: this._selectedCode,
                analysisResult: this._analysisResult
            });
            
            // Load directory items - this will also update the current path display
            await this._loadDirectoryItems(this._currentPath);
            ModuleExtractorPanel.log('Initial data loaded successfully');
            console.log('Initial data loaded successfully');
        } catch (error) {
            ModuleExtractorPanel.log(`Error loading initial data: ${error instanceof Error ? error.message : 'Unknown error'}`);
            console.error('Error loading initial data:', error);
            
            // Send error state to webview
            this._panel?.webview.postMessage({
                command: 'updateDirectory',
                currentPath: this._currentPath,
                parentPath: this._parentPath(this._currentPath),
                directories: [],
                moduleFiles: [],
                suggestions: [],
                breadcrumb: this._generateBreadcrumb(this._currentPath),
                error: 'Failed to load directory contents'
            });
        }
    }
    
    private async _selectDirectory(dirPath: string) {
        this._currentPath = dirPath;
        this._loadDirectoryItems(dirPath);
    }
    
    private async _confirmSelection() {
        if (this._resolveSelection) {
            const modulePath = this._joinPath(this._currentPath, `${this._moduleName}.rs`);
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
    private async _loadDirectoryItems(currentPath: string): Promise<void> {
        ModuleExtractorPanel.log(`Loading directory items for: ${currentPath}`);
        console.log(`Loading directory items for: ${currentPath}`);
        
        const config = vscode.workspace.getConfiguration('rustyRefactor');
        const rustyRoadMode = config.get<boolean>('rustyRoadMode', true);
        ModuleExtractorPanel.log(`RustyRoad mode: ${rustyRoadMode}`);

        const directories: Array<{ name: string; type: string; path: string; icon: string; description?: string }> = [];
        const moduleFiles: Array<{ name: string; type: string; path: string; icon: string; description: string; detail: string }> = [];
        const suggestions: Array<{ name: string; type: string; path: string; icon: string }> = [];

        const directoryUri = this._toUri(currentPath);
        ModuleExtractorPanel.log(`Directory URI: ${directoryUri.fsPath}`);
        let entries: readonly [string, vscode.FileType][] = [];
        let directoryExists = true;

        try {
            entries = await vscode.workspace.fs.readDirectory(directoryUri);
            ModuleExtractorPanel.log(`Successfully read ${entries.length} entries from ${currentPath}`);
            console.log(`Successfully read ${entries.length} entries from ${currentPath}`);
        } catch (error) {
            directoryExists = false;
            ModuleExtractorPanel.log(`Error reading directory ${currentPath}: ${error}`);
            console.error(`Error reading directory ${currentPath}:`, error);
            if (!(error instanceof vscode.FileSystemError && error.code === 'FileNotFound')) {
                vscode.window.showErrorMessage(`Failed to read directory: ${currentPath}`);
            }
        }

        if (directoryExists) {
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
                            this._joinPath(currentPath, `${fileModuleName}.rs`),
                            fileModuleName
                        );

                        if (conversionInfo.needs_conversion) {
                            moduleFiles.push({
                                name: fileModuleName,
                                type: 'module-file',
                                path: this._joinPath(currentPath, fileModuleName),
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

                const itemPath = this._joinPath(currentPath, name);
                const isRustyRoadDir = rustyRoadMode && this._isRustyRoadDirectory(name);

                directories.push({
                    name,
                    type: 'directory',
                    path: itemPath,
                    icon: 'folder',
                    description: isRustyRoadDir ? 'RustyRoad convention' : ''
                });
            }
        }

        if (rustyRoadMode && currentPath === 'src' && (directories.length === 0 || !directoryExists)) {
            for (const suggestedDir of this._rustyRoadSuggestions()) {
                suggestions.push({
                    name: suggestedDir,
                    type: 'suggestion',
                    path: this._joinPath(currentPath, suggestedDir),
                    icon: 'new-folder'
                });
            }
        }

        directories.sort((a, b) => a.name.localeCompare(b.name));

        const updateMessage = {
            command: 'updateDirectory',
            currentPath,
            parentPath: this._parentPath(currentPath),
            directories,
            moduleFiles,
            suggestions,
            breadcrumb: this._generateBreadcrumb(currentPath)
        };

        ModuleExtractorPanel.log(`Sending updateDirectory message with ${directories.length} dirs, ${moduleFiles.length} files, ${suggestions.length} suggestions`);
        console.log('Sending updateDirectory message with data:', updateMessage);
        this._panel?.webview.postMessage(updateMessage);
    }

    private _splitPath(pathValue: string): string[] {
        return pathValue
            .split(/[\\/]/)
            .map((segment) => segment.trim())
            .filter(Boolean);
    }

    private _normalizePath(relativePath: string): string {
        const segments = this._splitPath(relativePath);
        if (segments.length === 0) {
            return '';
        }
        return path.posix.join(...segments);
    }

    private _joinPath(...parts: string[]): string {
        const segments = parts.flatMap((part) => this._splitPath(part));
        if (segments.length === 0) {
            return '';
        }
        return path.posix.join(...segments);
    }

    private _parentPath(relativePath: string): string {
        const normalized = this._normalizePath(relativePath);
        if (!normalized) {
            return '';
        }

        if (normalized === 'src') {
            return '';
        }

        const segments = this._splitPath(normalized);
        if (segments.length <= 1) {
            return '';
        }

        return segments.slice(0, -1).join('/');
    }

    private _toUri(relativePath: string): vscode.Uri {
        const segments = this._splitPath(relativePath);
        return vscode.Uri.joinPath(this._workspaceFolder.uri, ...segments);
    }

    private _isRustyRoadDirectory(name: string): boolean {
        return ModuleExtractorPanel.RUSTY_ROAD_DIRECTORIES.includes(name);
    }

    private _rustyRoadSuggestions(): readonly string[] {
        return ModuleExtractorPanel.RUSTY_ROAD_DIRECTORIES;
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
        // Get path to built webview resources
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'module-extractor.css')
        );
        
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'module-extractor.js')
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
                    script-src ${webview.cspSource} 'unsafe-inline';
                    style-src ${webview.cspSource} ${codiconsUri} 'unsafe-inline';
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
                                <span id="module-name" class="module-name">Loading...</span>
                            </div>
                            <div class="info-item">
                                <label>Selected Code:</label>
                                <span id="code-preview" class="code-preview">Loading...</span>
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
                                    <i class="codicon codicon-check"></i> Extract to <span class="highlight">Loading...</span>
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
                
                <script>
                    console.log('[Webview] HTML loaded, script starting...');
                    window.addEventListener('error', (e) => {
                        console.error('[Webview] Global error:', e.error || e.message);
                    });
                </script>
                <script src="${scriptUri}"></script>
            </body>
            </html>
        `;
    }

    public dispose() {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        ModuleExtractorPanel.instance = undefined;
        if (this._resolveSelection) {
            this._resolveSelection(undefined);
            this._resolveSelection = undefined;
        }
        const panel = this._panel;
        this._panel = undefined;
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
        panel?.dispose();
    }
}
