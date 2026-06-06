/**
 * Applies host-provided sub-agent activity to the sidebar view.
 *
 * @param {object[]} subagents - Activity rows from the extension host.
 * @param {string} summary - Compact panel summary from the host.
 * @returns {void}
 */
function renderSubagentActivity(subagents, summary) {
    const state = dispatchChatState('setSubagents', {
        subagents,
        summary,
    });
    const items = chatStateApi.subagents(state);

    subagentList.innerHTML = '';
    subagentSummary.textContent = chatStateApi.subagentSummaryText(state);
    renderSubagentCounters(items);
    subagentPanel.classList.toggle('visible', items.length > 0);

    items.forEach(appendSubagentItem);
}

/**
 * Requests a fresh sub-agent activity snapshot from the extension host.
 *
 * @returns {void}
 */
function refreshSubagents() {
    postTelemetry('refreshSubagents', { source: 'subagent-panel' });
    vscode.postMessage({ type: 'refreshSubagents' });
}

/**
 * Renders high-density counters above the activity rows.
 *
 * @param {object[]} items - Sub-agent activity records.
 * @returns {void}
 */
function renderSubagentCounters(items) {
    subagentCounters.innerHTML = '';
    [
        ['Rows', items.length],
        ['Run', countSubagentsByStatus(items, 'running')],
        ['Done', countSubagentsByStatus(items, 'completed')],
        ['Blocked', sumSubagentField(items, 'blockedCount')],
        ['Evidence', sumSubagentField(items, 'evidenceCount')],
    ].forEach(counter => {
        appendSubagentCounter(counter[0], counter[1]);
    });
}

/**
 * Counts rows matching one lifecycle status.
 *
 * @param {object[]} items - Activity rows to scan.
 * @param {string} status - Status value to count.
 * @returns {number} Number of matching rows.
 */
function countSubagentsByStatus(items, status) {
    return items.filter(item => subagentStatusClass(item) === status).length;
}

/**
 * Sums a numeric field across activity rows.
 *
 * @param {object[]} items - Activity rows to scan.
 * @param {string} field - Numeric field name to sum.
 * @returns {number} Sum of numeric values.
 */
function sumSubagentField(items, field) {
    return items.reduce((total, item) => {
        return total + Number(item[field] || 0);
    }, 0);
}

/**
 * Appends one compact counter chip to the panel.
 *
 * @param {string} label - Counter label.
 * @param {number} value - Counter value.
 * @returns {void}
 */
function appendSubagentCounter(label, value) {
    const chip = document.createElement('span');
    chip.className = 'subagent-counter';
    chip.textContent = label + ' ' + String(value);
    subagentCounters.appendChild(chip);
}

/**
 * Appends one activity row to the sub-agent panel.
 *
 * @param {object} item - Sub-agent activity record to display.
 * @returns {void}
 */
function appendSubagentItem(item) {
    const row = document.createElement('div');
    row.className = 'subagent-item ' + subagentStatusClass(item);

    const dot = document.createElement('span');
    dot.className = 'subagent-dot';

    const body = document.createElement('div');
    body.className = 'subagent-body';

    const title = document.createElement('div');
    title.className = 'subagent-name';
    title.textContent = item.name || 'Sub-agent';

    const badges = document.createElement('div');
    badges.className = 'subagent-badges';
    subagentBadges(item).forEach(badge => {
        badges.appendChild(createSubagentBadge(badge));
    });

    const meta = document.createElement('div');
    meta.className = 'subagent-meta';
    meta.textContent = subagentMetaText(item);

    const actions = document.createElement('div');
    actions.className = 'subagent-actions';
    appendSubagentActions(actions, item);

    body.appendChild(title);
    body.appendChild(badges);
    body.appendChild(meta);
    body.appendChild(actions);
    row.appendChild(dot);
    row.appendChild(body);
    subagentList.appendChild(row);
}

/**
 * Builds badge labels for one activity row.
 *
 * @param {object} item - Sub-agent activity record.
 * @returns {string[]} Badge labels.
 */
function subagentBadges(item) {
    return [
        item.source || 'source',
        item.model || '',
        item.taskCount ? String(item.taskCount) + ' tasks' : '',
        item.doneCount ? String(item.doneCount) + ' done' : '',
        item.blockedCount ? String(item.blockedCount) + ' blocked' : '',
        item.evidenceCount ? String(item.evidenceCount) + ' evidence' : '',
    ].filter(Boolean);
}

/**
 * Creates one badge element for a sub-agent row.
 *
 * @param {string} label - Badge text.
 * @returns {HTMLSpanElement} Badge element.
 */
function createSubagentBadge(label) {
    const badge = document.createElement('span');
    badge.className = 'subagent-badge';
    badge.textContent = label;
    return badge;
}

/**
 * Adds row actions for session-backed activity.
 *
 * @param {HTMLElement} actions - Action container.
 * @param {object} item - Activity row used for command payloads.
 * @returns {void}
 */
function appendSubagentActions(actions, item) {
    if (!item.sessionId) {
        return;
    }

    actions.appendChild(subagentActionButton(
        'Open',
        openSubagentSession.bind(null, item.sessionId),
    ));
    actions.appendChild(subagentActionButton(
        'Copy ID',
        copyMessageContent.bind(null, item.sessionId),
    ));
}

/**
 * Creates one compact row action button.
 *
 * @param {string} label - Button text.
 * @param {Function} onClick - Click handler.
 * @returns {HTMLButtonElement} Action button.
 */
function subagentActionButton(label, onClick) {
    const button = document.createElement('button');
    button.className = 'subagent-action';
    button.textContent = label;
    button.onclick = onClick;
    return button;
}

/**
 * Requests loading a sub-agent session transcript into the chat view.
 *
 * @param {string} sessionId - Session id to load.
 * @returns {void}
 */
function openSubagentSession(sessionId) {
    postTelemetry('openSubagentSession', { id: sessionId });
    vscode.postMessage({
        type: 'openSessionById',
        value: { id: sessionId },
    });
}

/**
 * Returns the CSS status class for one activity record.
 *
 * @param {object} item - Sub-agent activity record.
 * @returns {string} Status class appended to the row.
 */
function subagentStatusClass(item) {
    const status = String(item.status || 'pending').toLowerCase();
    return ['pending', 'running', 'completed', 'failed'].includes(status)
        ? status
        : 'pending';
}

/**
 * Formats the secondary text for one sub-agent row.
 *
 * @param {object} item - Sub-agent activity record.
 * @returns {string} Human-readable status and detail.
 */
function subagentMetaText(item) {
    const parts = [subagentStatusClass(item)];
    if (item.detail) {
        parts.push(item.detail);
    }
    if (item.sessionId) {
        parts.push('session ' + shortToolId(item.sessionId));
    }
    if (item.updatedAt) {
        parts.push('updated ' + formatSubagentTime(item.updatedAt));
    }
    return parts.join(' | ');
}

/**
 * Formats one sub-agent timestamp for compact display.
 *
 * @param {string} value - ISO or date-compatible timestamp.
 * @returns {string} Localized short time.
 */
function formatSubagentTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return 'unknown';
    }

    return date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
    });
}
