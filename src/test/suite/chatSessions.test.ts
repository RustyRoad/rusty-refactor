import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { JSDOM } from 'jsdom';
import { ChatControlMarkup } from '../../sidebar/chatControlMarkup';
import {
    ChatSessionControlsMarkup
} from '../../sidebar/chatSessionControlsMarkup';
import {
    ChatTopControlsMarkup
} from '../../sidebar/chatTopControlsMarkup';

interface SessionBrowserGlobals {
    postedMessages: SessionHostMessage[];
    acquireVsCodeApi: () => {
        postMessage: (message: unknown) => void;
    };
    getChatState: () => {
        sessions: SessionFixture[];
        chatThreads: ChatThreadFixture[];
        activeThreadId: string;
    };
    renderSessions: (sessions: SessionFixture[]) => void;
    renderChatThreads: (
        threads: ChatThreadFixture[],
        activeThreadId: string
    ) => void;
    renderActiveThreadTranscript: (_emptyText: string) => void;
    setBusy: (_busy: boolean, _message: string) => void;
}

interface SessionFixture {
    id: string;
    path: string;
    preview: string;
    turnCount: number;
    updatedAt?: number | string;
}

interface ChatThreadFixture {
    id: string;
    title: string;
    busy: boolean;
    statusText: string;
    updatedAt: string;
    sessionId: string;
}

/**
 * Captures one webview message posted by a session browser gesture.
 */
interface SessionHostMessage {
    type?: string;
    value?: {
        id?: string;
        path?: string;
    };
}

/**
 * Resolves one production browser asset from the repository root.
 */
function productionAssetPath(...segments: string[]): string {
    return path.resolve(
        __dirname,
        '..',
        '..',
        '..',
        ...segments,
    );
}

/**
 * Executes one classic browser script in the shared JSDOM global scope.
 */
function executeBrowserScript(dom: JSDOM, assetPath: string): void {
    const source = fs.readFileSync(assetPath, 'utf8');
    const script = dom.window.document.createElement('script');
    script.textContent = source;
    dom.window.document.head.appendChild(script);
}

/**
 * Creates a session selector loaded with its production browser scripts.
 */
function createSessionDom(): JSDOM {
    const dom = new JSDOM(
        [
            '<!DOCTYPE html>',
            '<html>',
            '<head></head>',
            '<body>',
            '<span id="sessions-caption"></span>',
            '<span id="active-sessions-count"></span>',
            '<span id="previous-sessions-count"></span>',
            '<button id="active-sessions-tab"></button>',
            '<button id="previous-sessions-tab"></button>',
            '<div id="active-sessions-view"></div>',
            '<div id="previous-sessions-view"></div>',
            '<div id="active-sessions-list"></div>',
            '<div id="sessions-list"></div>',
            '<input id="session-id-input">',
            '</body>',
            '</html>',
        ].join(''),
        {
            runScripts: 'dangerously',
            url: 'https://chat.test/',
        },
    );
    const browser = dom.window as unknown as SessionBrowserGlobals;
    browser.postedMessages = [];
    browser.acquireVsCodeApi = () => {
        return {
            postMessage: message => browser.postedMessages.push(
                message as SessionHostMessage
            )
        };
    };
    executeBrowserScript(
        dom,
        productionAssetPath(
            'media',
            'chat-sidebar-state.generated.js',
        ),
    );
    executeBrowserScript(
        dom,
        productionAssetPath('media', 'chat-sidebar-core.js'),
    );
    browser.renderActiveThreadTranscript = () => {};
    browser.setBusy = () => {};
    executeBrowserScript(
        dom,
        productionAssetPath('media', 'chat-sidebar-session-actions.js'),
    );
    executeBrowserScript(
        dom,
        productionAssetPath('media', 'chat-sidebar-sessions.js'),
    );
    assert.strictEqual(typeof browser.renderSessions, 'function');
    return dom;
}

/**
 * Creates one live chat row for browser rendering tests.
 */
function threadFixture(
    id: string,
    title: string,
    busy: boolean
): ChatThreadFixture {
    return {
        id,
        title,
        busy,
        statusText: busy ? 'Using tools...' : 'Ready',
        updatedAt: '2026-08-21T12:00:00Z',
        sessionId: `${id}-session`
    };
}

/**
 * Creates one selector session with focused display metadata.
 */
