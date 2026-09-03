import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { JSDOM } from 'jsdom';

import { ChatScriptAssets } from '../../sidebar/chatScriptAssets';

interface ChatBrowserGlobals {
    postedMessages: BrowserHostMessage[];
    acquireVsCodeApi: () => {
        postMessage: (message: unknown) => void;
    };
    dispatchChatState: (
        action: string,
        value: Record<string, unknown>
    ) => object;
    getRequestModel: () => string;
    appendMessage: (
        role: string,
        content: string,
        isError: boolean,
        toolEvents?: object[],
        sessionId?: string,
        modelId?: string,
    ) => object;
    createSpeechButton: () => Element;
    queueVoiceInputAfterSpeech: (messageId: string) => void;
    startSpeech: (record: object) => void;
    syncStreamingSpeech: (record: object) => void;
    upsertStreamingMessage: (snapshot: object) => object;
}

/**
 * Captures a message sent from the rendered chat to its extension host.
 */
interface BrowserHostMessage {
    type?: string;
    value?: {
        column?: number;
        line?: number;
        path?: string;
    };
}

/**
 * Resolves one production asset from the repository root during tests.
 */
function productionAssetPath(segments: string[]): string {
    return path.resolve(
        __dirname,
        '..',
        '..',
        '..',
        ...segments,
    );
}

/**
 * Adds a production script as a classic browser script in shared global scope.
 */
function executeBrowserScript(dom: JSDOM, segments: string[]): void {
    const source = fs.readFileSync(
        productionAssetPath(segments),
        'utf8',
    );
    const script = dom.window.document.createElement('script');
    script.textContent = source;
    dom.window.document.head.appendChild(script);
}

/**
 * Discards speech callbacks that are unrelated to Markdown presentation.
 */
function ignoreSpeechAction(_value: unknown): void {}

/**
 * Creates a browser document loaded with the production Markdown message path.
 */
function createChatDom(): JSDOM {
    const dom = new JSDOM(
        [
            '<!DOCTYPE html>',
            '<html>',
            '<head></head>',
            '<body>',
            '<div id="chat-container">',
            '<div id="empty-state">Empty</div>',
            '</div>',
            '</body>',
            '</html>',
        ].join(''),
        {
            pretendToBeVisual: true,
            runScripts: 'dangerously',
            url: 'https://chat.test/',
        },
    );
    const browser = dom.window as unknown as ChatBrowserGlobals;
    browser.postedMessages = [];
    browser.acquireVsCodeApi = () => {
        return {
            postMessage: message => browser.postedMessages.push(
                message as BrowserHostMessage
            )
        };
    };
    browser.createSpeechButton = () => {
        return dom.window.document.createElement('button');
    };
    browser.queueVoiceInputAfterSpeech = ignoreSpeechAction;
    browser.startSpeech = ignoreSpeechAction;
    browser.syncStreamingSpeech = ignoreSpeechAction;

    const executableNames = new Set([
        'chat-sidebar-markdown.js',
        'chat-sidebar-state.generated.js',
        'chat-sidebar-core.js',
        'chat-sidebar-workspace-files.js',
        'chat-sidebar-disclosure-state.js',
        'chat-sidebar-message-update.js',
        'chat-sidebar-messages.js',
    ]);
    for (const assetPath of new ChatScriptAssets().paths()) {
        const name = assetPath[assetPath.length - 1];
        if (executableNames.has(name)) {
            executeBrowserScript(dom, assetPath);
        }
    }

    assert.strictEqual(typeof browser.appendMessage, 'function');
    assert.strictEqual(typeof browser.upsertStreamingMessage, 'function');
    return dom;
}

/**
 * Verifies assistant Markdown reaches semantic DOM through the real scripts.
 */
function rendersAssistantMessageDom(): void {
    const dom = createChatDom();
    const browser = dom.window as unknown as ChatBrowserGlobals;
    browser.appendMessage(
        'assistant',
        [
            '# Result',
            '',
            '- one',
            '- two',
            '',
            '[docs](https://example.com)',
        ].join('\n'),
        false,
    );

    const message = dom.window.document.querySelector('.message.assistant');
    assert.ok(message);
    assert.strictEqual(message.querySelector('h1')?.textContent, 'Result');
    assert.strictEqual(message.querySelectorAll('li').length, 2);
    assert.strictEqual(
        message.querySelector('a')?.getAttribute('target'),
        '_blank',
    );
    dom.window.close();
}

/**
 * Verifies new and streaming messages do not change the reading position.
 */
