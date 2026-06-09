import * as path from 'path';
import * as vscode from 'vscode';
import { FileSearchProvider } from '../fileSearchProvider';
import {
    checkModuleConversion,
    isNativeModuleAvailable,
} from '../nativeBridge';

interface TreeItem {
    name: string;
    type: string;
    path: string;
    icon: string;
    description?: string;
    detail?: string;
}

interface DirectoryMessage {
    command: 'updateDirectory';
    currentPath: string;
    parentPath: string;
    directories: TreeItem[];
    moduleFiles: TreeItem[];
    suggestions: TreeItem[];
    breadcrumb: string[];
    error?: string;
}

interface WebviewMessage {
    command: string;
    path?: string;
    selectedPath?: string;
    level?: string;
    message?: string;
    data?: unknown;
}

/**
 * Presents a VS Code webview for choosing a Rust module destination.
 *
 * The panel owns only webview lifecycle and message coordination. Path
 * normalization and directory enumeration are kept in small helpers so that
 * each operation has one clear reason to change.
 */
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
        'domain',
    ];

    private static instance?: ModuleExtractorPanel;
    private static outputChannel?: vscode.OutputChannel;

    private _panel: vscode.WebviewPanel | undefined;
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _fileSearchProvider: FileSearchProvider;
    private readonly _workspaceFolder: vscode.WorkspaceFolder;
    private _currentPath = '';
    private _moduleName = '';
    private _selectedCode = '';
    private _analysisResult: unknown;
    private _disposed = false;
    private _selectionPromise?: Promise<string | undefined>;
    private _resolveSelection?: (value: string | undefined) => void;

    /**
     * Registers the shared extension output channel used for diagnostics.
     *
     * The panel still mirrors messages to the developer console, but this
     * channel gives users a stable place to inspect extension-side failures.
     */
    public static setOutputChannel(channel: vscode.OutputChannel): void {
        ModuleExtractorPanel.outputChannel = channel;
    }

    /**
     * Opens an existing module extractor panel or creates a new one.
     *
     * Reusing the singleton prevents competing prompts from resolving with
     * different destinations while still allowing the shown data to refresh.
     */
    public static createOrShow(
        extensionUri: vscode.Uri,
        workspaceFolder: vscode.WorkspaceFolder,
        moduleName: string,
        selectedCode: string,
        analysisResult: unknown,
    ): ModuleExtractorPanel {
        if (ModuleExtractorPanel.instance) {
            ModuleExtractorPanel.instance._panel?.reveal();
            ModuleExtractorPanel.instance.updateData(
                moduleName,
                selectedCode,
                analysisResult,
            );
            return ModuleExtractorPanel.instance;
        }

        const panel = vscode.window.createWebviewPanel(
            ModuleExtractorPanel.viewType,
            'Module Extractor',
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            },
        );

        const provider = new ModuleExtractorPanel(
            panel,
            extensionUri,
            workspaceFolder,
        );
        provider.updateData(moduleName, selectedCode, analysisResult);
        ModuleExtractorPanel.instance = provider;

        return provider;
    }

    /**
     * Shows the picker and resolves with the selected relative module path.
     *
     * The returned promise resolves with undefined when the user cancels or
     * closes the webview before confirming a destination.
     */
    public static show(
        moduleName: string,
        selectedCode: string,
        analysisResult: unknown,
        workspaceFolder: vscode.WorkspaceFolder,
        extensionUri: vscode.Uri,
    ): Promise<string | undefined> {
        const panel = ModuleExtractorPanel.createOrShow(
            extensionUri,
            workspaceFolder,
            moduleName,
            selectedCode,
            analysisResult,
        );

        panel._selectionPromise = new Promise((resolve) => {
            panel._resolveSelection = resolve;
        });

        return panel._selectionPromise;
    }

    /**
     * Creates a panel coordinator and wires VS Code webview events.
     *
     * The constructor does not load filesystem data. It only establishes the
     * shell and waits for the browser context to send its ready message.
     */
    private constructor(
        panel: vscode.WebviewPanel,
        private readonly _extensionUri: vscode.Uri,
        workspaceFolder: vscode.WorkspaceFolder,
    ) {
        this._panel = panel;
        this._fileSearchProvider = new FileSearchProvider(workspaceFolder);
        this._workspaceFolder = workspaceFolder;

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            (message) => this._handleMessage(message),
            undefined,
            this._disposables,
        );
        this._updateHtml();
    }

    /**
     * Sends new extraction context to the browser side of the webview.
     *
     * This method may be called before the browser is ready; the same data is
     * sent again when the ready message arrives to avoid missed updates.
     */
    public updateData(
        moduleName: string,
        selectedCode: string,
        analysisResult: unknown,
    ): void {
        this._moduleName = moduleName;
        this._selectedCode = selectedCode;
        this._analysisResult = analysisResult;

        this._panel?.webview.postMessage({
            command: 'updateData',
            moduleName,
            selectedCode,
            analysisResult,
        });
    }

    /**
     * Releases VS Code resources and resolves any pending selection prompt.
     *
     * The disposed guard avoids re-entrant loops because disposing the VS Code
     * panel also raises an onDidDispose event.
     */
    public dispose(): void {
        if (this._disposed) {
            return;
        }

        this._disposed = true;
        ModuleExtractorPanel.instance = undefined;
        this._resolveSelection?.(undefined);
        this._resolveSelection = undefined;

        const panel = this._panel;
        this._panel = undefined;

        while (this._disposables.length) {
            this._disposables.pop()?.dispose();
        }

        panel?.dispose();
    }

    /**
     * Routes browser-originated commands to focused panel operations.
     *
     * Unknown commands are logged rather than thrown so the webview remains
     * usable if an older script sends a stale message.
     */
    private async _handleMessage(message: WebviewMessage): Promise<void> {
        try {
            switch (message.command) {
                case 'selectDirectory':
                    await this._selectDirectory(message.path ?? '');
                    return;
                case 'confirmSelection':
                    this._confirmSelection(message.selectedPath);
                    return;
                case 'cancel':
                    this._cancel();
                    return;
                case 'ready':
                    await this._loadInitialData();
                    return;
                case 'log':
                    this._logWebviewMessage(message);
                    return;
                default:
                    ModuleExtractorPanel.log(
                        `Unknown webview command: ${message.command}`,
                    );
            }
        } catch (error) {
            ModuleExtractorPanel.log(this._errorText(
                'Error handling webview message',
                error,
            ));
        }
    }

    /**
     * Mirrors user-visible webview warnings and errors to the output channel.
     *
     * Debug and info messages are intentionally ignored to keep normal module
     * extraction sessions quiet.
     */
    private _logWebviewMessage(message: WebviewMessage): void {
        if (message.level !== 'warn' && message.level !== 'error') {
            return;
        }

        const details = message.data ? ` ${JSON.stringify(message.data)}` : '';
        ModuleExtractorPanel.log(`[Webview] ${message.message}${details}`);
    }

    /**
     * Replays the current extraction context and loads the current directory.
     *
     * Errors are converted into an empty directory update so the browser can
     * present a recoverable error state instead of hanging on loading UI.
     */
    private async _loadInitialData(): Promise<void> {
        try {
            this.updateData(
                this._moduleName,
                this._selectedCode,
                this._analysisResult,
            );
            await this._loadDirectoryItems(this._currentPath);
        } catch (error) {
            ModuleExtractorPanel.log(this._errorText(
                'Error loading initial data',
                error,
            ));
            this._postDirectoryMessage({
                command: 'updateDirectory',
                currentPath: this._currentPath,
                parentPath: this._parentPath(this._currentPath),
                directories: [],
                moduleFiles: [],
                suggestions: [],
                breadcrumb: this._generateBreadcrumb(this._currentPath),
                error: 'Failed to load directory contents.',
            });
        }
    }

    /**
     * Updates the selected directory and refreshes the browser-side tree.
     *
     * The incoming value is normalized to remain relative to the workspace
     * before it is used for filesystem reads or display.
     */
    private async _selectDirectory(dirPath: string): Promise<void> {
        this._currentPath = this._normalizePath(dirPath);
        await this._loadDirectoryItems(this._currentPath);
    }

    /**
     * Resolves the prompt with the selected module file path.
     *
     * The path is relative to the workspace because downstream extraction
     * commands require workspace-relative module destinations.
     */
    private _confirmSelection(selectedPath?: string): void {
        const destination = this._normalizePath(
            selectedPath ?? this._currentPath,
        );
        const modulePath = this._joinPath(
            destination,
            `${this._moduleName}.rs`,
        );
        this._resolveSelection?.(modulePath);
        this._resolveSelection = undefined;
        this._panel?.dispose();
    }

    /**
     * Resolves the prompt without a destination and closes the panel.
     *
     * This keeps cancellation behavior identical whether the user presses the
     * cancel button or closes the webview tab.
     */
    private _cancel(): void {
        this._resolveSelection?.(undefined);
        this._resolveSelection = undefined;
        this._panel?.dispose();
    }

    /**
     * Reads directory contents and posts a tree update to the browser.
     *
     * Missing folders are tolerated so RustyRoad suggestions can still guide
     * users toward conventional directories that do not exist yet.
     */
    private async _loadDirectoryItems(currentPath: string): Promise<void> {
        const config = vscode.workspace.getConfiguration('rustyRefactor');
        const rustyRoadMode = config.get<boolean>('rustyRoadMode', true);
        const directoryUri = this._toUri(currentPath);
        const directories: TreeItem[] = [];
        const moduleFiles: TreeItem[] = [];
        const suggestions: TreeItem[] = [];
        let entries: readonly [string, vscode.FileType][] = [];
        let directoryExists = true;

        try {
            entries = await vscode.workspace.fs.readDirectory(directoryUri);
        } catch (error) {
            directoryExists = false;
            this._showDirectoryError(currentPath, error);
        }

        if (directoryExists) {
            const convertibleFiles = await this._moduleFileItems(
                entries,
                currentPath,
            );
            moduleFiles.push(...convertibleFiles);
            directories.push(...this._directoryItems(
                entries,
                currentPath,
                rustyRoadMode,
            ));
        }

        if (this._shouldShowSuggestions(
            currentPath,
            directories.length,
            directoryExists,
            rustyRoadMode,
        )) {
            suggestions.push(...this._suggestionItems(currentPath));
        }

        directories.sort((a, b) => a.name.localeCompare(b.name));
        this._postDirectoryMessage({
            command: 'updateDirectory',
            currentPath,
            parentPath: this._parentPath(currentPath),
            directories,
            moduleFiles,
            suggestions,
            breadcrumb: this._generateBreadcrumb(currentPath),
        });
    }

    /**
     * Shows non-missing directory read errors without blocking rendering.
     *
     * File-not-found errors are expected when displaying suggested folders, so
     * those errors are omitted from VS Code notifications.
     */
    private _showDirectoryError(relativePath: string, error: unknown): void {
        const isMissing = error instanceof vscode.FileSystemError &&
            error.code === 'FileNotFound';

        if (!isMissing) {
            void vscode.window.showErrorMessage(
                `Failed to read directory: ${relativePath}`,
            );
        }
    }

    /**
     * Builds tree items for module files that can become module folders.
     *
     * Native conversion checks may fail per file; individual failures are
     * logged and skipped so the rest of the directory remains browsable.
     */
    private async _moduleFileItems(
        entries: readonly [string, vscode.FileType][],
        currentPath: string,
    ): Promise<TreeItem[]> {
        if (!this._moduleName || !isNativeModuleAvailable()) {
            return [];
        }

        const items: TreeItem[] = [];
        for (const [fileName, fileType] of entries) {
            if (!this._isConvertibleRustFile(fileName, fileType)) {
                continue;
            }

            const fileModuleName = fileName.slice(0, -3);
            try {
                const conversionInfo = await checkModuleConversion(
                    this._workspaceFolder.uri.fsPath,
                    this._joinPath(currentPath, fileName),
                    fileModuleName,
                );

                if (conversionInfo.needs_conversion) {
                    items.push(this._moduleFileItem(
                        currentPath,
                        fileModuleName,
                    ));
                }
            } catch (error) {
                ModuleExtractorPanel.log(this._errorText(
                    `Failed checking ${fileName}`,
                    error,
                ));
            }
        }

        return items;
    }

    /**
     * Returns whether an entry is a Rust file eligible for folder conversion.
     *
     * Root module files are excluded because converting them would change the
     * crate entrypoint rather than a normal child module.
     */
    private _isConvertibleRustFile(
        name: string,
        fileType: vscode.FileType,
    ): boolean {
        return fileType === vscode.FileType.File &&
            name.endsWith('.rs') &&
            name !== 'mod.rs' &&
            name !== 'lib.rs' &&
            name !== 'main.rs';
    }

    /**
     * Creates the tree item representing a convertible module file.
     *
     * The item path intentionally points at the module folder destination, not
     * the existing file, because confirmation creates a child module there.
     */
    private _moduleFileItem(
        currentPath: string,
        fileModuleName: string,
    ): TreeItem {
        return {
            name: fileModuleName,
            type: 'module-file',
            path: this._joinPath(currentPath, fileModuleName),
            icon: 'file-code',
            description: 'Can be converted to folder',
            detail: `Convert ${fileModuleName}.rs to ${fileModuleName}/mod.rs`,
        };
    }

    /**
     * Creates tree items for visible child directories.
     *
     * Hidden folders and generated dependency/build folders are omitted because
     * they are poor module extraction destinations.
     */
    private _directoryItems(
        entries: readonly [string, vscode.FileType][],
        currentPath: string,
        rustyRoadMode: boolean,
    ): TreeItem[] {
        return entries
            .filter(([name, fileType]) => (
                fileType === vscode.FileType.Directory &&
                !this._isHiddenOrGeneratedDirectory(name)
            ))
            .map(([name]) => ({
                name,
                type: 'directory',
                path: this._joinPath(currentPath, name),
                icon: 'folder',
                description: this._directoryDescription(name, rustyRoadMode),
            }));
    }

    /**
     * Returns whether a folder should be hidden from extraction browsing.
     *
     * This keeps the picker focused on source destinations and avoids expensive
     * traversal into dependency or build output trees.
     */
    private _isHiddenOrGeneratedDirectory(name: string): boolean {
        return name.startsWith('.') ||
            name === 'target' ||
            name === 'node_modules';
    }

    /**
     * Describes convention-backed folders when RustyRoad mode is enabled.
     *
     * Empty descriptions are preserved for the webview's simple optional
     * rendering path.
     */
    private _directoryDescription(
        name: string,
        rustyRoadMode: boolean,
    ): string {
        if (rustyRoadMode && this._isRustyRoadDirectory(name)) {
            return 'RustyRoad convention';
        }

        return '';
    }

    /**
     * Determines whether RustyRoad suggested folders should be shown.
     *
     * Suggestions only appear under src when no real directories are available
     * or when the suggested path itself has not been created yet.
     */
    private _shouldShowSuggestions(
        currentPath: string,
        directoryCount: number,
        directoryExists: boolean,
        rustyRoadMode: boolean,
    ): boolean {
        return rustyRoadMode &&
            currentPath === 'src' &&
            (directoryCount === 0 || !directoryExists);
    }

    /**
     * Creates tree items for RustyRoad's conventional source folders.
     *
     * Selecting one navigates to the folder path, allowing extraction logic to
     * create it later if it does not already exist.
     */
    private _suggestionItems(currentPath: string): TreeItem[] {
        return this._rustyRoadSuggestions().map((suggestedDir) => ({
            name: suggestedDir,
            type: 'suggestion',
            path: this._joinPath(currentPath, suggestedDir),
            icon: 'new-folder',
        }));
    }

    /**
     * Posts a directory update to the webview if the panel still exists.
     *
     * Keeping this message shape in one place prevents drift between success
     * and error paths.
     */
    private _postDirectoryMessage(message: DirectoryMessage): void {
        this._panel?.webview.postMessage(message);
    }

    /**
     * Splits a relative path into safe non-empty POSIX-style segments.
     *
     * User-facing paths may contain either slash style because Windows users
     * can type backslashes; downstream URI joins receive clean segments.
     */
    private _splitPath(pathValue: string): string[] {
        return pathValue
            .split(/[\\/]/)
            .map((segment) => segment.trim())
            .filter(Boolean)
            .filter((segment) => segment !== '.' && segment !== '..');
    }

    /**
     * Normalizes an input path to a workspace-relative POSIX path.
     *
     * Empty or root-like values become an empty string, which represents the
     * workspace root throughout the panel and webview protocol.
     */
    private _normalizePath(relativePath: string): string {
        if (path.posix.isAbsolute(relativePath.replace(/\\/g, '/')) ||
            path.win32.isAbsolute(relativePath)) {
            return '';
        }

        const segments = this._splitPath(relativePath);
        if (segments.length === 0) {
            return '';
        }

        return path.posix.join(...segments);
    }

    /**
     * Joins path fragments into a workspace-relative POSIX path.
     *
     * The helper intentionally ignores empty fragments so callers can pass root
     * paths without producing leading or duplicate separators.
     */
    private _joinPath(...parts: string[]): string {
        const segments = parts.flatMap((part) => this._splitPath(part));
        if (segments.length === 0) {
            return '';
        }

        return path.posix.join(...segments);
    }

    /**
     * Returns the workspace-relative parent path for breadcrumb navigation.
     *
     * The src folder returns the root to keep common Rust projects one click
     * away from their source tree.
     */
    private _parentPath(relativePath: string): string {
        const normalized = this._normalizePath(relativePath);
        if (!normalized || normalized === 'src') {
            return '';
        }

        const segments = this._splitPath(normalized);
        if (segments.length <= 1) {
            return '';
        }

        return segments.slice(0, -1).join('/');
    }

    /**
     * Converts a workspace-relative path into a VS Code workspace URI.
     *
     * URI joining is used instead of filesystem string concatenation so the
     * panel works across local, remote, and virtual workspaces.
     */
    private _toUri(relativePath: string): vscode.Uri {
        const normalized = this._normalizePath(relativePath);
        const segments = this._splitPath(normalized);
        const targetUri = vscode.Uri.joinPath(
            this._workspaceFolder.uri,
            ...segments,
        );

        if (this._workspaceFolder.uri.scheme === 'file' &&
            targetUri.scheme === 'file') {
            const workspacePath = path.resolve(
                this._workspaceFolder.uri.fsPath,
            );
            const targetPath = path.resolve(targetUri.fsPath);
            const relative = path.relative(workspacePath, targetPath);

            if (relative.startsWith('..') || path.isAbsolute(relative)) {
                return this._workspaceFolder.uri;
            }
        }

        return targetUri;
    }

    /**
     * Returns whether a directory name matches a RustyRoad convention.
     *
     * The check is centralized so new conventions only require changing the
     * static directory list.
     */
    private _isRustyRoadDirectory(name: string): boolean {
        return ModuleExtractorPanel.RUSTY_ROAD_DIRECTORIES.includes(name);
    }

    /**
     * Returns the ordered RustyRoad folder suggestions displayed in src.
     *
     * Exposing the readonly list through a helper keeps callers from mutating
     * shared class state.
     */
    private _rustyRoadSuggestions(): readonly string[] {
        return ModuleExtractorPanel.RUSTY_ROAD_DIRECTORIES;
    }

    /**
     * Builds breadcrumb labels for the current workspace-relative path.
     *
     * The webview reconstructs segment paths from these labels so no absolute
     * workspace paths need to cross into browser content.
     */
    private _generateBreadcrumb(currentPath: string): string[] {
        return this._splitPath(currentPath);
    }

    /**
     * Regenerates the webview HTML shell for the current panel.
     *
     * The shell is static aside from resource URIs and a per-render nonce used
     * by the Content Security Policy.
     */
    private _updateHtml(): void {
        const webview = this._panel?.webview;
        if (!webview) {
            return;
        }

        webview.html = this._getHtmlForWebview(webview);
    }

    /**
     * Generates nonce-protected HTML for the module extractor webview.
     *
     * Inline scripts are avoided so the CSP can disallow unsafe script sources.
     * Inline styles are also avoided to keep style changes in the CSS bundle.
     */
    private _getHtmlForWebview(webview: vscode.Webview): string {
        const nonce = this._nonce();
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(
            this._extensionUri,
            'out',
            'webview',
            'module-extractor.css',
        ));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(
            this._extensionUri,
            'out',
            'webview',
            'module-extractor.js',
        ));
        const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(
            this._extensionUri,
            'node_modules',
            '@vscode',
            'codicons',
            'dist',
            'codicon.css',
        ));

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="${this._csp(
        webview,
    )}">
    <link href="${codiconsUri}" rel="stylesheet">
    <link href="${styleUri}" rel="stylesheet">
    <title>Module Extractor</title>
