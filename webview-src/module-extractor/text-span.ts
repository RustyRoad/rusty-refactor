/**
 * Creates a span with class and text content.
 *
 * This helper prevents repeated DOM boilerplate while preserving safe text-only
 * rendering for all extension-provided labels.
 */
export function textSpan(className: string, text: string): HTMLElement {
    const span = document.createElement('span');
    span.className = className;
    span.textContent = text;
    return span;
}
