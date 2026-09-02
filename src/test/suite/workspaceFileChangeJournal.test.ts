import * as assert from 'assert';

import {
    WorkspaceFileChangeJournal
} from '../../workspaceFileChangeJournal';

/**
 * Verifies markers isolate mutations from the current model run.
 */
function reportsChangesAfterMarker(): void {
    const journal = new WorkspaceFileChangeJournal();
    journal.record('changed', 'src/before.ts');
    const marker = journal.mark();
    journal.record('created', 'src/after.ts');

    assert.deepStrictEqual(journal.since(marker), [{
        revision: 2,
        kind: 'created',
        path: 'src/after.ts'
    }]);
}

/**
 * Verifies callers cannot mutate retained journal entries through a result.
 */
function returnsDefensiveCopies(): void {
    const journal = new WorkspaceFileChangeJournal();
    journal.record('deleted', 'src/removed.ts');
    const first = journal.since(0);
    first[0].path = 'tampered';

    assert.strictEqual(journal.since(0)[0].path, 'src/removed.ts');
}

/**
 * Registers workspace file-change journal regression tests.
 */
function defineWorkspaceFileChangeJournalTests(): void {
    test('reports changes after a marker', reportsChangesAfterMarker);
    test('returns defensive copies', returnsDefensiveCopies);
}

suite(
    'Workspace file change journal',
    defineWorkspaceFileChangeJournalTests
);