function preservesTranscriptScrollPosition(): void {
    const dom = createChatDom();
    const browser = dom.window as unknown as ChatBrowserGlobals;
    const transcript = dom.window.document.getElementById(
        'chat-container'
    );
    assert.ok(transcript);
    Object.defineProperty(transcript, 'scrollHeight', {
        configurable: true,
        value: 1000
    });
    transcript.scrollTop = 137;

    browser.appendMessage('assistant', 'First response.', false);
    assert.strictEqual(transcript.scrollTop, 137);
    browser.upsertStreamingMessage({
        id: 'stream-position-1',
        content: 'Streaming response.',
        streaming: true,
    });
    assert.strictEqual(transcript.scrollTop, 137);
    browser.upsertStreamingMessage({
        id: 'stream-position-1',
        content: 'Completed response.',
        streaming: false,
    });
    assert.strictEqual(transcript.scrollTop, 137);
    dom.window.close();
}

/**
 * Verifies live reasoning stays closed outside the user-facing response.
 */
function separatesThinkingFromResponse(): void {
    const dom = createChatDom();
    const browser = dom.window as unknown as ChatBrowserGlobals;
    browser.upsertStreamingMessage({
        id: 'reasoning-1',
        content: 'Changed: fixed the cache key.',
        thinking: 'I will inspect the cache implementation.',
        streaming: true,
    });

    const wrap = dom.window.document.querySelector(
        '[data-message-id="reasoning-1"]'
    );
    const response = wrap?.querySelector('.message.assistant');
    const thinking = wrap?.querySelector('.thinking-event');
    assert.ok(response);
    assert.ok(thinking);
    assert.match(response.textContent || '', /Changed: fixed the cache key/);
    assert.doesNotMatch(response.textContent || '', /I will inspect/);
    assert.strictEqual(
        thinking.querySelector('pre')?.textContent,
        'I will inspect the cache implementation.'
    );
    assert.strictEqual(thinking.hasAttribute('open'), false);
    dom.window.close();
}

/**
 * Verifies an opened Thinking panel stays open while reasoning streams in.
 */
function keepsOpenedThinkingOpenWhileStreaming(): void {
    const dom = createChatDom();
    const browser = dom.window as unknown as ChatBrowserGlobals;
    const document = dom.window.document;
    const snapshot = {
        id: 'reasoning-open-1',
        content: '',
        thinking: 'First reasoning chunk.',
        streaming: true,
        toolEvents: [
            { kind: 'call', id: 'call-1', name: 'read', arguments: '{}' },
        ],
    };
    browser.upsertStreamingMessage(snapshot);

    const selector = '[data-message-id="reasoning-open-1"]';
    const firstThinking = document.querySelector(
        selector + ' .thinking-event'
    ) as HTMLDetailsElement | null;
    const firstTools = document.querySelector(
        selector + ' .tool-events'
    ) as HTMLDetailsElement | null;
    assert.ok(firstThinking);
    assert.ok(firstTools);
    firstThinking.open = true;
    firstTools.open = true;

    browser.upsertStreamingMessage({
        ...snapshot,
        thinking: 'First reasoning chunk. Second chunk.',
    });

    const thinking = document.querySelector(selector + ' .thinking-event');
    const tools = document.querySelector(selector + ' .tool-events');
    assert.ok(thinking);
    assert.ok(tools);
    assert.strictEqual(thinking, firstThinking);
    assert.strictEqual(thinking.hasAttribute('open'), true);
    assert.strictEqual(tools.hasAttribute('open'), true);
    assert.match(thinking.textContent || '', /Second chunk/);
    dom.window.close();
}

/**
 * Gives one scrollable disclosure body a fixed layout for scroll tests.
 */
function defineScrollableBody(
    body: HTMLElement,
    scrollHeight: number,
    clientHeight: number,
): void {
    Object.defineProperty(body, 'scrollHeight', {
        configurable: true,
        value: scrollHeight,
    });
    Object.defineProperty(body, 'clientHeight', {
        configurable: true,
        value: clientHeight,
    });
}

/**
 * Verifies the Thinking panel keeps its reading position across rerenders.
 *
 * A reader parked mid-way stays there; a reader at the bottom keeps
 * following the newest reasoning text.
 */