</head>
<body>
    <div class="container">
        <header class="header">
            <h2 class="title">
                <i
                    class="codicon codicon-export"
                    aria-hidden="true"
                ></i>
                Extract to Module
            </h2>
        </header>
        <section
            class="info-section"
            aria-labelledby="module-label"
        >
            <div class="module-info">
                <div class="info-item">
                    <label id="module-label" for="module-name">
                        Module
                    </label>
                    <span id="module-name" class="module-name">
                        Loading...
                    </span>
                </div>
                <div class="info-item">
                    <label for="code-preview">Preview</label>
                    <span id="code-preview" class="code-preview">
                        Loading...
                    </span>
                </div>
            </div>
        </section>
        <nav class="breadcrumb-container" aria-label="Directory breadcrumb">
            <div class="breadcrumb" id="breadcrumb"></div>
        </nav>
        <main class="content" aria-label="Destination browser">
            <section
                class="destination-panel"
                aria-label="Destination directories"
            >
                <div class="file-tree">
                    <div class="tree-header">
                        <div id="current-path" class="current-path">
                            Current: Workspace Root
                        </div>
                    </div>
                    <div
                        id="file-tree-content"
                        class="tree-content"
                        role="tree"
                    ></div>
                </div>
            </section>
        </main>
        <footer class="footer" aria-label="Extraction actions">
            <div
                class="conversion-info hidden"
                id="conversion-info"
            >
                <div class="info-box warning">
                    <i
                        class="codicon codicon-warning"
                        aria-hidden="true"
                    ></i>
                    <div>
                        <strong>Module Conversion Required</strong>
                        <p>
                            The selected file will be converted
                            to a folder-based module structure.
                        </p>
                    </div>
                </div>
            </div>
            <div class="actions">
                <button
                    id="create-btn"
                    class="btn btn-primary"
                    disabled
                >
                    <i
                        class="codicon codicon-check"
                        aria-hidden="true"
                    ></i>
                    <span id="create-btn-label">
                        Select a destination
                    </span>
                </button>
                <button
                    id="cancel-btn"
                    class="btn btn-secondary"
                >
                    <i
                        class="codicon codicon-x"
                        aria-hidden="true"
                    ></i>
                    Cancel
                </button>
            </div>
        </footer>
    </div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    /**
     * Builds the Content Security Policy for webview resources.
     *
     * Scripts require a nonce and styles are limited to VS Code webview
     * sources; this removes the previous unsafe-inline script allowance.
     */
    private _csp(webview: vscode.Webview): string {
        return [
            `default-src 'none'`,
            `script-src 'nonce-${this._lastNonce}'`,
            `style-src ${webview.cspSource}`,
            `font-src ${webview.cspSource}`,
            `img-src ${webview.cspSource} data:`,
        ].join('; ');
    }

    private _lastNonce = '';

    /**
     * Creates a random nonce for a single HTML render.
     *
     * The nonce is stored so the CSP and script tag use the same value without
     * leaking any additional mutable state into callers.
     */
    private _nonce(): string {
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const chars = `${possible}${possible.toLowerCase()}0123456789`;
        this._lastNonce = Array.from({ length: 32 }, () => (
            chars.charAt(Math.floor(Math.random() * chars.length))
        )).join('');
        return this._lastNonce;
    }

    /**
     * Formats an error-like value with a stable prefix for diagnostics.
     *
     * Unknown thrown values are converted with String so logging never throws a
     * secondary error while handling the original failure.
     */
    private _errorText(prefix: string, error: unknown): string {
        const message = error instanceof Error ? error.message : String(error);
        return `${prefix}: ${message}`;
    }

    /**
     * Writes a diagnostic message to the output channel and debug console.
     *
     * The method is private to avoid making logging a public panel concern.
     */
    private static log(message: string): void {
        ModuleExtractorPanel.outputChannel?.appendLine(
            `[ModuleExtractorPanel] ${message}`,
        );
        console.log(`[ModuleExtractorPanel] ${message}`);
    }
}
