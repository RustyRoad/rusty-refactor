/**
 * Updates one streamed message without replacing its stateful DOM nodes.
 *
 * Replacing the complete wrapper on every token makes an open Thinking panel
 * disappear for a frame before it is recreated. This updater keeps existing
 * disclosure nodes attached and changes only their text and child rows.
 */

/**
 * Applies a freshly rendered snapshot to its existing message wrapper.
 *
 * @param {HTMLElement} existing - Visible wrapper retained in the document.
 * @param {HTMLElement} rendered - Detached wrapper for the newest state.
 * @returns {HTMLElement} The retained visible wrapper.
 */
function updateRenderedMessage(existing, rendered) {
    existing.className = rendered.className;
    updatePlainSection(existing, rendered, '.meta');
    updatePlainSection(existing, rendered, '.message');
    updateDisclosureSection(existing, rendered, '.thinking-event');
    updateDisclosureSection(existing, rendered, '.tool-events');
    updatePlainSection(existing, rendered, '.model-signature');
    updatePlainSection(existing, rendered, '.message-actions');
    return existing;
}

/**
 * Replaces one stateless direct child while keeping the wrapper attached.
 *
 * @param {HTMLElement} existing - Visible message wrapper.
 * @param {HTMLElement} rendered - Detached latest wrapper.
 * @param {string} selector - Class selector for one direct child.
 * @returns {void}
 */
function updatePlainSection(existing, rendered, selector) {
    const current = directMessageChild(existing, selector);
    const next = directMessageChild(rendered, selector);
    if (current && next) {
        current.replaceWith(next);
    } else if (current) {
        current.remove();
    } else if (next) {
        insertInRenderedOrder(existing, rendered, next);
    }
}

/**
 * Updates an optional disclosure without detaching an existing open node.
 *
 * @param {HTMLElement} existing - Visible message wrapper.
 * @param {HTMLElement} rendered - Detached latest wrapper.
 * @param {string} selector - Disclosure class selector.
 * @returns {void}
 */
function updateDisclosureSection(existing, rendered, selector) {
    const current = directMessageChild(existing, selector);
    const next = directMessageChild(rendered, selector);
    if (current && next) {
        updateDisclosure(current, next);
    } else if (current) {
        current.remove();
    } else if (next) {
        insertInRenderedOrder(existing, rendered, next);
    }
}

/**
 * Updates one disclosure's label and body while preserving open and scroll.
 *
 * @param {HTMLDetailsElement} current - Attached disclosure.
 * @param {HTMLDetailsElement} next - Detached disclosure snapshot.
 * @returns {void}
 */
function updateDisclosure(current, next) {
    const position = current.open
        ? disclosureBodyPosition(current)
        : undefined;
    current.className = next.className;
    current.dataset.disclosure = next.dataset.disclosure;
    const currentSummary = directMessageChild(current, 'summary');
    const nextSummary = directMessageChild(next, 'summary');
    if (currentSummary && nextSummary) {
        currentSummary.textContent = nextSummary.textContent;
    }

    const currentPre = directMessageChild(current, 'pre');
    const nextPre = directMessageChild(next, 'pre');
    if (currentPre && nextPre) {
        currentPre.textContent = nextPre.textContent;
    }
    updateToolRows(current, next);
    if (position) {
        restoreDisclosureBodyPosition(current, position);
    }
}

/**
 * Synchronizes tool rows by stable disclosure key without closing open rows.
 *
 * @param {HTMLDetailsElement} current - Attached tool timeline.
 * @param {HTMLDetailsElement} next - Detached tool timeline snapshot.
 * @returns {void}
 */
function updateToolRows(current, next) {
    const currentList = directMessageChild(current, '.tool-events-list');
    const nextList = directMessageChild(next, '.tool-events-list');
    if (!currentList || !nextList) {
        return;
    }
    const nextKeys = new Set();
    Array.from(nextList.children).forEach(nextRow => {
        const key = nextRow.dataset.disclosure;
        nextKeys.add(key);
        const currentRow = Array.from(currentList.children).find(row => {
            return row.dataset.disclosure === key;
        });
        if (currentRow) {
            updateDisclosure(currentRow, nextRow);
            return;
        }
        nextRow.open = false;
        currentList.appendChild(nextRow);
    });
    Array.from(currentList.children).forEach(row => {
        if (!nextKeys.has(row.dataset.disclosure)) {
            row.remove();
        }
    });
}

/**
 * Finds one direct child without matching nested message content.
 *
 * @param {HTMLElement} parent - Element whose immediate children are searched.
 * @param {string} selector - Selector matched against immediate children.
 * @returns {HTMLElement | undefined} Matching direct child when present.
 */
function directMessageChild(parent, selector) {
    return Array.from(parent.children).find(child => {
        return child.matches(selector);
    });
}

/**
 * Inserts a new optional section at the order used by the latest rendering.
 *
 * @param {HTMLElement} existing - Attached message wrapper.
 * @param {HTMLElement} rendered - Detached latest wrapper.
 * @param {HTMLElement} next - New child to insert.
 * @returns {void}
 */
function insertInRenderedOrder(existing, rendered, next) {
    const renderedChildren = Array.from(rendered.children);
    const nextIndex = renderedChildren.indexOf(next);
    const following = renderedChildren.slice(nextIndex + 1);
    const anchor = following.map(child => {
        return directMessageChild(existing, sectionSelector(child));
    }).find(Boolean);
    existing.insertBefore(next, anchor || null);
}

/**
 * Returns the stable selector for one top-level rendered message section.
 *
 * @param {Element} element - Rendered section whose counterpart is needed.
 * @returns {string} Class or tag selector for the section.
 */
function sectionSelector(element) {
    const className = Array.from(element.classList)[0];
    return className ? '.' + className : element.tagName.toLowerCase();
}