async function preservesThinkingScrollWhileStreaming(): Promise<void> {
    const dom = createChatDom();
    const browser = dom.window as unknown as ChatBrowserGlobals;
    const document = dom.window.document;
    const selector = '[data-message-id="reasoning-scroll-1"] .thinking-event';
    const snapshot = {
        id: 'reasoning-scroll-1',
        content: '',
        thinking: 'Chunk one.',
        streaming: true,
    };
    const nextFrame = (): Promise<void> => new Promise(resolve => {
        dom.window.requestAnimationFrame(() => resolve());
    });
    const bodyOf = (): HTMLElement => {
        const body = document.querySelector(selector + ' > pre');
        assert.ok(body);
        return body as HTMLElement;
    };

    browser.upsertStreamingMessage(snapshot);
    const first = document.querySelector(selector) as HTMLDetailsElement;
    first.open = true;
    defineScrollableBody(bodyOf(), 1000, 190);
    bodyOf().scrollTop = 250;

    browser.upsertStreamingMessage({ ...snapshot, thinking: 'Chunk two.' });
    defineScrollableBody(bodyOf(), 1200, 190);
    await nextFrame();
    assert.strictEqual(bodyOf().scrollTop, 250);

    bodyOf().scrollTop = 1200 - 190;
    browser.upsertStreamingMessage({
        ...snapshot,
        thinking: 'Chunk three.',
    });
    defineScrollableBody(bodyOf(), 1500, 190);
    await nextFrame();
    assert.strictEqual(bodyOf().scrollTop, 1500 - 190);
    dom.window.close();
}

/**
 * Verifies the configured default becomes explicit for delegation prompts.
 */
function resolvesConfiguredRequestModel(): void {
    const dom = createChatDom();
    const browser = dom.window as unknown as ChatBrowserGlobals;
    browser.dispatchChatState('modelsListed', {
        models: [],
        configuredModel: 'openai/gpt-5'
    });
    assert.strictEqual(browser.getRequestModel(), 'openai/gpt-5');

    browser.dispatchChatState('modelsListed', {
        models: [],
        configuredModel: ''
    });
    assert.strictEqual(browser.getRequestModel(), '');
    dom.window.close();
}

/**
 * Verifies source paths receive a safe, clickable micro indicator.
 */
function rendersWorkspaceFileIndicator(): void {
    const dom = createChatDom();
    const browser = dom.window as unknown as ChatBrowserGlobals;
    browser.appendMessage(
        'assistant',
        [
            'I found an issue in /api/src/dm.ts:42:7.',
            'Ignore https://example.com/assets/site.ts.',
            '```',
            '/api/src/hidden.ts',
            '```',
        ].join('\n'),
        false,
    );

    const indicators = dom.window.document.querySelectorAll(
        '.workspace-file-indicator'
    );
    assert.strictEqual(indicators.length, 1);
    const button = indicators[0] as HTMLButtonElement;
    assert.ok(button.classList.contains('inline'));
    assert.strictEqual(button.textContent, '\u2197');
    assert.match(
        button.previousSibling?.textContent || '',
        /\/api\/src\/dm\.ts:42:7$/
    );
    assert.strictEqual(
        button.getAttribute('aria-label'),
        'Open /api/src/dm.ts at line 42, column 7'
    );
    button.click();

    const request = browser.postedMessages.find(message => {
        return message.type === 'openWorkspaceFile';
    });
    assert.strictEqual(request?.value?.path, '/api/src/dm.ts');
    assert.strictEqual(request?.value?.line, 42);
    assert.strictEqual(request?.value?.column, 7);
    dom.window.close();
}

/**
 * Verifies user content remains plain text while assistant HTML stays inert.
 */
function preservesMessageTrustBoundary(): void {
    const dom = createChatDom();
    const browser = dom.window as unknown as ChatBrowserGlobals;
    browser.appendMessage(
        'assistant',
        '<img src=x onerror=alert(1)>',
        false,
    );
    browser.appendMessage(
        'user',
        '**literal**\n<script>alert(1)</script>',
        false,
    );

    const assistant = dom.window.document.querySelector(
        '.message.assistant',
    );
    const user = dom.window.document.querySelector('.message.user');
    assert.ok(assistant);
    assert.ok(user);
    assert.strictEqual(assistant.querySelector('img'), null);
    assert.match(assistant.textContent || '', /<img src=x/);
    assert.strictEqual(user.querySelector('strong'), null);
    assert.strictEqual(user.querySelector('script'), null);
    assert.match(user.textContent || '', /\*\*literal\*\*/);
    dom.window.close();
}

/**
 * Verifies streamed Markdown is replaced and reparsed as snapshots complete.
 */
