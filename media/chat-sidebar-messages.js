/**
 * Copies message text to the system clipboard.
 *
 * @param {string} content - Message content to copy.
 * @returns {Promise<void>} Clipboard write completion promise.
 */
function copyMessageContent(content) {
    return navigator.clipboard.writeText(content || '');
}

/**
 * Appends one chat bubble and any completed tool activity.
 *
 * @param {string} role - Message author role used for styling and labeling.
 * @param {string} content - Raw message text to display in the bubble.
 * @param {boolean} isError - Whether the message should use error styling.
 * @param {object[]} [toolEvents] - Tool events to render below the bubble.
 * @param {string} [sessionId] - Optional Codetether session id.
 * @returns {object} Message record stored by the state reducer.
 */
function appendMessage(role, content, isError, toolEvents, sessionId) {
    const emptyState = byId('empty-state');
    if (emptyState) {
        emptyState.remove();
    }

    const record = appendMessageState(
        role,
        content,
        isError,
        toolEvents,
        sessionId,
    );
    const wrap = document.createElement('div');
    wrap.className = 'message-wrap ' + record.role;
    wrap.dataset.messageId = record.id;

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = messageMetaText(record);

    const message = document.createElement('div');
    message.className = 'message ' + record.role
        + (record.error ? ' error' : '');
    message.innerHTML = record.role === 'assistant'
        ? renderMarkdown(record.content)
        : '<p>' + escapeHtml(record.content).replace(/\n/g, '<br>') + '</p>';

    const actions = document.createElement('div');
    actions.className = 'message-actions';
    const copy = document.createElement('button');
    copy.className = 'copy-btn';
    copy.textContent = 'Copy';
    copy.onclick = copyMessageContent.bind(null, record.content);
    actions.appendChild(copy);
    appendSpeechAction(actions, record);

    wrap.appendChild(meta);
    wrap.appendChild(message);
    renderToolEvents(wrap, record.toolEvents);
    wrap.appendChild(actions);
    chatContainer.appendChild(wrap);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    return record;
}

/**
 * Adds a read-aloud action for assistant messages.
 *
 * @param {HTMLElement} actions - Action row receiving the button.
 * @param {object} record - Message record used for button behavior.
 * @returns {void}
 */
function appendSpeechAction(actions, record) {
    if (record.role !== 'assistant') {
        return;
    }
    actions.appendChild(createSpeechButton(record));
}

/**
 * Stores a message in chat state and returns the appended record.
 *
 * @param {string} role - Message author role.
 * @param {string} content - Raw message text.
 * @param {boolean} isError - Whether the message is an error.
 * @param {object[]} [toolEvents] - Tool events attached to the message.
 * @param {string} [sessionId] - Optional Codetether session id.
 * @returns {object} Message record stored by the state reducer.
 */
function appendMessageState(role, content, isError, toolEvents, sessionId) {
    const state = dispatchChatState('appendMessage', {
        role,
        content,
        error: isError,
        toolEvents,
        sessionId,
    });
    return state.messages[state.messages.length - 1];
}

/**
 * Formats a compact metadata label for a rendered message.
 *
 * @param {object} record - Message record from chat state.
 * @returns {string} Human-readable metadata label.
 */
function messageMetaText(record) {
    const label = record.role === 'user' ? 'You' : 'Codetether';
    const session = record.sessionId
        ? ' | session ' + shortToolId(record.sessionId)
        : '';
    return label + ' | now' + session;
}

/**
 * Adds one tool event row to a rendered event list.
 *
 * @param {HTMLElement} list - Tool event list receiving the row.
 * @param {object} event - Tool event data from the extension host.
 * @returns {void}
 */
function appendToolEventRow(list, event) {
    list.appendChild(renderToolEvent(event));
}

/**
 * Adds a compact tool timeline under an assistant message.
 *
 * @param {HTMLElement} wrap - Message wrapper receiving the timeline.
 * @param {object[]} [toolEvents] - Tool calls and results to display.
 * @returns {void}
 */
function renderToolEvents(wrap, toolEvents) {
    const events = Array.isArray(toolEvents) ? toolEvents : [];
    if (events.length === 0) {
        return;
    }

    const list = document.createElement('div');
    list.className = 'tool-events';
    events.forEach(appendToolEventRow.bind(null, list));
    wrap.appendChild(list);
}

/**
 * Builds a collapsible row for one tool call or result.
 *
 * @param {object} event - Tool event data from the extension host.
 * @returns {HTMLDetailsElement} Collapsible DOM node for the event.
 */
function renderToolEvent(event) {
    const details = document.createElement('details');
    details.className = 'tool-event ' + String(event.kind || 'call');
    const summary = document.createElement('summary');
    summary.textContent = toolEventTitle(event);
    const body = document.createElement('pre');
    body.textContent = toolEventBody(event);
    details.appendChild(summary);
    details.appendChild(body);
    return details;
}

/**
 * Formats the visible title for one tool event.
 *
 * @param {object} event - Tool event with kind, name, and optional id.
 * @returns {string} Human-readable summary shown in the details row.
 */
function toolEventTitle(event) {
    const name = event.name || 'tool';
    const id = event.id ? ' #' + shortToolId(event.id) : '';
    return (event.kind === 'result' ? 'Result' : 'Call') + ': ' + name + id;
}

/**
 * Formats the expandable details for one tool event.
 *
 * @param {object} event - Tool event with result content or call arguments.
 * @returns {string} Text shown inside the expanded details body.
 */
function toolEventBody(event) {
    const text = event.kind === 'result'
        ? event.content || ''
        : event.arguments || '';
    const suffix = event.truncated
        ? '\n\n[Tool output truncated for display.]'
        : '';
    return text + suffix;
}

/**
 * Shortens long tool call ids while keeping them recognizable.
 *
 * @param {*} id - Tool call id to display.
 * @returns {string} Id truncated to the compact display length.
 */
function shortToolId(id) {
    const value = String(id);
    return value.length > 12 ? value.slice(0, 12) : value;
}
