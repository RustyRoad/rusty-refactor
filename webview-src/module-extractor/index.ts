import './styles.css'; // @ts-ignore


interface VSCodeAPI {
    postMessage(message: any): void;
    getState(): any;
    setState(state: any): void;
}

declare function acquireVsCodeApi(): VSCodeAPI;

interface TreeItem {
    name: string;
    path: string;
    icon: string;
    type: 'parent' | 'directory' | 'suggestion' | 'create' | 'module-file';
    description?: string;
    detail?: string;
    needsConversion?: boolean;
}

interface DirectoryUpdateMessage {
    command: 'updateDirectory';
    currentPath: string;
    parentPath: string;
    directories: TreeItem[];
    moduleFiles: TreeItem[];
    suggestions: TreeItem[];
    breadcrumb: string[];
}

interface DataUpdateMessage {
    command: 'updateData';
    moduleName: string;
    selectedCode: string;
    analysisResult: any;
}

(function() {
    const vscode = acquireVsCodeApi();
    
    // State
    let currentPath = '';
    let selectedPath: string | null = null;
    let moduleName = '';
    
    // Enhanced logging function
    const log = (level: string, message: string, data: any = null) => {
        const timestamp = new Date().toISOString();
        const formattedMessage = `[Webview ${timestamp}] [${level.toUpperCase()}] ${message}`;
        
        if (data) {
            console.log(formattedMessage, data);
        } else {
            console.log(formattedMessage);
        }
        
        // Send log messages to extension for centralized logging
        vscode.postMessage({
            command: 'log',
            level,
            message,
            data
        });
    };
    
    // Initialization function
    function initialize() {
        log('info', 'Initializing webview');
        
        try {
            // Check essential DOM elements
            const requiredElements = [
                'create-btn',
                'cancel-btn', 
                'file-tree-content',
                'breadcrumb',
                'module-name',
                'code-preview'
            ];
            
            const missingElements: string[] = [];
            requiredElements.forEach(id => {
                const element = document.getElementById(id);
                if (!element) {
                    missingElements.push(id);
                } else {
                    log('debug', `Found required element: ${id}`);
                }
            });
            
            if (missingElements.length > 0) {
                log('error', 'Missing DOM elements:', missingElements);
                return;
            }
            
            // Setup event listeners
            log('debug', 'Setting up event listeners');
            document.getElementById('create-btn')!.addEventListener('click', handleConfirm);
            document.getElementById('cancel-btn')!.addEventListener('click', handleCancel);
            
            // Initialize state
            log('debug', 'Initial state', { currentPath, selectedPath, moduleName });
            
            // Initialize the file tree with a loading state immediately
            const treeContent = document.getElementById('file-tree-content');
            if (treeContent) {
                treeContent.innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading directories...</p></div>';
                log('debug', 'Set initial loading state for file tree');
            }
            
            // Notify extension that webview is ready
            log('info', 'Webview fully loaded, sending ready command');
            vscode.postMessage({ command: 'ready' });
            
        } catch (error: any) {
            log('error', 'Failed to initialize webview', { error: error.message, stack: error.stack });
        }
    }
    
    // Run initialization when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        // DOM is already ready, initialize immediately
        initialize();
    }
    
    // Handle messages from extension
    window.addEventListener('message', (event: MessageEvent) => {
        try {
            const message = event.data;
            if (!message || typeof message !== 'object' || typeof message.command !== 'string') {
                log('warn', 'Received malformed message:', message);
                return;
            }
            log('debug', `Received message: ${message.command}`, message);
            
            switch (message.command) {
                case 'updateData':
                    updateData(message as DataUpdateMessage);
                    break;
                case 'updateDirectory':
                    updateDirectory(message as DirectoryUpdateMessage);
                    break;
                case 'updateCurrentPath':
                    updateCurrentPathDisplay(message.currentPath);
                    break;
                default:
                    log('warn', `Unknown message command: ${message.command}`, message);
            }
        } catch (error: any) {
            log('error', 'Error handling message from extension', { error: error.message, message: event.data });
        }
    });
    
    function updateData(message: DataUpdateMessage) {
        try {
            log('debug', 'Updating webview data', { moduleName: message.moduleName, selectedCodeLength: message.selectedCode?.length });
            
            moduleName = message.moduleName;
            
            // Update the title and button
            const moduleNameElement = document.querySelector('.module-name');
            const createBtnElement = document.getElementById('create-btn');
            
            if (!moduleNameElement || !createBtnElement) {
                log('error', 'Required elements not found for updateData', { moduleNameElement: !!moduleNameElement, createBtnElement: !!createBtnElement });
                return;
            }
            
            moduleNameElement.textContent = moduleName;
            createBtnElement.innerHTML = `
                <i class="codicon codicon-check"></i> Extract to <span class="highlight">${moduleName}.rs</span>
            `;
            
            // Update code preview
            const codePreviewElement = document.querySelector('.code-preview');
            if (codePreviewElement) {
                const codePreview = message.selectedCode.substring(0, 100);
                codePreviewElement.textContent = codePreview + (message.selectedCode.length > 100 ? '...' : '');
                log('debug', 'Updated code preview', { previewLength: codePreview.length, totalLength: message.selectedCode.length });
            }
            
            log('info', 'Webview data updated successfully', { moduleName });
            
        } catch (error: any) {
            log('error', 'Failed to update webview data', { error: error.message });
        }
    }
    
    function updateDirectory(message: DirectoryUpdateMessage) {
        try {
            log('info', 'Updating directory', { 
                currentPath: message.currentPath, 
                dirCount: message.directories?.length || 0,
                suggestCount: message.suggestions?.length || 0,
                moduleFileCount: message.moduleFiles?.length || 0
            });
            currentPath = message.currentPath;
            
            // Clear selection when navigating to a new directory
            selectedPath = null;
            
            // Update breadcrumb
            updateBreadcrumb(message.breadcrumb);
            
            // Update file tree
            updateFileTree(message);
            
            // Update current path display
            updateCurrentPathDisplay(currentPath);
            
            // Update button state
            updateButtonState();
            
            log('info', 'Directory updated successfully', { currentPath, itemCount: (message.directories?.length || 0) + (message.suggestions?.length || 0) });
            
        } catch (error: any) {
            log('error', 'Failed to update directory', { error: error.message, stack: error.stack });
        }
    }
    
    function updateBreadcrumb(breadcrumb: string[]) {
        const breadcrumbEl = document.getElementById('breadcrumb')!;
        breadcrumbEl.innerHTML = '';

        const segments = [''].concat(breadcrumb);
        let pathSoFar = '';

        segments.forEach((item, index) => {
            const itemEl = document.createElement('div');
            itemEl.className = 'breadcrumb-item';

            if (item) {
                pathSoFar = pathSoFar ? `${pathSoFar}/${item}` : item;
            } else {
                pathSoFar = '';
            }

            itemEl.onclick = () => {
                vscode.postMessage({
                    command: 'selectDirectory',
                    path: pathSoFar
                });
            };

            itemEl.textContent = item || 'Workspace Root';
            breadcrumbEl.appendChild(itemEl);

            if (index < segments.length - 1) {
                const separatorEl = document.createElement('div');
                separatorEl.className = 'breadcrumb-separator';
                separatorEl.innerHTML = '<i class="codicon codicon-chevron-right"></i>';
                breadcrumbEl.appendChild(separatorEl);
            }
        });
    }
    
    function updateFileTree(data: DirectoryUpdateMessage) {
        try {
            log('debug', 'Updating file tree', { 
                currentPath: data.currentPath, 
                directoryCount: data.directories?.length || 0,
                suggestionCount: data.suggestions?.length || 0,
                moduleFileCount: data.moduleFiles?.length || 0
            });
            
            const treeContent = document.getElementById('file-tree-content');
            if (!treeContent) {
                log('error', 'file-tree-content element not found');
                return;
            }
            
            renderFileTree(data);
            
        } catch (error: any) {
            log('error', 'Failed to update file tree', { error: error.message });
        }
    }
    
    function renderFileTree(data: DirectoryUpdateMessage) {
        try {
            log('info', 'Rendering file tree', { 
                currentPath: data.currentPath,
                dirCount: data.directories?.length || 0,
                suggestionCount: data.suggestions?.length || 0,
                moduleFileCount: data.moduleFiles?.length || 0
            });
            
            const treeContent = document.getElementById('file-tree-content');
            if (!treeContent) {
                log('error', 'file-tree-content element not found during render');
                return;
            }
            
            treeContent.innerHTML = '';
            log('debug', 'Cleared tree content');
            
            let itemCount = 0;
            
            if (data.currentPath) {
                log('debug', 'Adding parent directory item');
                const parentItem = createTreeItem({
                    name: '..',
                    path: data.parentPath,
                    icon: 'folder',
                    type: 'parent',
                    description: 'Go to parent directory'
                });
                treeContent.appendChild(parentItem);
                itemCount++;
            }
            
            log('debug', 'Adding "Create module here" item');
            const friendlyPath = data.currentPath ? `${data.currentPath}/` : 'workspace root';
            const createItem = createTreeItem({
                name: 'Create module here',
                path: data.currentPath,
                icon: 'check',
                type: 'create',
                description: `Create ${moduleName}.rs in ${friendlyPath}`
            });
            treeContent.appendChild(createItem);
            itemCount++;
            
            if (data.moduleFiles && data.moduleFiles.length > 0) {
                log('debug', 'Adding module files for conversion', { count: data.moduleFiles.length });
                data.moduleFiles.forEach(file => {
                    const fileItem = createTreeItem({
                        ...file,
                        type: 'module-file',
                        needsConversion: true
                    });
                    treeContent.appendChild(fileItem);
                    itemCount++;
                });
            }
            
            if (data.suggestions && data.suggestions.length > 0) {
                log('debug', 'Adding suggested directories', { count: data.suggestions.length });
                const suggestionsHeader = document.createElement('div');
                suggestionsHeader.className = 'tree-section-header';
                suggestionsHeader.textContent = 'Suggested Directories';
                treeContent.appendChild(suggestionsHeader);
                
                data.suggestions.forEach(suggestion => {
                    const suggestionItem = createTreeItem(suggestion);
                    treeContent.appendChild(suggestionItem);
                    itemCount++;
                });
            }
            
            if (data.directories && data.directories.length > 0) {
                log('debug', 'Adding existing directories', { count: data.directories.length });
                const directoriesHeader = document.createElement('div');
                directoriesHeader.className = 'tree-section-header';
                directoriesHeader.textContent = 'Existing Directories';
                treeContent.appendChild(directoriesHeader);
                
                data.directories.forEach(directory => {
                    const directoryItem = createTreeItem(directory);
                    treeContent.appendChild(directoryItem);
                    itemCount++;
                });
            }
            
            log('info', 'File tree rendered successfully', { itemCount });
            
        } catch (error: any) {
            log('error', 'Failed to render file tree', { error: error.message, stack: error.stack });
        }
    }
    
    function createTreeItem(item: TreeItem): HTMLElement {
        try {
            log('debug', 'Creating tree item', { name: item.name, type: item.type, path: item.path });
            
            const itemEl = document.createElement('div');
            itemEl.className = 'tree-item';
            
            if (selectedPath !== null && item.path === selectedPath) {
                itemEl.classList.add('selected');
                log('debug', 'Tree item is selected', { path: item.path });
            }
            
            const iconEl = document.createElement('i');
            iconEl.className = `tree-icon icon-${item.icon} codicon codicon-${item.icon}`;
            
            const infoEl = document.createElement('div');
            infoEl.className = 'tree-info';
            
            const nameEl = document.createElement('div');
            nameEl.className = 'tree-name';
            nameEl.textContent = item.name;
            infoEl.appendChild(nameEl);
            
            if (item.description) {
                const descEl = document.createElement('div');
                descEl.className = 'tree-description';
                descEl.textContent = item.description;
                infoEl.appendChild(descEl);
            }
            
            if (item.detail) {
                const detailEl = document.createElement('div');
                detailEl.className = 'tree-detail';
                detailEl.textContent = item.detail;
                infoEl.appendChild(detailEl);
            }
            
            itemEl.appendChild(iconEl);
            itemEl.appendChild(infoEl);
            
            itemEl.onclick = () => {
                try {
                    log('debug', 'Tree item clicked', { name: item.name, type: item.type, path: item.path });
                    
                    if (item.type === 'parent' || item.type === 'directory' || item.type === 'suggestion') {
                        log('info', 'Navigating to directory', { path: item.path, type: item.type });
                        vscode.postMessage({
                            command: 'selectDirectory',
                            path: item.path
                        });
                    } else if (item.type === 'create' || item.type === 'module-file') {
                        log('info', 'Selecting location for module creation', { path: item.path, needsConversion: item.needsConversion });
                        selectedPath = item.path;
                        
                        document.querySelectorAll('.tree-item').forEach(el => {
                            el.classList.remove('selected');
                        });
                        itemEl.classList.add('selected');
                        
                        updateButtonState();
                        
                        const conversionInfo = document.getElementById('conversion-info');
                        if (conversionInfo) {
                            if (item.needsConversion) {
                                conversionInfo.style.display = 'block';
                                log('debug', 'Showing conversion info');
                            } else {
                                conversionInfo.style.display = 'none';
                                log('debug', 'Hiding conversion info');
                            }
                        } else {
                            log('warn', 'conversion-info element not found');
                        }
                    }
                } catch (error: any) {
                    log('error', 'Error handling tree item click', { error: error.message, stack: error.stack });
                }
            };
            
            log('debug', 'Tree item created successfully', { name: item.name });
            return itemEl;
            
        } catch (error: any) {
            log('error', 'Failed to create tree item', { item, error: error.message, stack: error.stack });
            const fallbackEl = document.createElement('div');
            fallbackEl.className = 'tree-item';
            fallbackEl.textContent = item.name || 'Unknown Item';
            return fallbackEl;
        }
    }
    
    function handleConfirm() {
        try {
            log('info', 'User confirmed selection', { selectedPath, moduleName });
            if (selectedPath !== null) {
                vscode.postMessage({ command: 'confirmSelection' });
            } else {
                log('warn', 'Confirm called but no path selected');
            }
        } catch (error: any) {
            log('error', 'Error in handleConfirm', { error: error.message });
        }
    }
    
    function handleCancel() {
        try {
            log('info', 'User cancelled selection', { currentPath, moduleName });
            vscode.postMessage({ command: 'cancel' });
        } catch (error: any) {
            log('error', 'Error in handleCancel', { error: error.message });
        }
    }
    
    function updateButtonState() {
        try {
            const btn = document.getElementById('create-btn') as HTMLButtonElement;
            if (!btn) {
                log('error', 'create-btn element not found in updateButtonState');
                return;
            }
            
            const hasSelection = selectedPath !== null;
            
            if (hasSelection) {
                btn.disabled = false;
                btn.classList.remove('disabled');
                log('debug', 'Button enabled - path selected', { selectedPath });
            } else {
                btn.disabled = true;
                btn.classList.add('disabled');
                log('debug', 'Button disabled - no path selected');
            }
        } catch (error: any) {
            log('error', 'Error updating button state', { error: error.message });
        }
    }
    
    function updateCurrentPathDisplay(path: string) {
        try {
            const pathElement = document.querySelector('.current-path');
            if (!pathElement) {
                log('error', 'current-path element not found');
                return;
            }
            const displayPath = path ? path : 'Workspace Root';
            pathElement.textContent = `Current: ${displayPath}`;
            log('debug', 'Updated current path display', { path });
        } catch (error: any) {
            log('error', 'Error updating current path display', { error: error.message });
        }
    }
})();
