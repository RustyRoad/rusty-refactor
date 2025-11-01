(function() {
    const vscode = acquireVsCodeApi();
    
    // State
    let currentPath = 'src';
    let selectedPath = '';
    let moduleName = '';
    let moduleId = '';
    
    // Initialize
    document.addEventListener('DOMContentLoaded', () => {
        console.log('DOM content loaded, initializing webview');
        
        // Setup event listeners
        document.getElementById('create-btn').addEventListener('click', handleConfirm);
        document.getElementById('cancel-btn').addEventListener('click', handleCancel);
        
        // Check if essential elements exist
        const fileTreeContent = document.getElementById('file-tree-content');
        if (!fileTreeContent) {
            console.error('file-tree-content element missing from DOM');
        } else {
            console.log('file-tree-content element found');
            
            // Add a small delay before notifying extension that webview is ready
            // This ensures all DOM elements are properly loaded
            setTimeout(() => {
                console.log('Webview fully loaded, sending ready command');
                vscode.postMessage({ command: 'ready' });
            }, 100);
        }
    });
    
    // Handle messages from extension
    window.addEventListener('message', event => {
        const message = event.data;
        if (!message || typeof message !== 'object' || typeof message.command !== 'string') {
            console.warn('Received malformed message:', message);
            return;
        }
        console.log('Webview received message:', message.command, message);
        
        switch (message.command) {
            case 'updateData':
                updateData(message);
                break;
            case 'updateDirectory':
                updateDirectory(message);
                break;
            case 'updateCurrentPath':
                updateCurrentPathDisplay(message.currentPath);
                break;
            default:
                console.warn('Unknown message command:', message.command);
        }
    });
    
    function updateData(message) {
        moduleName = message.moduleName;
        
        // Update the title and button
        document.querySelector('.module-name').textContent = moduleName;
        document.getElementById('create-btn').innerHTML = `
            <i class="codicon codicon-check"></i> Extract to <span class="highlight">${moduleName}.rs</span>
        `;
        
        // Update code preview
        const codePreview = message.selectedCode.substring(0, 100);
        document.querySelector('.code-preview').textContent = 
            codePreview + (message.selectedCode.length > 100 ? '...' : '');
    }
    
    function updateDirectory(message) {
        console.log('updateDirectory called with:', message);
        currentPath = message.currentPath;
        
        // Clear selection when navigating to a new directory
        selectedPath = '';
        
        // Update breadcrumb
        updateBreadcrumb(message.breadcrumb);
        
        // Update file tree
        updateFileTree(message);
        
        // Update current path display
        updateCurrentPathDisplay(currentPath);
        
        // Update button state
        updateButtonState();
    }
    
    function updateBreadcrumb(breadcrumb) {
        const breadcrumbEl = document.getElementById('breadcrumb');
        breadcrumbEl.innerHTML = '';
        
        breadcrumb.forEach((item, index) => {
            // Add clickable item
            const itemEl = document.createElement('div');
            itemEl.className = 'breadcrumb-item';
            
            // Determine path up to this item
            const pathUpToItem = breadcrumb.slice(0, index + 1).join('/');
            
            itemEl.onclick = () => {
                vscode.postMessage({
                    command: 'selectDirectory',
                    path: pathUpToItem
                });
            };
            
            itemEl.textContent = item;
            breadcrumbEl.appendChild(itemEl);
            
            // Add separator except for last item
            if (index < breadcrumb.length - 1) {
                const separatorEl = document.createElement('div');
                separatorEl.className = 'breadcrumb-separator';
                separatorEl.innerHTML = '<i class="codicon codicon-chevron-right"></i>';
                breadcrumbEl.appendChild(separatorEl);
            }
        });
    }
    
    function updateFileTree(data) {
        const treeContent = document.getElementById('file-tree-content');
        if (!treeContent) {
            console.error('updateFileTree: file-tree-content element not found');
            return;
        }
        
        console.log('Updating file tree with data:', data);
        
        // Show loading indicator
        treeContent.innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading...</p></div>';
        
        // Small delay to ensure loading indicator shows, then render
        setTimeout(() => {
            renderFileTree(data);
        }, 10);
    }
    
    function renderFileTree(data) {
        const treeContent = document.getElementById('file-tree-content');
        if (!treeContent) {
            console.error('renderFileTree: file-tree-content element not found');
            return;
        }
        
        console.log('Rendering file tree with data:', data);
        
        // Add parent directory option if not at root
        if (data.currentPath !== 'src') {
            console.log('Adding parent directory item');
            const parentItem = createTreeItem({
                name: '..',
                path: data.parentPath,
                icon: 'folder',
                type: 'parent',
                description: 'Go to parent directory'
            });
            treeContent.appendChild(parentItem);
        }
        
        // Add create here option
        console.log('Adding "Create module here" item');
        const createItem = createTreeItem({
            name: 'Create module here',
            path: data.currentPath,
            icon: 'check',
            type: 'create',
            description: `Create ${moduleName}.rs in ${data.currentPath}/`
        });
        treeContent.appendChild(createItem);
        
        // Add module files that can be converted
        if (data.moduleFiles && data.moduleFiles.length > 0) {
            data.moduleFiles.forEach(file => {
                const fileItem = createTreeItem({
                    ...file,
                    type: 'module-file',
                    needsConversion: true,
                    description: file.description,
                    detail: file.detail
                });
                treeContent.appendChild(fileItem);
            });
        }
        
        // Add suggested directories
        if (data.suggestions && data.suggestions.length > 0) {
            const suggestionsHeader = document.createElement('div');
            suggestionsHeader.className = 'tree-section-header';
            suggestionsHeader.textContent = 'Suggested Directories';
            treeContent.appendChild(suggestionsHeader);
            
            data.suggestions.forEach(suggestion => {
                const suggestionItem = createTreeItem(suggestion);
                treeContent.appendChild(suggestionItem);
            });
        }
        
        // Add existing directories
        if (data.directories && data.directories.length > 0) {
            const directoriesHeader = document.createElement('div');
            directoriesHeader.className = 'tree-section-header';
            directoriesHeader.textContent = 'Existing Directories';
            treeContent.appendChild(directoriesHeader);
            
            data.directories.forEach(directory => {
                const directoryItem = createTreeItem(directory);
                treeContent.appendChild(directoryItem);
            });
        }
        
        // Show empty state if no items
        if (treeContent.children.length === 0) {
            const emptyState = document.createElement('div');
            emptyState.className = 'empty-state';
            emptyState.textContent = 'No directories found. You can create a new directory or select a different location.';
            treeContent.appendChild(emptyState);
        }
        
        // Log final DOM state for debugging
        console.log('Final file tree DOM state:', treeContent.innerHTML);
    }
    
    function createTreeItem(item) {
        const itemEl = document.createElement('div');
        itemEl.className = 'tree-item';
        
        // Add selection state
        if (item.path === selectedPath) {
            itemEl.classList.add('selected');
        }
        
        // Create icon
        const iconEl = document.createElement('div');
        iconEl.className = `tree-icon icon-${item.icon} codicon codicon-${item.icon}`;
        
        // Create info
        const infoEl = document.createElement('div');
        infoEl.className = 'tree-info';
        
        // Name
        const nameEl = document.createElement('div');
        nameEl.className = 'tree-name';
        nameEl.textContent = item.name;
        infoEl.appendChild(nameEl);
        
        // Description
        if (item.description) {
            const descEl = document.createElement('div');
            descEl.className = 'tree-description';
            descEl.textContent = item.description;
            infoEl.appendChild(descEl);
        }
        
        // Detail
        if (item.detail) {
            const detailEl = document.createElement('div');
            detailEl.className = 'tree-detail';
            detailEl.textContent = item.detail;
            infoEl.appendChild(detailEl);
        }
        
        itemEl.appendChild(iconEl);
        itemEl.appendChild(infoEl);
        
        // Handle click
        itemEl.onclick = () => {
            // Handle different types
            if (item.type === 'parent' || item.type === 'directory' || item.type === 'suggestion') {
                // Navigate to directory
                vscode.postMessage({
                    command: 'selectDirectory',
                    path: item.path
                });
            } else if (item.type === 'create' || item.type === 'module-file') {
                // Select this location
                selectedPath = item.path;
                
                // Update selection UI
                document.querySelectorAll('.tree-item').forEach(el => {
                    el.classList.remove('selected');
                });
                itemEl.classList.add('selected');
                
                // Update button state - enable the button
                updateButtonState();
                
                // Show/hide conversion info
                const conversionInfo = document.getElementById('conversion-info');
                if (item.needsConversion) {
                    conversionInfo.style.display = 'block';
                } else {
                    conversionInfo.style.display = 'none';
                }
            }
        };
        
        return itemEl;
    }
    
    function handleConfirm() {
        if (selectedPath) {
            vscode.postMessage({ command: 'confirmSelection' });
        }
    }
    
    function handleCancel() {
        vscode.postMessage({ command: 'cancel' });
    }
    
    function updateButtonState() {
        const btn = document.getElementById('create-btn');
        if (selectedPath && selectedPath.length > 0) {
            btn.disabled = false;
            btn.classList.remove('disabled');
        } else {
            btn.disabled = true;
            btn.classList.add('disabled');
        }
    }
    
    function updateCurrentPathDisplay(path) {
        document.querySelector('.current-path').textContent = `Current: ${path}`;
    }
})();