import type { CodetetherToolEvent } from '../codetetherToolEvents';
import type {
    WorkspaceFileChangeObserver
} from '../workspaceFileChangeService';

/**
 * Correlates workspace file events independently for concurrent chat threads.
 */
export class ChatThreadFileTracker {
    private readonly markers = new Map<string, number>();
    private readonly observedResults = new Map<string, Set<string>>();

    /**
     * Creates a tracker over the shared workspace event journal.
     */
    public constructor(
        private readonly workspaceFiles: WorkspaceFileChangeObserver
    ) {}

    /**
     * Starts correlating workspace events with one thread's next response.
     */
    public start(threadId: string): void {
        this.markers.set(threadId, this.workspaceFiles.mark());
        this.observedResults.set(threadId, new Set<string>());
    }

    /**
     * Reports file changes once for each completed tool event in a thread.
     */
    public observe(threadId: string, event: CodetetherToolEvent): void {
        const observed = this.observedResults.get(threadId);
        const marker = this.markers.get(threadId);
        if (event.kind !== 'result'
                || marker === undefined
                || !observed
                || observed.has(event.id)) {
            return;
        }

        observed.add(event.id);
        void this.workspaceFiles.observeAfterToolActivity(
            marker,
            `thread ${threadId} tool ${event.name || event.id}`
        );
    }

    /**
     * Performs a final observation when transport tool telemetry is partial.
     */
    public finish(threadId: string): void {
        const marker = this.markers.get(threadId);
        if (marker === undefined) {
            return;
        }

        const observation = this.workspaceFiles.observeAfterToolActivity(
            marker,
            `completed chat thread ${threadId}`
        );
        void observation.finally(() => {
            this.markers.delete(threadId);
            this.observedResults.delete(threadId);
        });
    }
}
