import { appState } from './app-state';
import { element } from './dom';
import { updateCreateButtonLabel } from './selection-button';
import type { DataUpdateMessage } from './types';

/**
 * Renders module context shown at the top of the picker.
 *
 * The selected code is truncated to a compact preview so large selections do
 * not dominate the destination browsing experience.
 */
export function updateData(message: DataUpdateMessage): void {
    appState.moduleName = message.moduleName;
    element('module-name').textContent = appState.moduleName;
    updateCreateButtonLabel();
    element('code-preview').textContent = previewSelectedCode(
        message.selectedCode,
    );
}

/**
 * Builds compact selected-code preview text for the header.
 *
 * The preview keeps long selections from pushing destination controls below
 * the fold while still confirming which code is being extracted.
 */
function previewSelectedCode(selectedCode: string): string {
    const preview = selectedCode.substring(0, 100);
    const suffix = selectedCode.length > 100 ? '...' : '';
    return `${preview}${suffix}`;
}
