import { appState } from './app-state';
import { log } from './logger';
import { vscode } from './vscode-api';

/**
 * Confirms the selected destination with the extension host.
 *
 * The extension computes the final module file path after normalizing the
 * selected workspace-relative destination.
 */
export function handleConfirm(): void {
    if (appState.selectedPath !== null) {
        vscode.postMessage({
            command: 'confirmSelection',
            selectedPath: appState.selectedPath,
        });
        return;
    }

    log('warn', 'Confirm requested without a selected destination.');
}

/**
 * Cancels the picker through the extension host.
 *
 * The host resolves the pending selection promise and disposes the webview.
 */
export function handleCancel(): void {
    vscode.postMessage({ command: 'cancel' });
}
