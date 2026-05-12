import { appState } from './app-state';
import { selectDirectory } from './directory-navigation';
import { updateButtonState } from './selection-button';
import { updateConversionInfo } from './conversion-info';
import type { TreeItem } from './types';

/**
 * Handles navigation or selection for a tree item.
 *
 * Directory-like items request a new directory from the extension. Creation
 * items stay in the browser and only update the pending selection state.
 */
export function activateTreeItem(item: TreeItem): void {
    if (isNavigationItem(item)) {
        selectDirectory(item.path);
        return;
    }

    appState.selectedPath = item.path;
    appState.selectedNeedsConversion = item.needsConversion === true;
    markSelectedTreeItem(item.path);
    updateButtonState();
    updateConversionInfo();
}

/**
 * Returns whether an item changes the current directory.
 *
 * Separating this predicate keeps activation logic easy to read and protects
 * future item types from accidentally behaving like selections.
 */
function isNavigationItem(item: TreeItem): boolean {
    return item.type === 'parent' ||
        item.type === 'directory' ||
        item.type === 'suggestion';
}

/**
 * Updates the selected visual state for all tree buttons.
 *
 * ARIA state is kept in sync with the CSS class so visual and assistive
 * feedback describe the same current selection.
 */
function markSelectedTreeItem(path: string): void {
    document.querySelectorAll<HTMLElement>('.tree-item').forEach((el) => {
        const isSelected = appState.selectedPath === path &&
            el.dataset.path === path;
        el.classList.toggle('selected', isSelected);
        el.setAttribute('aria-selected', String(isSelected));
    });
}
