/**
 * Preserves the reading position inside collapsible sections when a message
 * is re-rendered during streaming.
 *
 * Message elements are rebuilt from state on every progress update. Without
 * this module each rebuilt `<details>` would start closed and scrolled to
 * the top, snapping the Thinking or Tool activity panel shut while the user
 * is reading it. Disclosures opt in by carrying a stable `data-disclosure`
 * key. Bodies that were scrolled to the bottom keep following new output.
 */

/**
 * Pixel tolerance used to decide that a body was scrolled to its bottom.
 */
const DISCLOSURE_BOTTOM_TOLERANCE_PX = 4;

/**
 * Collects the reading position of every open disclosure inside a message.
 *
 * @param {Element | null} root - Previously rendered message element.
 * @returns {Map<string, {scrollTop: number, atBottom: boolean}>} Reading
 *   position keyed by `data-disclosure`. Empty when the root is missing.
 */
function openDisclosurePositions(root) {
    const positions = new Map();
    if (!root) {
        return positions;
    }
    const nodes = root.querySelectorAll('details[data-disclosure][open]');
    nodes.forEach(node => {
        positions.set(
            node.dataset.disclosure,
            disclosureBodyPosition(node),
        );
    });
    return positions;
}

/**
 * Re-opens disclosures in a freshly rendered message and restores scroll.
 *
 * Only keys present in the new element are affected; keys that no longer
 * exist are ignored so a removed section cannot throw.
 *
 * @param {Element} root - Newly rendered message element.
 * @param {Map<string, {scrollTop: number, atBottom: boolean}>} positions -
 *   Positions returned by `openDisclosurePositions`.
 * @returns {void}
 */
function restoreOpenDisclosures(root, positions) {
    if (!root || positions.size === 0) {
        return;
    }
    const nodes = root.querySelectorAll('details[data-disclosure]');
    nodes.forEach(node => {
        const position = positions.get(node.dataset.disclosure);
        if (!position) {
            return;
        }
        node.open = true;
        restoreDisclosureBodyPosition(node, position);
    });
}

/**
 * Reads the scroll position of the scrollable body inside one disclosure.
 *
 * @param {HTMLDetailsElement} node - Open disclosure being replaced.
 * @returns {{scrollTop: number, atBottom: boolean}} Current position, or
 *   the top when the disclosure has no scrollable body.
 */
function disclosureBodyPosition(node) {
    const body = disclosureBody(node);
    if (!body) {
        return { scrollTop: 0, atBottom: false };
    }
    const remaining = body.scrollHeight - body.clientHeight - body.scrollTop;
    return {
        scrollTop: body.scrollTop,
        atBottom: remaining <= DISCLOSURE_BOTTOM_TOLERANCE_PX,
    };
}

/**
 * Applies a saved scroll position to the body of a rebuilt disclosure.
 *
 * Scroll is applied after the browser lays out the new body so the target
 * offsets exist. Readers who were following the end keep following it.
 *
 * @param {HTMLDetailsElement} node - Freshly rendered disclosure.
 * @param {{scrollTop: number, atBottom: boolean}} position - Saved reading
 *   position captured from the replaced disclosure.
 * @returns {void}
 */
function restoreDisclosureBodyPosition(node, position) {
    const body = disclosureBody(node);
    if (!body) {
        return;
    }
    window.requestAnimationFrame(() => {
        body.scrollTop = position.atBottom
            ? Math.max(0, body.scrollHeight - body.clientHeight)
            : position.scrollTop;
    });
}

/**
 * Finds the scrollable body element directly inside one disclosure.
 *
 * @param {HTMLDetailsElement} node - Disclosure whose body is needed.
 * @returns {HTMLElement | null} The body, or null for summary-only nodes.
 */
function disclosureBody(node) {
    return node.querySelector(':scope > pre, :scope > .tool-events-list');
}