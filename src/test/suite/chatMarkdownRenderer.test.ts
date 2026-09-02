import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

import { ChatScriptAssets } from '../../sidebar/chatScriptAssets';

type MarkdownRenderer = (source: string) => string;

interface MarkdownWindow {
    CodetetherMarkdown?: {
        render: MarkdownRenderer;
    };
}

/**
 * Resolves the generated browser asset exercised by the production webview.
 */
function markdownBundlePath(): string {
    return path.resolve(
        __dirname,
        '..',
        '..',
        'webview',
        'chat-sidebar-markdown.js',
    );
}

/**
 * Executes the production browser bundle in an isolated window sandbox.
 *
 * A missing global contract is treated as a test setup failure because the
 * sidebar cannot render assistant messages without it.
 */
function loadMarkdownRenderer(): MarkdownRenderer {
    const source = fs.readFileSync(markdownBundlePath(), 'utf8');
    const browserWindow: MarkdownWindow = {};
    const context = vm.createContext({
        window: browserWindow,
    });
    new vm.Script(source).runInContext(context);

    const contract = browserWindow.CodetetherMarkdown;
    assert.ok(contract, 'Markdown bundle did not register its window API');
    return contract.render;
}

/**
 * Verifies CommonMark block elements that the previous regex renderer lost.
 */
function rendersBlockMarkdown(): void {
    const html = loadMarkdownRenderer()([
        '# Heading',
        '',
        '1. first',
        '2. second',
        '',
        '- alpha',
        '- beta',
        '',
        '> quoted text',
        '',
        '---',
    ].join('\n'));

    assert.match(html, /<h1>Heading<\/h1>/);
    assert.match(html, /<ol>/);
    assert.match(html, /<ul>/);
    assert.match(html, /<blockquote>/);
    assert.match(html, /<hr>/);
}

/**
 * Verifies nested lists and paragraphs retain their document hierarchy.
 */
function rendersNestedMarkdown(): void {
    const html = loadMarkdownRenderer()([
        '1. parent',
        '   - child',
        '',
        '     child paragraph',
    ].join('\n'));

    assert.match(html, /<ol>/);
    assert.match(html, /<ul>/);
    assert.match(html, /child paragraph/);
    assert.ok(html.indexOf('<ul>') > html.indexOf('<ol>'));
}

/**
 * Verifies inline emphasis, deletion, code, and hard chat line breaks.
 */
function rendersInlineMarkdown(): void {
    const html = loadMarkdownRenderer()(
        '**bold** *emphasis* ~~removed~~ `value`\nnext line',
    );

    assert.match(html, /<strong>bold<\/strong>/);
    assert.match(html, /<em>emphasis<\/em>/);
    assert.match(html, /<s>removed<\/s>/);
    assert.match(html, /<code>value<\/code>/);
    assert.match(html, /<br>\s*next line/);
}

/**
 * Verifies fenced code preserves language metadata and escapes code text.
 */
function rendersFencedCode(): void {
    const html = loadMarkdownRenderer()([
        '```rust',
        'fn main() {',
        '    println!("<value> **literal**");',
        '}',
        '```',
    ].join('\n'));

    assert.match(html, /<code class="language-rust">/);
    assert.match(html, /&lt;value&gt; \*\*literal\*\*/);
    assert.doesNotMatch(html, /<strong>literal<\/strong>/);
}

/**
 * Verifies GitHub-style tables render with explicit header and body cells.
 */
function rendersTables(): void {
    const html = loadMarkdownRenderer()([
        '| Name | Value |',
        '| --- | ---: |',
        '| alpha | 1 |',
    ].join('\n'));

    assert.match(html, /<table>/);
    assert.match(
        html,
        /<th class="markdown-align-left">Name<\/th>/,
    );
    assert.match(
        html,
        /<th class="markdown-align-right">Value<\/th>/,
    );
    assert.match(
        html,
        /<td class="markdown-align-right">1<\/td>/,
    );
    assert.doesNotMatch(html, /style=/);
}

/**
 * Verifies explicit and detected links open outside the webview context.
 */
function rendersSafeLinks(): void {
    const html = loadMarkdownRenderer()(
        '[docs](https://example.com/docs) and https://example.com/api',
    );

    assert.match(html, /href="https:\/\/example.com\/docs"/);
    assert.match(html, /href="https:\/\/example.com\/api"/);
    assert.match(html, /target="_blank"/);
    assert.match(html, /rel="noreferrer noopener"/);
}

/**
 * Verifies assistant content cannot inject HTML or dangerous URL schemes.
 */
function rejectsUnsafeMarkup(): void {
    const html = loadMarkdownRenderer()([
        '<script>alert("raw")</script>',
        '',
        '<img src=x onerror=alert(1)>',
        '',
        '[script](javascript:alert(1))',
        '',
        '[data](data:text/html;base64,PHNjcmlwdD4=)',
        '',
        '[file](file:///etc/passwd)',
    ].join('\n'));

    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.doesNotMatch(html, /<script>/);
    assert.doesNotMatch(html, /<img src=/);
    assert.doesNotMatch(html, /href="javascript:/);
    assert.doesNotMatch(html, /href="data:/);
    assert.doesNotMatch(html, /href="file:/);
}

/**
 * Verifies partial streaming fragments remain renderable before completion.
 */
function rendersStreamingFragments(): void {
    const render = loadMarkdownRenderer();
    const incompleteFence = render([
        'Working **now',
        '',
        '```ts',
        'const value = 1;',
    ].join('\n'));
    const incompleteLink = render('See [the docs](https://example.com');

    assert.match(incompleteFence, /Working \*\*now/);
    assert.match(incompleteFence, /<code class="language-ts">/);
    assert.match(incompleteFence, /const value = 1;/);
    assert.match(incompleteLink, /See \[the docs\]/);
}

/**
 * Verifies empty assistant snapshots do not create an empty paragraph.
 */
function rendersEmptyContent(): void {
    assert.strictEqual(loadMarkdownRenderer()(''), '');
}

/**
 * Verifies the renderer bundle loads before scripts that consume its API.
 */
function loadsRendererBeforeMessages(): void {
    const paths = new ChatScriptAssets().paths();
    const markdownPath = [
        'out',
        'webview',
        'chat-sidebar-markdown.js',
    ];
    const messagePath = ['media', 'chat-sidebar-messages.js'];
    const markdownIndex = paths.findIndex((value) => {
        return value.join('/') === markdownPath.join('/');
    });
    const messageIndex = paths.findIndex((value) => {
        return value.join('/') === messagePath.join('/');
    });

    assert.strictEqual(fs.existsSync(markdownBundlePath()), true);
    assert.strictEqual(markdownIndex, 0);
    assert.ok(messageIndex > markdownIndex);
}

/**
 * Registers renderer behavior, safety, streaming, and integration coverage.
 */
function registerMarkdownRendererTests(): void {
    test('renders block Markdown', rendersBlockMarkdown);
    test('renders nested Markdown', rendersNestedMarkdown);
    test('renders inline Markdown', rendersInlineMarkdown);
    test('renders fenced code', rendersFencedCode);
    test('renders tables', rendersTables);
    test('renders safe links', rendersSafeLinks);
    test('rejects unsafe markup', rejectsUnsafeMarkup);
    test('renders streaming fragments', rendersStreamingFragments);
    test('renders empty content', rendersEmptyContent);
    test('loads before message rendering', loadsRendererBeforeMessages);
}

suite('Codetether chat Markdown renderer', registerMarkdownRendererTests);
