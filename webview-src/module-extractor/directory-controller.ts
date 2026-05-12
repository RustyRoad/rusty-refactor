import { appState, clearSelection } from './app-state';
import { updateBreadcrumb } from './breadcrumb-view';
import { updateButtonState } from './selection-button';
import { updateConversionInfo } from './conversion-info';
import { updateCurrentPathDisplay } from './path-display';
import { renderFileTree } from './tree-renderer';
import type { DirectoryUpdateMessage } from './types';

/**
 * Applies a directory update from the extension and rerenders navigation.
 *
 * Any previous destination selection is cleared because the meaning of a path
 * is tied to the currently displayed directory tree.
 */
export function updateDirectory(message: DirectoryUpdateMessage): void {
    appState.currentPath = message.currentPath;
    clearSelection();
    updateBreadcrumb(message.breadcrumb);
    updateCurrentPathDisplay(appState.currentPath);
    renderFileTree(message);
    updateButtonState();
    updateConversionInfo();
}
