/**
 * Names one file-system mutation observed through the VS Code API.
 */
export type WorkspaceFileChangeKind = 'created' | 'changed' | 'deleted';

/**
 * Captures one ordered workspace mutation without depending on VS Code.
 */
export interface WorkspaceFileChange {
    revision: number;
    kind: WorkspaceFileChangeKind;
    path: string;
}

const MAX_RETAINED_CHANGES = 500;

/**
 * Retains a bounded, ordered journal for one extension-host lifetime.
 */
export class WorkspaceFileChangeJournal {
    private revision = 0;
    private changes: WorkspaceFileChange[] = [];

    /**
     * Returns a marker that excludes every change already observed.
     */
    public mark(): number {
        return this.revision;
    }

    /**
     * Records one VS Code file event and advances the journal marker.
     */
    public record(kind: WorkspaceFileChangeKind, path: string): void {
        this.revision += 1;
        this.changes.push({
            revision: this.revision,
            kind,
            path
        });
        this.changes = this.changes.slice(-MAX_RETAINED_CHANGES);
    }

    /**
     * Returns retained mutations newer than the supplied marker.
     */
    public since(marker: number): WorkspaceFileChange[] {
        return this.changes
            .filter(change => change.revision > marker)
            .map(change => ({ ...change }));
    }
}
