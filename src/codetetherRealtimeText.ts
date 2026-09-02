import { realtimeString } from './codetetherRealtimeFields';
import type {
    CodetetherThreadEvent
} from './codetetherRealtimeTypes';

/**
 * Converts cumulative item snapshots into append-only UI deltas.
 */
export class CodetetherRealtimeText {
    private readonly snapshots = new Map<string, string>();

    /**
     * Applies one item event and returns only newly visible text.
     */
    public apply(event: CodetetherThreadEvent): string {
        const itemId = realtimeString(event.payload, 'item_id');
        const text = realtimeString(event.payload, 'text');
        const previous = this.snapshots.get(itemId) || '';
        this.snapshots.set(itemId, text);
        if (!text || text === previous) {
            return '';
        }
        return text.startsWith(previous)
            ? text.slice(previous.length)
            : text;
    }

    /**
     * Finalizes one cumulative item and releases its retained snapshot.
     *
     * The completed event may repeat the final text or omit it entirely. The
     * returned value is therefore the latest complete snapshot seen for the
     * item rather than only the event's incremental suffix.
     */
    public complete(event: CodetetherThreadEvent): string {
        const itemId = realtimeString(event.payload, 'item_id');
        const completed = realtimeString(event.payload, 'text');
        const text = completed || this.snapshots.get(itemId) || '';
        this.snapshots.delete(itemId);
        return text;
    }
}