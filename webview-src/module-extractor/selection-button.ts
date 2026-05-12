import { appState } from './app-state';
import { element } from './dom';
import { destinationPrompt, targetPath } from './selection-label';

/**
 * Enables or disables the confirmation button based on selection state.
 *
 * The button label includes the concrete selected folder so users understand
 * where the module will be extracted before confirming.
 */
export function updateButtonState(): void {
    const btn = element<HTMLButtonElement>('create-btn');
    const hasSelection = appState.selectedPath !== null;
    btn.disabled = !hasSelection;
    btn.classList.toggle('disabled', !hasSelection);
    updateCreateButtonLabel();
}

/**
 * Updates confirmation button copy for the current selected path.
 *
 * This avoids misleading text that implies the target is only the module
 * filename rather than a directory-specific module path.
 */
export function updateCreateButtonLabel(): void {
    const label = element('create-btn-label');
    if (!appState.moduleName) {
        label.textContent = 'Select a destination';
        return;
    }

    if (appState.selectedPath === null) {
        label.textContent = destinationPrompt();
        return;
    }

    label.textContent = `Extract to ${targetPath()}`;
}
