import type { CodetetherModelOptions } from './codetetherModelOptions';
import { codetetherModelOptionsKey } from './codetetherModelOptions';

/**
 * Builds the identity of one immutable extension-managed server process.
 *
 * A workspace can run concurrent chats with different models or runtime
 * options. Including every process-level input prevents one chat from
 * replacing another chat's server and terminating its active socket.
 */
export function codetetherManagedServerKey(
    workspaceUri: string,
    binaryPath: string,
    model: string,
    modelOptions: CodetetherModelOptions
): string {
    return JSON.stringify([
        workspaceUri,
        binaryPath,
        model,
        codetetherModelOptionsKey(model, modelOptions)
    ]);
}