function sessionFixture(
    id: string,
    preview: string,
    updatedAt?: number | string,
): SessionFixture {
    return {
        id,
        path: `C:\\sessions\\${id}`,
        preview,
        turnCount: 3,
        updatedAt,
    };
}

/**
 * Verifies a browser gesture posted the selected persisted-session identity.
 */
function assertSessionWindowRequest(
    browser: SessionBrowserGlobals,
    session: SessionFixture
): void {
    const request = browser.postedMessages.find(message => {
        return message.type === 'openChatWindow';
    });

    assert.ok(request);
    assert.strictEqual(request.value?.id, session.id);
    assert.strictEqual(request.value?.path, session.path);
}

/**
 * Waits beyond the browser gesture delay used to distinguish double-clicks.
 */
async function waitForSessionSingleClick(dom: JSDOM): Promise<void> {
    await new Promise<void>(resolve => {
        dom.window.setTimeout(resolve, 280);
    });
}

/**
 * Formats the expected localized timestamp independently of the UI script.
 */
function expectedSessionDate(value: number | string): string {
    return new Date(value).toLocaleString([], {
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        month: 'short',
        year: 'numeric',
    });
}

/**
 * Verifies selector state and DOM rows are ordered from newest to oldest.
 */
function sortsSessionsByMostRecent(): void {
    const dom = createSessionDom();
    const browser = dom.window as unknown as SessionBrowserGlobals;
    browser.renderSessions([
        sessionFixture('old', 'Old session', '2026-01-01T12:00:00Z'),
        sessionFixture('new', 'New session', '2026-08-18T20:00:00Z'),
        sessionFixture('middle', 'Middle session', '2026-05-10T12:00:00Z'),
    ]);

    const titles = dom.window.document.querySelectorAll('.session-title');
    assert.strictEqual(titles[0].textContent, 'New session');
    assert.strictEqual(titles[1].textContent, 'Middle session');
    assert.strictEqual(titles[2].textContent, 'Old session');
    assert.deepStrictEqual(
        browser.getChatState().sessions.map((session) => session.id),
        ['new', 'middle', 'old'],
    );
    dom.window.close();
}

/**
 * Verifies each session row includes a full localized date and time.
 */
function displaysSessionDate(): void {
    const dom = createSessionDom();
    const browser = dom.window as unknown as SessionBrowserGlobals;
    const timestamp = '2026-08-18T20:15:00Z';
    browser.renderSessions([
        sessionFixture('dated', 'Dated session', timestamp),
    ]);

    const meta = dom.window.document.querySelector('.session-meta');
    assert.ok(meta);
    assert.strictEqual(
        meta.textContent,
        `3 turns - ${expectedSessionDate(timestamp)}`,
    );
    dom.window.close();
}

/**
 * Verifies invalid timestamps sort last and receive a visible placeholder.
 */
function handlesMissingSessionDate(): void {
    const dom = createSessionDom();
    const browser = dom.window as unknown as SessionBrowserGlobals;
    browser.renderSessions([
        sessionFixture('missing', 'Missing date'),
        sessionFixture('valid', 'Valid date', '2026-08-18T20:15:00Z'),
    ]);

    const titles = dom.window.document.querySelectorAll('.session-title');
    const metadata = dom.window.document.querySelectorAll('.session-meta');
    assert.strictEqual(titles[0].textContent, 'Valid date');
    assert.strictEqual(titles[1].textContent, 'Missing date');
    assert.match(metadata[1].textContent || '', /unknown date/);
    dom.window.close();
}

/**
 * Verifies single-clicking a saved session still opens it in the current chat.
 */
async function opensSessionOnSingleClick(): Promise<void> {
    const dom = createSessionDom();
    const browser = dom.window as unknown as SessionBrowserGlobals;
    const session = sessionFixture('clicked', 'Clicked session');
    browser.renderSessions([session]);

    const row = dom.window.document.querySelector('.session-item');
    assert.ok(row);
    row.dispatchEvent(new dom.window.MouseEvent('click', {
        bubbles: true,
    }));
    await waitForSessionSingleClick(dom);

    const request = browser.postedMessages.find(message => {
        return message.type === 'openSession';
    });
    assert.strictEqual(request?.value?.id, session.id);
    assert.strictEqual(request?.value?.path, session.path);
    dom.window.close();
}

/**
 * Verifies double-clicking a saved session requests a populated pop-out.
 */
