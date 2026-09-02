/**
 * Finds workspace-like source paths in assistant response text.
 *
 * References may include a one-based line and column suffix. URLs and paths
 * inside fenced Markdown code blocks are intentionally ignored.
 *
 * @param {string} content - Raw assistant response text.
 * @returns {object[]} Distinct workspace file references in display order.
 */
function findWorkspaceFileReferences(content) {
    const source = withoutFencedCode(String(content || ''));
    const pattern = [
        /(?:[A-Za-z]:[\\/]|\.{0,2}[\\/])?/.source,
        /(?:[A-Za-z0-9_@.-]+[\\/])+/.source,
        /[A-Za-z0-9_@.-]+\.[A-Za-z0-9]+/.source,
        /(?::\d+(?::\d+)?)?/.source,
    ].join('');
    const matches = source.matchAll(new RegExp(pattern, 'g'));
    const references = [];
    const seen = new Set();

    for (const match of matches) {
        const value = match[0];
        const offset = match.index || 0;
        if (looksLikeUrlReference(source, offset)) {
            continue;
        }
        const reference = parseWorkspaceFileReference(value);
        const key = reference.path + ':' + (reference.line || '')
            + ':' + (reference.column || '');
        if (!seen.has(key)) {
            seen.add(key);
            references.push(reference);
        }
    }
    return references;
}

/**
 * Blanks fenced code while retaining offsets used for URL detection.
 *
 * @param {string} content - Markdown source to filter.
 * @returns {string} Source with fenced blocks replaced by spaces.
 */
function withoutFencedCode(content) {
    return content.replace(/```[\s\S]*?```/g, block => {
        return ' '.repeat(block.length);
    });
}

/**
 * Rejects path-shaped substrings that are part of a URL.
 *
 * @param {string} source - Filtered assistant response text.
 * @param {number} offset - Candidate path start offset.
 * @returns {boolean} Whether the candidate follows a URL scheme.
 */
function looksLikeUrlReference(source, offset) {
    const prefix = source.slice(Math.max(0, offset - 64), offset);
    const token = prefix.split(/\s/).pop() || '';
    return /[A-Za-z][A-Za-z0-9+.-]*:\/$/.test(token)
        || token.includes('://');
}

/**
 * Separates a file path from optional one-based location suffixes.
 *
 * @param {string} value - Matched path with optional line and column.
 * @returns {object} Structured file reference for the extension host.
 */
function parseWorkspaceFileReference(value) {
    const location = value.match(/:(\d+)(?::(\d+))?$/);
    const suffixLength = location ? location[0].length : 0;
    return {
        path: suffixLength ? value.slice(0, -suffixLength) : value,
        line: location ? Number(location[1]) : undefined,
        column: location && location[2]
            ? Number(location[2])
            : undefined,
    };
}

/**
 * Adds compact open-file indicators beneath one assistant response.
 *
 * @param {HTMLElement} message - Rendered assistant message bubble.
 * @param {string} content - Raw assistant response text.
 * @returns {void}
 */
function appendWorkspaceFileIndicators(message, content) {
    const references = findWorkspaceFileReferences(content);
    if (references.length === 0) {
        return;
    }

    const fallbackReferences = references.filter(reference => {
        return !insertWorkspaceFileIndicator(message, reference);
    });
    if (fallbackReferences.length === 0) {
        return;
    }

    const indicators = document.createElement('div');
    indicators.className = 'workspace-file-indicators';
    indicators.setAttribute('aria-label', 'Referenced workspace files');
    fallbackReferences.forEach(reference => {
        indicators.appendChild(createWorkspaceFileIndicator(reference));
    });
    message.appendChild(indicators);
}

/**
 * Inserts a micro open button immediately after a rendered source path.
 *
 * @param {HTMLElement} message - Rendered assistant message bubble.
 * @param {object} reference - File path and optional source position.
 * @returns {boolean} Whether an inline text occurrence was decorated.
 */
function insertWorkspaceFileIndicator(message, reference) {
    const sourceText = workspaceFileReferenceText(reference);
    const match = findWorkspaceFileTextNode(message, sourceText);
    if (!match) {
        return false;
    }

    const remainder = match.node.splitText(match.offset + sourceText.length);
    remainder.parentNode.insertBefore(
        createWorkspaceFileIndicator(reference, true),
        remainder
    );
    return true;
}

/**
 * Finds a visible text-node occurrence eligible for inline decoration.
 *
 * @param {HTMLElement} message - Rendered assistant message bubble.
 * @param {string} sourceText - Complete path and optional location suffix.
 * @returns {object|undefined} Text node and match offset, when found.
 */
function findWorkspaceFileTextNode(message, sourceText) {
    const walker = document.createTreeWalker(message, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
        const parent = node.parentElement;
        const skipped = parent?.closest(
            'a, button, pre, code, .workspace-file-indicators'
        );
        const offset = skipped ? -1 : node.data.indexOf(sourceText);
        if (offset >= 0) {
            return { node, offset };
        }
        node = walker.nextNode();
    }
    return undefined;
}

/**
 * Creates one micro button that asks VS Code to open a referenced file.
 *
 * @param {object} reference - File path and optional source position.
 * @param {boolean} [inline] - Whether only the inline arrow is displayed.
 * @returns {HTMLButtonElement} Detached workspace file indicator.
 */
function createWorkspaceFileIndicator(reference, inline) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'workspace-file-indicator'
        + (inline ? ' inline' : '');
    button.title = workspaceFileIndicatorTitle(reference);
    button.setAttribute('aria-label', button.title);

    const icon = document.createElement('span');
    icon.className = 'workspace-file-indicator-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '\u2197';
    button.appendChild(icon);
    if (!inline) {
        const label = document.createElement('span');
        label.className = 'workspace-file-indicator-label';
        label.textContent = workspaceFileIndicatorLabel(reference);
        button.appendChild(label);
    }
    button.onclick = () => {
        postTelemetry('openWorkspaceFile', { path: reference.path });
        vscode.postMessage({
            type: 'openWorkspaceFile',
            value: reference,
        });
    };
    return button;
}

/**
 * Recreates the visible source reference used to find its rendered text node.
 *
 * @param {object} reference - File path and optional source position.
 * @returns {string} Path with optional line and column suffixes.
 */
function workspaceFileReferenceText(reference) {
    return reference.path
        + (reference.line ? ':' + reference.line : '')
        + (reference.column ? ':' + reference.column : '');
}

/**
 * Builds the short filename displayed by a workspace file indicator.
 *
 * @param {object} reference - File path and optional source position.
 * @returns {string} Basename with an optional line suffix.
 */
function workspaceFileIndicatorLabel(reference) {
    const parts = reference.path.split(/[\\/]/);
    const basename = parts[parts.length - 1] || reference.path;
    return basename + (reference.line ? ':' + reference.line : '');
}

/**
 * Builds accessible hover text for a workspace file indicator.
 *
 * @param {object} reference - File path and optional source position.
 * @returns {string} Complete open-file description.
 */
function workspaceFileIndicatorTitle(reference) {
    const location = reference.line
        ? ' at line ' + reference.line
            + (reference.column ? ', column ' + reference.column : '')
        : '';
    return 'Open ' + reference.path + location;
}