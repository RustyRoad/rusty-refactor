import { textSpan } from './text-span';
import type { TreeItem } from './types';

/**
 * Creates the textual information block for a tree item.
 *
 * Optional description and detail rows are appended only when supplied by the
 * extension, keeping empty spans out of the accessible tree row.
 */
export function createTreeInfo(item: TreeItem): HTMLElement {
    const infoEl = document.createElement('span');
    infoEl.className = 'tree-info';
    infoEl.appendChild(textSpan('tree-name', item.name));

    if (item.description) {
        infoEl.appendChild(textSpan('tree-description', item.description));
    }

    if (item.detail) {
        infoEl.appendChild(textSpan('tree-detail', item.detail));
    }

    return infoEl;
}