async function opensSessionWindowOnDoubleClick(): Promise<void> {
    const dom = createSessionDom();
    const browser = dom.window as unknown as SessionBrowserGlobals;
    const session = sessionFixture(
        'double-clicked',
        'Double-clicked session'
    );
    browser.renderSessions([session]);

    const row = dom.window.document.querySelector('.session-item');
    assert.ok(row);
    row.dispatchEvent(new dom.window.MouseEvent('click', {
        bubbles: true,
    }));
    row.dispatchEvent(new dom.window.MouseEvent('click', {
        bubbles: true,
    }));
    row.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true,
    }));
    await waitForSessionSingleClick(dom);

    assertSessionWindowRequest(browser, session);
    assert.ok(!browser.postedMessages.some(message => {
        return message.type === 'openSession';
    }));
    dom.window.close();
}

/**
 * Verifies a saved session context menu exposes the pop-out action.
 */
function opensSessionWindowFromContextMenu(): void {
    const dom = createSessionDom();
    const browser = dom.window as unknown as SessionBrowserGlobals;
    const session = sessionFixture(
        'right-clicked',
        'Right-clicked session'
    );
    browser.renderSessions([session]);

    const row = dom.window.document.querySelector('.session-item');
    assert.ok(row);
    row.dispatchEvent(new dom.window.MouseEvent('contextmenu', {
        bubbles: true,
        clientX: 20,
        clientY: 20,
    }));
    const menuItem = dom.window.document.querySelector(
        '.session-context-menu-item'
    ) as HTMLButtonElement | null;
    assert.strictEqual(menuItem?.textContent, 'Open in New Window');
    menuItem?.click();

    assertSessionWindowRequest(browser, session);
    dom.window.close();
}

/**
 * Verifies running chats and the selected thread remain independently visible.
 */
function rendersLiveChatThreads(): void {
    const dom = createSessionDom();
    const browser = dom.window as unknown as SessionBrowserGlobals;
    browser.renderChatThreads([
        threadFixture('chat-1', 'Background build', true),
        threadFixture('chat-2', 'Current review', false),
    ], 'chat-2');

    const rows = dom.window.document.querySelectorAll('.chat-thread-item');
    assert.strictEqual(rows.length, 2);
    assert.ok(rows[0].classList.contains('running'));
    assert.ok(rows[1].classList.contains('selected'));
    assert.strictEqual(browser.getChatState().activeThreadId, 'chat-2');
    dom.window.close();
}

/**
 * Verifies production markup exposes new-chat and both session browser views.
 */
function exposesThreadBrowserControls(): void {
    const dom = new JSDOM([
        '<!DOCTYPE html><html><body>',
        new ChatTopControlsMarkup().markup(),
        new ChatSessionControlsMarkup().markup(),
        '</body></html>',
    ].join(''));

    assert.ok(dom.window.document.getElementById('new-chat-btn'));
    assert.ok(dom.window.document.getElementById('active-sessions-view'));
    assert.ok(dom.window.document.getElementById('previous-sessions-view'));
    assert.strictEqual(
        dom.window.document.querySelectorAll('.session-tab').length,
        2
    );
    dom.window.close();
}

/**
 * Verifies the composer exposes a distinct hard-interrupt control.
 */
function exposesHardInterruptControl(): void {
    const dom = new JSDOM([
        '<!DOCTYPE html><html><body>',
        new ChatControlMarkup().inputControls(),
        '</body></html>',
    ].join(''));
    const button = dom.window.document.getElementById('interrupt-btn');

    assert.ok(button);
    assert.strictEqual(button.getAttribute('aria-label'),
        'Interrupt active response');
    assert.ok(button.hasAttribute('disabled'));
    dom.window.close();
}

/**
 * Registers selector ordering, date display, and invalid-date coverage.
 */
function registerSessionSelectorTests(): void {
    test('sorts sessions by most recent', sortsSessionsByMostRecent);
    test('displays the session date', displaysSessionDate);
    test('handles missing session dates', handlesMissingSessionDate);
    test(
        'opens a saved session in place on single-click',
        opensSessionOnSingleClick
    );
    test(
        'opens a saved session window on double-click',
        opensSessionWindowOnDoubleClick
    );
    test(
        'opens a saved session window from its context menu',
        opensSessionWindowFromContextMenu
    );
    test('renders independent live chat threads', rendersLiveChatThreads);
    test('exposes a hard-interrupt control', exposesHardInterruptControl);
    test(
        'exposes active and previous chat controls',
        exposesThreadBrowserControls
    );
}

suite('Codetether chat session selector', registerSessionSelectorTests);