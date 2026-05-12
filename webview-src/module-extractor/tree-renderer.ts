import { element } from './dom';
import { createHereItem } from './tree-here-item';
import { createParentItem } from './tree-parent-item';
import { createTreeItem } from './tree-item-view';
import { statusMessage } from './status-message';
import type { DirectoryUpdateMessage, TreeItem } from './types';

/**
 * Renders all visible tree sections for a directory update.
 *
 * Section rendering is delegated to helpers so each branch only describes the
 * items it contributes to the tree.
 */
export function renderFileTree(data: DirectoryUpdateMessage): void {
    const treeContent = element('file-tree-content');
    treeContent.replaceChildren();

    if (data.error) {
        treeContent.appendChild(statusMessage(data.error));
    }

    if (data.currentPath) {
        treeContent.appendChild(createTreeItem(createParentItem(data)));
    }

    treeContent.appendChild(createTreeItem(createHereItem(data.currentPath)));
    appendItems(treeContent, data.moduleFiles, undefined, true);
    appendItems(treeContent, data.suggestions, 'Suggested Directories');
    appendItems(treeContent, data.directories, 'Existing Directories');
}

/**
 * Appends an optional tree section and its items to the tree container.
 *
 * Module-file sections skip a header because the item detail already explains
 * the conversion operation in context.
 */
function appendItems(
    treeContent: HTMLElement,
    items: readonly TreeItem[] | undefined,
    header?: string,
    needsConversion = false,
): void {
    if (!items || items.length === 0) {
        return;
    }

    if (header) {
        treeContent.appendChild(sectionHeader(header));
    }

    items.forEach((item) => {
        treeContent.appendChild(createTreeItem({ ...item, needsConversion }));
    });
}

/**
 * Creates a label for a group of related tree items.
 */
function sectionHeader(header: string): HTMLElement {
    const headerEl = document.createElement('div');
    headerEl.className = 'tree-section-header';
    headerEl.textContent = header;
    return headerEl;
}
