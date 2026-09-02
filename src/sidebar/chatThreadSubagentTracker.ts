import {
    CodetetherSubagentActivity,
    coordinatorSubagentActivity,
    finishSubagentActivity,
    mergeSubagentActivity,
    subagentActivityFromToolEvents
} from '../codetetherSubagentActivity';
import type { CodetetherToolEvent } from '../codetetherToolEvents';
import type { ChatMode, CodetetherFeature } from './chatTypes';
import { SubagentSessionMonitor } from './subagentSessionMonitor';

/**
 * Receives the sub-agent rows belonging to the selected chat thread.
 */
export type ChatThreadSubagentSink = (
    activities: CodetetherSubagentActivity[]
) => void;

/**
 * Owns sub-agent monitors and activity snapshots per concurrent chat thread.
 */
export class ChatThreadSubagentTracker {
    private readonly activities = new Map<
        string,
        CodetetherSubagentActivity[]
    >();
    private readonly monitors = new Map<string, SubagentSessionMonitor>();
    private activeThreadId = '';

    /**
     * Creates a tracker with explicit workspace and UI collaborators.
     */
    public constructor(
        private readonly workspacePath: () => string,
        private readonly sink: ChatThreadSubagentSink
    ) {}

    /**
     * Selects which thread's coordination rows are visible in the sidebar.
     */
    public select(threadId: string): void {
        this.activeThreadId = threadId;
        this.publish(threadId);
    }

    /**
     * Starts coordination tracking when one thread may delegate work.
     */
    public start(
        threadId: string,
        mode: ChatMode,
        feature: CodetetherFeature
    ): void {
        this.stopMonitor(threadId);
        if (!this.shouldTrack(mode, feature)) {
            this.activities.set(threadId, []);
            this.publish(threadId);
            return;
        }

        this.activities.set(threadId, [coordinatorSubagentActivity()]);
        this.publish(threadId);
        const workspacePath = this.workspacePath();
        if (!workspacePath) {
            return;
        }

        const monitor = new SubagentSessionMonitor(
            workspacePath,
            rows => this.merge(threadId, rows)
        );
        this.monitors.set(threadId, monitor);
        monitor.start();
    }

    /**
     * Refreshes one thread from its monitor or an on-demand snapshot reader.
     */
    public async refresh(threadId: string): Promise<boolean> {
        const workspacePath = this.workspacePath();
        if (!workspacePath) {
            return false;
        }

        const monitor = this.monitors.get(threadId)
            || new SubagentSessionMonitor(workspacePath, () => {});
        this.merge(threadId, await monitor.snapshot());
        return true;
    }

    /**
     * Stops polling when a response is interrupted for steering or clearing.
     */
    public interrupt(threadId: string): void {
        this.stopMonitor(threadId);
    }

    /**
     * Finalizes one thread's activity rows after its response terminates.
     */
    public finish(
        threadId: string,
        succeeded: boolean,
        toolEvents: CodetetherToolEvent[] = []
    ): void {
        this.stopMonitor(threadId);
        const current = this.activities.get(threadId) || [];
        const toolRows = subagentActivityFromToolEvents(toolEvents);
        if (current.length === 0 && toolRows.length === 0) {
            this.activities.set(threadId, []);
            this.publish(threadId);
            return;
        }

        const merged = mergeSubagentActivity(current, toolRows);
        this.activities.set(
            threadId,
            finishSubagentActivity(merged, succeeded)
        );
        this.publish(threadId);
    }

    /**
     * Stops every polling timer when the webview host is disposed.
     */
    public dispose(): void {
        for (const monitor of this.monitors.values()) {
            monitor.stop();
        }
        this.monitors.clear();
    }

    /**
     * Returns whether a mode or feature can produce delegated activity.
     */
    private shouldTrack(
        mode: ChatMode,
        feature: CodetetherFeature
    ): boolean {
        return mode === 'orchestrate'
            || feature === 'swarm'
            || feature === 'prd';
    }

    /**
     * Merges one monitor snapshot into its thread-owned activity state.
     */
    private merge(
        threadId: string,
        rows: CodetetherSubagentActivity[]
    ): void {
        const current = this.activities.get(threadId) || [];
        this.activities.set(
            threadId,
            mergeSubagentActivity(current, rows)
        );
        this.publish(threadId);
    }

    /**
     * Stops and removes one thread's active filesystem monitor.
     */
    private stopMonitor(threadId: string): void {
        this.monitors.get(threadId)?.stop();
        this.monitors.delete(threadId);
    }

    /**
     * Sends rows only when their owning thread is selected.
     */
    private publish(threadId: string): void {
        if (threadId !== this.activeThreadId) {
            return;
        }

        this.sink(this.activities.get(threadId) || []);
    }
}
