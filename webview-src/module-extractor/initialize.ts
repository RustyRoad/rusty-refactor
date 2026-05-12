import { element, requireElements } from './dom';
import { errorDetails, log } from './logger';
import { handleCancel, handleConfirm } from './selection-actions';
import { renderLoadingState } from './loading-view';
import { vscode } from './vscode-api';

const REQUIRED_IDS = [
    'create-btn',
    'create-btn-label',
    'cancel-btn',
    'file-tree-content',
    'breadcrumb',
    'module-name',
    'code-preview',
] as const;

/**
 * Starts the module extractor browser application after the DOM is ready.
 *
 * Startup only validates static nodes, binds controls, shows loading feedback,
 * and notifies the extension host that data can be sent.
 */
export function initialize(): void {
    try {
        requireElements(REQUIRED_IDS);
        element('create-btn').addEventListener('click', handleConfirm);
        element('cancel-btn').addEventListener('click', handleCancel);
        renderLoadingState();
        vscode.postMessage({ command: 'ready' });
    } catch (error) {
        log('error', 'Failed to initialize webview.', errorDetails(error));
    }
}
