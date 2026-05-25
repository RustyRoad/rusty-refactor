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
    subagentPanel.classList.toggle('visible', items.length > 0);

    items.forEach(appendSubagentItem);
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

    const meta = document.createElement('div');
    meta.className = 'subagent-meta';
    meta.textContent = subagentMetaText(item);

    body.appendChild(title);
    body.appendChild(meta);
    row.appendChild(dot);
    row.appendChild(body);
    subagentList.appendChild(row);
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
    if (item.model) {
        parts.push(item.model);
    }
    return parts.join(' | ');
}
