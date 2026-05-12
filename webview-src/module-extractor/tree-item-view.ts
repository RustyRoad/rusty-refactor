import { appState } from './app-state';
import { activateTreeItem } from './tree-selection';
import { createTreeInfo } from './tree-info-view';
import type { TreeItem } from './types';

/**
 * Creates a keyboard-accessible tree item button.
 *
 * A button provides click, focus, and Enter/Space activation semantics without
 * custom keyboard event handlers.
 */
export function createTreeItem(item: TreeItem): HTMLElement {
    const itemEl = document.createElement('button');
    itemEl.className = treeItemClass(item.path);
    itemEl.type = 'button';
    itemEl.dataset.path = item.path;
    itemEl.setAttribute('role', 'treeitem');
    itemEl.setAttribute('aria-selected', String(isSelected(item.path)));
    itemEl.append(createTreeIcon(item.icon), createTreeInfo(item));
    itemEl.addEventListener('click', () => activateTreeItem(item));
    return itemEl;
}

/**
 * Builds the class string for a tree item from selection state.
 */
function treeItemClass(path: string): string {
    return isSelected(path) ? 'tree-item selected' : 'tree-item';
}

/**
 * Returns whether a path is the active destination selection.
 */
function isSelected(path: string): boolean {
    return appState.selectedPath !== null && path === appState.selectedPath;
}

/**
 * Creates the codicon element for a tree row.
 */
function createTreeIcon(icon: string): HTMLElement {
    const iconEl = document.createElement('i');
    iconEl.className = [
        'tree-icon',
        `icon-${icon}`,
        'codicon',
        `codicon-${icon}`,
    ].join(' ');
    iconEl.setAttribute('aria-hidden', 'true');
    return iconEl;
}
