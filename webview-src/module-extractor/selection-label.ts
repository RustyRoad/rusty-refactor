import { appState } from './app-state';

/**
 * Builds the button prompt shown before the user selects a destination.
 */
export function destinationPrompt(): string {
    return `Select where to create ${appState.moduleName}.rs`;
}

/**
 * Builds the display path for the selected module destination.
 */
export function targetPath(): string {
    return appState.selectedPath ?
        `${appState.selectedPath}/${appState.moduleName}.rs` :
        `${appState.moduleName}.rs`;
}
