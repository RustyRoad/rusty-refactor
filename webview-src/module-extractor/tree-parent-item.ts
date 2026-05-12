import type { DirectoryUpdateMessage, TreeItem } from './types';

/**
 * Builds the synthetic tree item used to navigate to the parent directory.
 *
 * Parent navigation is shown only when the current directory is not the
 * workspace root, but this factory keeps the item shape in one place.
 */
export function createParentItem(data: DirectoryUpdateMessage): TreeItem {
    return {
        name: '..',
        path: data.parentPath,
        icon: 'folder',
        type: 'parent',
        description: 'Go to parent directory',
    };
}
