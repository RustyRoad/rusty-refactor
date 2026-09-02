import * as assert from 'assert';
import { readFileSync } from 'fs';
import { Script, createContext } from 'vm';

import { extensionTestPath } from './extensionTestPath';

interface RefreshTelemetry {
    source?: string;
}

/**
 * Verifies selector interactions request fresh Codetether model snapshots.
 */
function revalidatesWhenSelectorOpens(): void {
    const posted: unknown[] = [];
    const telemetry: RefreshTelemetry[] = [];
    const clock = { now: 1_000 };
    const context = createContext({
        Date: { now: () => clock.now },
        getChatState: () => ({ activeProvider: '' }),
        logUiAction: () => undefined,
        postTelemetry: (
            _event: string,
            detail: RefreshTelemetry
        ) => telemetry.push(detail),
        vscode: {
            postMessage: (message: unknown) => posted.push(message)
        }
    });
    const events = readFileSync(
        extensionTestPath('media', 'chat-sidebar-events.js'),
        'utf8'
    );
    new Script(events).runInContext(context);

    new Script('refreshModelsForSelector();').runInContext(context);
    new Script('refreshModelsForSelector();').runInContext(context);
    clock.now = 2_000;
    new Script('refreshModelsForSelector();').runInContext(context);

    assert.strictEqual(posted.length, 2);
    assert.deepStrictEqual(
        telemetry.map(detail => detail.source),
        ['selector', 'selector']
    );
}

/**
 * Verifies pointer and keyboard entry both trigger selector revalidation.
 */
function wiresSelectorRefreshEvents(): void {
    const bootstrap = readFileSync(
        extensionTestPath('media', 'chat-sidebar.js'),
        'utf8'
    );

    assert.ok(
        bootstrap.includes(
            'modelInput.onfocus = refreshModelsForSelector;'
        )
    );
    assert.ok(
        bootstrap.includes(
            'modelInput.onpointerdown = refreshModelsForSelector;'
        )
    );
}

/**
 * Verifies authoritative snapshots evict stale configured and selected IDs.
 */
function evictsModelsMissingFromLiveSnapshot(): void {
    const context = createContext({ window: {} });
    const stateRuntime = readFileSync(
        extensionTestPath(
            'media',
            'chat-sidebar-state.generated.js'
        ),
        'utf8'
    );
    new Script(stateRuntime).runInContext(context);
    const api = (context.window as any).CodetetherChatState;
    let state = api.createInitialState();
    state = api.reduce(state, {
        type: 'setSelectedModel',
        value: { model: 'zai/glm-5' }
    });
    state = api.reduce(state, {
        type: 'modelsListed',
        value: {
            models: [{
                id: 'bedrock/claude',
                name: 'Claude',
                provider: 'bedrock'
            }],
            configuredModel: ''
        }
    });

    assert.strictEqual(state.selectedModel, '');
    assert.deepStrictEqual(
        Array.from(state.models, (model: any) => model.id),
        ['bedrock/claude']
    );
}

/**
 * Registers cached-selector endpoint refresh tests.
 */
function defineChatModelRefreshTests(): void {
    test('revalidates when the selector opens', revalidatesWhenSelectorOpens);
    test('wires focus and pointer refresh events', wiresSelectorRefreshEvents);
    test(
        'evicts models missing from live endpoint',
        evictsModelsMissingFromLiveSnapshot
    );
}

suite('Chat model refresh', defineChatModelRefreshTests);
