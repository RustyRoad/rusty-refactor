export interface AppState {
    currentPath: string;
    selectedPath: string | null;
    selectedNeedsConversion: boolean;
    moduleName: string;
}

/**
 * Stores transient webview state that is owned by the browser session.
 *
 * The extension remains the source of truth for filesystem data, while this
 * object tracks the user's current pending selection and visible module name.
 */
export const appState: AppState = {
    currentPath: '',
    selectedPath: null,
    selectedNeedsConversion: false,
    moduleName: '',
};

/**
 * Clears destination selection after navigation changes the visible tree.
 *
 * A selected path is meaningful only for the directory snapshot where the user
 * selected it, so directory updates must remove stale confirmation state.
 */
export function clearSelection(): void {
    appState.selectedPath = null;
    appState.selectedNeedsConversion = false;
}