function rerendersStreamingMarkdown(): void {
    const dom = createChatDom();
    const browser = dom.window as unknown as ChatBrowserGlobals;
    browser.upsertStreamingMessage({
        id: 'stream-1',
        content: '# Partial',
        streaming: true,
    });
    browser.upsertStreamingMessage({
        id: 'stream-1',
        content: '# Complete\n\n- item\n\nFixed src/api/dm.ts.',
        streaming: false,
    });

    const messages = dom.window.document.querySelectorAll(
        '[data-message-id="stream-1"]',
    );
    assert.strictEqual(messages.length, 1);
    assert.strictEqual(
        messages[0].querySelector('h1')?.textContent,
        'Complete',
    );
    assert.strictEqual(messages[0].querySelectorAll('li').length, 1);
    assert.strictEqual(
        messages[0].querySelectorAll('.workspace-file-indicator').length,
        1
    );
    assert.ok(messages[0].querySelector('.message-actions'));
    dom.window.close();
}

/**
 * Verifies newly streamed tool rows stay closed beside user-opened rows.
 */
function collapsesNewToolRowsWhileStreaming(): void {
    const dom = createChatDom();
    const browser = dom.window as unknown as ChatBrowserGlobals;
    const document = dom.window.document;
    const snapshot = {
        id: 'streaming-tools-1',
        content: '',
        streaming: true,
        toolEvents: [
            {
                kind: 'call',
                id: 'call-1',
                name: 'read',
                arguments: '{}',
            },
        ],
    };
    browser.upsertStreamingMessage(snapshot);

    const activity = document.querySelector(
        '[data-message-id="streaming-tools-1"] .tool-events'
    ) as HTMLDetailsElement | null;
    const first = activity?.querySelector(
        '[data-disclosure="tool-event:call:call-1"]'
    ) as HTMLDetailsElement | null;
    assert.ok(activity);
    assert.ok(first);
    activity.open = true;
    first.open = true;

    browser.upsertStreamingMessage({
        ...snapshot,
        toolEvents: [
            ...snapshot.toolEvents,
            {
                kind: 'call',
                id: 'call-2',
                name: 'search',
                arguments: '{}',
            },
        ],
    });

    const rows = activity.querySelectorAll('.tool-event');
    assert.strictEqual(rows.length, 2);
    assert.strictEqual((rows[0] as HTMLDetailsElement).open, true);
    assert.strictEqual((rows[1] as HTMLDetailsElement).open, false);
    dom.window.close();
}

/**
 * Verifies tool activity is grouped and collapsed until the user expands it.
 */
function collapsesToolActivity(): void {
    const dom = createChatDom();
    const browser = dom.window as unknown as ChatBrowserGlobals;
    browser.appendMessage(
        'assistant',
        'Completed with tools.',
        false,
        [
            {
                kind: 'call',
                name: 'read_file',
                id: 'call-1',
                arguments: '{"path":"README.md"}',
            },
            {
                kind: 'result',
                name: 'read_file',
                id: 'call-1',
                content: 'File contents',
            },
        ],
    );

    const activity = dom.window.document.querySelector('.tool-events');
    assert.ok(activity);
    assert.strictEqual(activity.tagName, 'DETAILS');
    assert.strictEqual(activity.hasAttribute('open'), false);
    assert.strictEqual(
        activity.querySelector(':scope > summary')?.textContent,
        'Tool activity (2)',
    );
    assert.strictEqual(activity.querySelectorAll('.tool-event').length, 2);
    dom.window.close();
}

/**
 * Registers end-to-end DOM coverage for static and streaming chat messages.
 */
function registerMessageIntegrationTests(): void {
    test(
        'renders assistant Markdown into the DOM',
        rendersAssistantMessageDom,
    );
    test(
        'makes the configured request model explicit',
        resolvesConfiguredRequestModel,
    );
    test(
        'renders clickable workspace file indicators',
        rendersWorkspaceFileIndicator,
    );
    test(
        'preserves the message trust boundary',
        preservesMessageTrustBoundary,
    );
    test('rerenders streaming Markdown', rerendersStreamingMarkdown);
    test(
        'keeps thinking outside the assistant response',
        separatesThinkingFromResponse,
    );
    test(
        'keeps an opened thinking panel open while streaming',
        keepsOpenedThinkingOpenWhileStreaming,
    );
    test(
        'preserves the thinking panel scroll position while streaming',
        preservesThinkingScrollWhileStreaming,
    );
    test(
        'preserves the transcript scroll position',
        preservesTranscriptScrollPosition,
    );
    test(
        'collapses newly streamed tool rows',
        collapsesNewToolRowsWhileStreaming,
    );
    test('collapses tool activity by default', collapsesToolActivity);
}

suite(
    'Codetether chat message Markdown integration',
    registerMessageIntegrationTests,
);