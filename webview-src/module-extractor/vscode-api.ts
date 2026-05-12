import type { VSCodeAPI } from './types';

declare function acquireVsCodeApi(): VSCodeAPI;

/**
 * Provides the single VS Code API instance for browser-host messaging.
 *
 * Keeping acquisition here avoids scattering the VS Code global dependency
 * across rendering modules and keeps tests able to replace this boundary.
 */
export const vscode = acquireVsCodeApi();
