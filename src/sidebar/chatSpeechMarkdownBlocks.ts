const LIST_LINE = /^\s*(?:[-+*]|\d+[.)])\s+/u;
const TABLE_DIVIDER = /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/u;
const INDENTED_CODE = /^(?: {4}|\t)\S/u;
const QUOTE_LINE = /^\s*>/u;

/**
 * Returns narrative Markdown blocks suitable for spoken output.
 */
export function spokenMarkdownBlocks(markdown: string): string[] {
    const blocks = withoutFencedCode(markdown)
        .split(/\r?\n\s*\r?\n/u)
        .map(block => block.trim())
        .filter(Boolean);
    return blocks.filter((block, index) => {
        if (isStructuredBlock(block)) {
            return false;
        }
        return !isStructuredLeadIn(block, blocks[index + 1]);
    });
}

/**
 * Removes fenced code while preserving narrative surrounding it.
 */
function withoutFencedCode(markdown: string): string {
    let fence = '';
    const kept: string[] = [];
    for (const line of markdown.split(/\r?\n/u)) {
        const delimiter = line.trimStart().match(/^(```|~~~)/u)?.[1];
        if (delimiter) {
            fence = fence ? '' : delimiter;
            continue;
        }
        if (!fence) {
            kept.push(line);
        }
    }
    return kept.join('\n');
}

/**
 * Identifies list, table, quote, and indented-code blocks.
 */
function isStructuredBlock(block: string): boolean {
    const lines = block.split(/\r?\n/u).filter(Boolean);
    return lines.some(line => LIST_LINE.test(line))
        || lines.some(line => TABLE_DIVIDER.test(line))
        || lines.every(line => INDENTED_CODE.test(line))
        || lines.every(line => QUOTE_LINE.test(line));
}

/**
 * Omits labels whose only purpose is to introduce a skipped block.
 */
function isStructuredLeadIn(block: string, next?: string): boolean {
    return block.endsWith(':')
        && Boolean(next)
        && isStructuredBlock(next || '');
}
