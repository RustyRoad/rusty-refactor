import MarkdownIt from 'markdown-it';
import type { RenderRule } from 'markdown-it/lib/renderer.mjs';

const markdown = new MarkdownIt({
    breaks: true,
    html: false,
    linkify: true,
    typographer: false,
});

const defaultLinkOpen = markdown.renderer.rules.link_open;

/**
 * Maps Markdown table alignment declarations to CSP-compatible CSS classes.
 */
function tableAlignmentClass(style: string | null): string {
    switch (style) {
        case 'text-align:center':
            return 'markdown-align-center';
        case 'text-align:right':
            return 'markdown-align-right';
        default:
            return 'markdown-align-left';
    }
}

/**
 * Replaces Markdown-it table styles with classes allowed by the webview CSP.
 */
const renderTableCellOpen: RenderRule = (
    tokens,
    index,
    options,
    _environment,
    renderer,
): string => {
    const token = tokens[index];
    const styleIndex = token.attrIndex('style');
    const style = token.attrGet('style');
    if (styleIndex >= 0 && token.attrs) {
        token.attrs.splice(styleIndex, 1);
    }
    token.attrJoin('class', tableAlignmentClass(style));
    return renderer.renderToken(tokens, index, options);
};

markdown.renderer.rules.th_open = renderTableCellOpen;
markdown.renderer.rules.td_open = renderTableCellOpen;

/**
 * Adds safe browser behavior to links emitted by the Markdown renderer.
 *
 * Markdown-it validates unsafe URL schemes before this rule runs. The added
 * attributes keep accepted links outside the webview browsing context.
 */
markdown.renderer.rules.link_open = (
    tokens,
    index,
    options,
    environment,
    renderer,
): string => {
    const token = tokens[index];
    token.attrSet('target', '_blank');
    token.attrSet('rel', 'noreferrer noopener');

    if (defaultLinkOpen) {
        return defaultLinkOpen(
            tokens,
            index,
            options,
            environment,
            renderer,
        );
    }

    return renderer.renderToken(tokens, index, options);
};

/**
 * Converts assistant Markdown into escaped, CommonMark-compatible HTML.
 *
 * Raw HTML is disabled in the configured renderer. Markdown-it also rejects
 * unsafe link schemes, so the returned markup is suitable for the chat
 * message container without granting assistants arbitrary HTML execution.
 */
function renderMarkdown(source: string): string {
    return markdown.render(source || '');
}

declare global {
    interface Window {
        CodetetherMarkdown: {
            render: typeof renderMarkdown;
        };
    }
}

window.CodetetherMarkdown = Object.freeze({
    render: renderMarkdown,
});
