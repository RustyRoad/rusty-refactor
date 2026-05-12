import { vscode } from './vscode-api';

/**
 * Sends warn/error diagnostics to the extension output channel.
 *
 * Lower-level logs stay in browser devtools to keep normal extension output
 * readable during successful extraction flows.
 */
export function log(level: string, message: string, data?: unknown): void {
    if (level === 'warn' || level === 'error') {
        vscode.postMessage({ command: 'log', level, message, data });
    }

    if (level === 'error') {
        console.error(message, data ?? '');
        return;
    }

    console.log(message, data ?? '');
}

/**
 * Converts unknown thrown values into serializable diagnostic details.
 *
 * The extension receives plain objects only, avoiding structured clone failures
 * from Error instances with non-serializable properties.
 */
export function errorDetails(error: unknown): Record<string, string> {
    if (error instanceof Error) {
        return { message: error.message, stack: error.stack ?? '' };
    }

    return { message: String(error) };
}
