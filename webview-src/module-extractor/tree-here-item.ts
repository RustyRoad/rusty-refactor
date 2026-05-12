import { appState } from './app-state';
import type { TreeItem } from './types';

/**
 * Builds the synthetic tree item for selecting the current directory.
 *
 * The description names the actual target folder so the action button and tree
 * item remain consistent while navigating.
 */
export function createHereItem(path: string): TreeItem {
    const friendlyPath = path ? `${path}/` : 'workspace root';
    return {
        name: 'Create module here',
        path,
        icon: 'check',
        type: 'create',
        description: `Create ${appState.moduleName}.rs in ${friendlyPath}`,
    };
}
