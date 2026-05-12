export type TreeItemType =
    'parent' |
    'directory' |
    'suggestion' |
    'create' |
    'module-file';

export interface TreeItem {
    name: string;
    path: string;
    icon: string;
    type: TreeItemType;
    description?: string;
    detail?: string;
    needsConversion?: boolean;
}

export interface DirectoryUpdateMessage {
    command: 'updateDirectory';
    currentPath: string;
    parentPath: string;
    directories: TreeItem[];
    moduleFiles: TreeItem[];
    suggestions: TreeItem[];
    breadcrumb: string[];
    error?: string;
}

export interface DataUpdateMessage {
    command: 'updateData';
    moduleName: string;
    selectedCode: string;
    analysisResult: unknown;
}

export interface ExtensionMessage {
    command?: string;
    currentPath?: string;
}

export interface VSCodeAPI {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
}
