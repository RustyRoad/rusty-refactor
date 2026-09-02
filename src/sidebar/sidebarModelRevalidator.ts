import type { SidebarModelOption } from './chatTypes';

/**
 * Describes endpoint discovery data that contains selector-ready models.
 */
export interface SidebarModelSnapshot {
    models: SidebarModelOption[];
}

/**
 * Keeps the last model snapshot while revalidating against the endpoint.
 */
export class SidebarModelRevalidator<
    TSnapshot extends SidebarModelSnapshot
> {
    private cachedModels: SidebarModelOption[] = [];

    /**
     * Returns a detached copy for immediate selector hydration.
     */
    public current(): SidebarModelOption[] {
        return this.copyModels(this.cachedModels);
    }

    /**
     * Calls discovery and replaces the cache with its authoritative result.
     *
     * Empty endpoint snapshots intentionally clear older cached entries.
     */
    public async refresh(
        discover: () => Promise<TSnapshot>
    ): Promise<TSnapshot> {
        const snapshot = await discover();
        this.cachedModels = this.copyModels(snapshot.models);

        return {
            ...snapshot,
            models: this.current()
        };
    }

    /**
     * Copies model records so browser-facing mutations cannot alter the cache.
     */
    private copyModels(
        models: SidebarModelOption[]
    ): SidebarModelOption[] {
        return models.map(model => ({ ...model }));
    }
}
