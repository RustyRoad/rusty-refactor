import * as assert from 'assert';

import {
    SidebarModelRevalidator,
    SidebarModelSnapshot
} from '../../sidebar/sidebarModelRevalidator';

/**
 * Builds one selector model for a deterministic endpoint snapshot.
 */
function model(id: string): SidebarModelSnapshot['models'][number] {
    const parts = id.split('/');

    return {
        id,
        name: parts.slice(1).join('/'),
        provider: parts[0]
    };
}

/**
 * Verifies every refresh calls discovery and replaces the previous snapshot.
 */
async function revalidatesEverySnapshot(): Promise<void> {
    const snapshots: SidebarModelSnapshot[] = [
        { models: [model('first/alpha')] },
        { models: [model('second/beta')] }
    ];
    const revalidator =
        new SidebarModelRevalidator<SidebarModelSnapshot>();
    let calls = 0;

    const discover = async (): Promise<SidebarModelSnapshot> => {
        const snapshot = snapshots[calls];
        calls += 1;
        return snapshot;
    };

    await revalidator.refresh(discover);
    assert.deepStrictEqual(
        revalidator.current().map(item => item.id),
        ['first/alpha']
    );

    const latest = await revalidator.refresh(discover);
    assert.strictEqual(calls, 2);
    assert.deepStrictEqual(
        latest.models.map(item => item.id),
        ['second/beta']
    );
    assert.deepStrictEqual(
        revalidator.current().map(item => item.id),
        ['second/beta']
    );
}

/**
 * Verifies an empty endpoint response removes every cached model.
 */
async function clearsCacheForEmptySnapshot(): Promise<void> {
    const revalidator =
        new SidebarModelRevalidator<SidebarModelSnapshot>();

    await revalidator.refresh(async () => ({
        models: [model('first/alpha')]
    }));
    await revalidator.refresh(async () => ({ models: [] }));

    assert.deepStrictEqual(revalidator.current(), []);
}

/**
 * Registers model endpoint revalidation regression tests.
 */
function defineSidebarModelRevalidatorTests(): void {
    test('revalidates every endpoint snapshot', revalidatesEverySnapshot);
    test('clears cached models for an empty endpoint snapshot', () => {
        return clearsCacheForEmptySnapshot();
    });
}

suite(
    'Sidebar model revalidator',
    defineSidebarModelRevalidatorTests
);
