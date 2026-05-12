import { vscode } from './vscode-api';

/**
 * Requests a directory change from the extension host.
 *
 * The extension owns filesystem access, so browser code only passes the
 * workspace-relative destination path.
 */
export function selectDirectory(path: string): void {
    vscode.postMessage({ command: 'selectDirectory', path });
}
