import { element } from './dom';

/**
 * Displays the current workspace-relative directory path.
 *
 * An empty path represents the workspace root throughout the webview protocol.
 */
export function updateCurrentPathDisplay(path: string): void {
    const displayPath = path ? path : 'Workspace Root';
    element('current-path').textContent = `Current: ${displayPath}`;
}
