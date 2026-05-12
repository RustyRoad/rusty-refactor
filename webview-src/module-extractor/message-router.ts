import { updateData } from './data-view';
import { updateDirectory } from './directory-controller';
import { updateCurrentPathDisplay } from './path-display';
import { errorDetails, log } from './logger';
import type { DataUpdateMessage } from './types';
import type { DirectoryUpdateMessage, ExtensionMessage } from './types';

/**
 * Handles typed messages sent by the extension host.
 *
 * Unknown or malformed messages are reported but ignored so a stale extension
 * message cannot break all webview interaction.
 */
export function handleExtensionMessage(event: MessageEvent): void {
    const message = event.data as ExtensionMessage;
    if (!message || typeof message.command !== 'string') {
        log('warn', 'Received malformed extension message.', message);
        return;
    }

    try {
        routeMessage(message.command, event.data);
    } catch (error) {
        log('error', 'Failed handling extension message.', errorDetails(error));
    }
}

/**
 * Dispatches a validated command to its focused handler.
 *
 * Keeping dispatch separate from error handling makes the supported protocol
 * commands explicit and keeps handler failures uniformly reported.
 */
function routeMessage(command: string, data: unknown): void {
    if (command === 'updateData') {
        updateData(data as DataUpdateMessage);
    } else if (command === 'updateDirectory') {
        updateDirectory(data as DirectoryUpdateMessage);
    } else if (command === 'updateCurrentPath') {
        updateCurrentPathDisplay((data as ExtensionMessage).currentPath ?? '');
    } else {
        log('warn', `Unknown extension command: ${command}`);
    }
}
