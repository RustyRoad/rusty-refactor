import * as vscode from 'vscode';

import { logToOutput } from './extractor';
import {
    WorkspaceFileChange,
    WorkspaceFileChangeJournal
} from './workspaceFileChangeJournal';

const FILE_EVENT_WAIT_MS = 750;
const FILE_EVENT_POLL_MS = 25;

/**
 * Summarizes file events observed through the VS Code workspace API.
 */
export interface WorkspaceFileChangeSummary {
    observed: number;
    changes: WorkspaceFileChange[];
}

/**
 * Defines file-change observation used by agent workflows.
 */
export interface WorkspaceFileChangeObserver {
    /** Returns a marker excluding file events already observed. */
    mark(): number;

    /** Reports file events observed after the supplied marker. */
    observeAfterToolActivity(
        marker: number,
        source: string
    ): Promise<WorkspaceFileChangeSummary>;
}

/**
 * Observes external tool edits without changing the active VS Code view.
 */
export class WorkspaceFileChangeService implements
    WorkspaceFileChangeObserver,
    vscode.Disposable {
    private readonly journal = new WorkspaceFileChangeJournal();
    private readonly watcher: vscode.FileSystemWatcher;
    private readonly subscriptions: vscode.Disposable[] = [];

    /**
     * Starts one recursive watcher covering every open workspace folder.
     */
    public constructor() {
        this.watcher = vscode.workspace.createFileSystemWatcher('**/*');
        this.subscriptions.push(this.watcher);
        this.watcher.onDidCreate(
            this.recordCreated,
            this,
            this.subscriptions
        );
        this.watcher.onDidChange(
            this.recordChanged,
            this,
            this.subscriptions
        );
        this.watcher.onDidDelete(
            this.recordDeleted,
            this,
            this.subscriptions
        );
    }

    /**
     * Returns a marker for correlating later events with one model run.
     */
    public mark(): number {
        return this.journal.mark();
    }

    /**
     * Waits for and reports VS Code events from one model run.
     */
    public async observeAfterToolActivity(
        marker: number,
        source: string
    ): Promise<WorkspaceFileChangeSummary> {
        await this.waitForEvents(marker);
        const changes = this.journal.since(marker);
        this.logSummary(source, changes);
        return { observed: changes.length, changes };
    }

    /**
     * Stops the workspace watcher and all registered event listeners.
     */
    public dispose(): void {
        vscode.Disposable.from(...this.subscriptions).dispose();
    }

    /**
     * Records one create notification delivered by VS Code.
     */
    private recordCreated(uri: vscode.Uri): void {
        this.record('created', uri);
    }

    /**
     * Records one content-change notification delivered by VS Code.
     */
    private recordChanged(uri: vscode.Uri): void {
        this.record('changed', uri);
    }

    /**
     * Records one delete notification delivered by VS Code.
     */
    private recordDeleted(uri: vscode.Uri): void {
        this.record('deleted', uri);
    }

    /**
     * Adds one normalized workspace-relative event to the journal.
     */
    private record(
        kind: WorkspaceFileChange['kind'],
        uri: vscode.Uri
    ): void {
        const relativePath = vscode.workspace.asRelativePath(uri, true);
        this.journal.record(kind, relativePath);
    }

    /**
     * Allows delayed remote file-watcher events to reach the extension host.
     */
    private async waitForEvents(marker: number): Promise<void> {
        const deadline = Date.now() + FILE_EVENT_WAIT_MS;
        while (this.journal.since(marker).length === 0
                && Date.now() < deadline) {
            await this.pause(FILE_EVENT_POLL_MS);
        }
    }

    /**
     * Pauses polling without blocking the extension-host event loop.
     */
    private pause(milliseconds: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, milliseconds));
    }

    /**
     * Writes concise runtime evidence that VS Code observed tool mutations.
     */
    private logSummary(
        source: string,
        changes: WorkspaceFileChange[]
    ): void {
        const paths = changes.slice(0, 5).map(change => {
            return `${change.kind} ${change.path}`;
        });
        const detail = paths.length > 0
            ? `: ${paths.join(', ')}`
            : '; no file events observed';
        logToOutput(
            `[Codetether Files] ${source}: VS Code observed `
            + `${changes.length} workspace change(s)${detail}.`
        );
    }
}
