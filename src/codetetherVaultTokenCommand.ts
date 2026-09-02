/**
 * Provides the user-facing command for one-time Vault AppRole bootstrap.
 */

import * as vscode from 'vscode';

import {
    CodetetherVaultTokenManager,
    VaultTokenLease
} from './codetetherVaultToken';

const COMMAND_ID = 'rustyRefactor.configureCodetetherVaultToken';

/**
 * Registers the password-masked Vault AppRole bootstrap workflow.
 *
 * The callback lets process owners recycle children that inherited an older
 * environment without coupling this focused UI module to those processes.
 */
export function registerCodetetherVaultTokenCommand(
    manager: CodetetherVaultTokenManager,
    onTokenStored: () => void
): vscode.Disposable {
    return vscode.commands.registerCommand(COMMAND_ID, async () => {
        await configureCodetetherVaultToken(manager, onTokenStored);
    });
}

/**
 * Uses a bootstrap token once to acquire and store AppRole credentials.
 *
 * The administrator token is discarded after Vault issues a fresh client
 * token through AppRole login. Process recycling occurs only after success.
 */
async function configureCodetetherVaultToken(
    manager: CodetetherVaultTokenManager,
    onTokenStored: () => void
): Promise<void> {
    const token = await vscode.window.showInputBox({
        title: 'Bootstrap Codetether Vault Access',
        prompt: 'Enter an administrator token for one-time AppRole setup.',
        placeHolder: 'Vault bootstrap token',
        password: true,
        ignoreFocusOut: true
    });
    if (token === undefined) {
        return;
    }

    try {
        const lease = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Bootstrapping Codetether Vault AppRole...'
            },
            async () => manager.bootstrapToken(token)
        );
        onTokenStored();
        vscode.window.showInformationMessage(successMessage(lease));
    } catch (error) {
        const message = error instanceof Error
            ? error.message
            : String(error);
        vscode.window.showErrorMessage(
            `Codetether Vault bootstrap failed: ${message}`
        );
    }
}

/**
 * Summarizes the newly issued client-token lease without revealing it.
 */
function successMessage(lease: VaultTokenLease): string {
    const renewal = lease.renewable
        ? 'Automatic renewal is active.'
        : 'This token is not renewable.';
    const minutes = Math.max(1, Math.floor(lease.ttlSeconds / 60));
    return `Codetether AppRole configured; Vault issued a new `
        + `${minutes} minute client token. ${renewal}`;
}
