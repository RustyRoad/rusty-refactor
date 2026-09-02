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
 * @param {string} [modelId] - Exact model used for an assistant response.
 * @param {string} [threadId] - Live chat thread owning the message.
 * @returns {object} Message record stored by the state reducer.
 */
function appendMessage(
    role,
    content,
    isError,
    toolEvents,
    sessionId,
    modelId,
    threadId,
) {
    const record = appendMessageState(
        role,
        content,
        isError,
        toolEvents,
        sessionId,
        modelId,
        threadId,
    );
    if (record.threadId !== getChatState().activeThreadId) {
        return record;
    }

    removeChatEmptyState();
    appendRenderedMessage(record);
    return record;
}

/**
 * Inserts or updates one assistant message from a host stream snapshot.
 *
 * @param {object} snapshot - Complete progress state for one response id.
 * @returns {object} Latest message record stored by the state reducer.
 */
function upsertStreamingMessage(snapshot) {
    const state = dispatchChatState('upsertStreamingMessage', snapshot);
    const threadId = snapshot.threadId || state.activeThreadId;
    const record = state.messages.find(message => {
        return message.id === snapshot.id
            && message.threadId === threadId;
    });
    if (!record) {
        return {};
    }

    if (record.threadId !== state.activeThreadId) {
        return record;
    }

    removeChatEmptyState();
    const existing = chatContainer.querySelector(
        '[data-message-id="' + cssEscape(record.id) + '"]',
    );
    const rendered = createMessageElement(record);
    if (existing) {
        updateRenderedMessage(existing, rendered);
    } else {
        chatContainer.appendChild(rendered);
    }

    syncStreamingSpeech(record);
    return record;
}

/**
 * Rebuilds the visible transcript for the selected live chat thread.
 *
 * @param {string} emptyText - Placeholder shown for an empty transcript.
 * @returns {void}
 */
function renderActiveThreadTranscript(emptyText) {
    stopSpeech();
    chatContainer.innerHTML = '';
    const records = chatStateApi.activeThreadMessages(getChatState());
    records.forEach(appendRenderedMessage);
    if (records.length > 0) {
        return;
    }

    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.id = 'empty-state';
    empty.textContent = emptyText || 'Start a new conversation.';
    chatContainer.appendChild(empty);
}

/**
 * Removes the welcome placeholder before the first transcript message.
 *
 * @returns {void}
 */
function removeChatEmptyState() {
    const emptyState = byId('empty-state');
    if (emptyState) {
        emptyState.remove();
    }
}

/**
 * Escapes a state-owned id for use inside an attribute selector.
 *
 * @param {string} value - Message id originating in extension state.
 * @returns {string} Selector-safe id.
 */
function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
        return window.CSS.escape(value);
    }
    return String(value).replace(/["\\]/g, '\\$&');
}

/**
 * Appends one already-stored message record to the transcript.
 *
 * @param {object} record - Message record from chat state.
 * @returns {void}
 */
function appendRenderedMessage(record) {
    chatContainer.appendChild(createMessageElement(record));
}

/**
 * Builds the complete DOM element for one message state record.
 *
 * @param {object} record - Message record from chat state.
 * @returns {HTMLElement} Detached message wrapper.
 */
function createMessageElement(record) {
    const wrap = document.createElement('div');
    wrap.className = 'message-wrap ' + record.role;
    wrap.dataset.messageId = record.id;

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = messageMetaText(record);

    const message = document.createElement('div');
    message.className = 'message ' + record.role
        + (record.error ? ' error' : '');
    const content = record.content || (record.streaming
        ? '*(Thinking...)*'
        : '');
    message.innerHTML = record.role === 'assistant'
        ? window.CodetetherMarkdown.render(content)
        : '<p>' + escapeHtml(content).replace(/\n/g, '<br>') + '</p>';
    if (record.role === 'assistant') {
        appendWorkspaceFileIndicators(message, content);
    }

    const actions = document.createElement('div');
    actions.className = 'message-actions';
    const copy = document.createElement('button');
    copy.className = 'copy-btn';
    copy.textContent = 'Copy';
    copy.onclick = copyMessageContent.bind(null, content);
    actions.appendChild(copy);
    appendSpeechAction(actions, record);

    wrap.appendChild(meta);
    wrap.appendChild(message);
    renderThinking(wrap, record);
    renderToolEvents(wrap, record.toolEvents);
    renderModelSignature(wrap, record);
    wrap.appendChild(actions);
    return wrap;
}

/**
 * Adds model reasoning when the selected provider exposes it explicitly.
 *
 * @param {HTMLElement} wrap - Message wrapper receiving reasoning details.
 * @param {object} record - Message record containing streamed reasoning.
 * @returns {void}
 */
function renderThinking(wrap, record) {
    if (!record.thinking) {
        return;
    }

    const details = document.createElement('details');
    details.className = 'thinking-event';
    details.dataset.disclosure = 'thinking';
    const summary = document.createElement('summary');
    summary.textContent = record.streaming
        ? 'Thinking (live)'
        : 'Thinking';
    const body = document.createElement('pre');
    body.textContent = record.thinking;
    details.appendChild(summary);
    details.appendChild(body);
    wrap.appendChild(details);
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
 * Adds the model name and provider/ID provenance below an assistant response.
 *
 * @param {HTMLElement} wrap - Message wrapper receiving the signature.
 * @param {object} record - Message record containing the exact model ID.
 * @returns {void}
 */
function renderModelSignature(wrap, record) {
    if (record.role !== 'assistant' || !record.modelId) {
        return;
    }

    const identity = chatStateApi.modelIdentityForId(
        getChatState(),
        record.modelId,
    );
    if (!identity) {
        return;
    }

    const signature = document.createElement('div');
    signature.className = 'model-signature';
    signature.setAttribute(
        'aria-label',
        'Model provenance: ' + identity.provider + ', ' + identity.id,
    );
    signature.title = 'Model provenance: ' + identity.provider
        + ' · ' + identity.id;

    const name = document.createElement('span');
    name.className = 'model-signature-name';
    name.textContent = identity.name;
    const provenance = document.createElement('span');
    provenance.className = 'model-signature-provenance';
    provenance.textContent = identity.provider + ' · ' + identity.id;
    signature.appendChild(name);
    signature.appendChild(provenance);
    wrap.appendChild(signature);
}

/**
 * Stores a message in chat state and returns the appended record.
 *
 * @param {string} role - Message author role.
 * @param {string} content - Raw message text.
 * @param {boolean} isError - Whether the message is an error.
 * @param {object[]} [toolEvents] - Tool events attached to the message.
 * @param {string} [sessionId] - Optional Codetether session id.
 * @param {string} [modelId] - Exact model used for an assistant response.
 * @param {string} [threadId] - Live chat thread owning the message.
 * @returns {object} Message record stored by the state reducer.
 */
function appendMessageState(
    role,
    content,
    isError,
    toolEvents,
    sessionId,
    modelId,
    threadId,
) {
    const state = dispatchChatState('appendMessage', {
        role,
        content,
        error: isError,
        toolEvents,
        sessionId,
        modelId,
        threadId,
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
    const phase = record.streaming && record.phase
        ? ' | ' + record.phase
        : '';
    return label + ' | now' + session + phase;
}

/**
 * Adds one tool event row to a rendered event list.
 *
 * @param {HTMLElement} list - Tool event list receiving the row.
 * @param {object} event - Tool event data from the extension host.
 * @param {number} index - Position of the event within the timeline.
 * @returns {void}
 */
function appendToolEventRow(list, event, index) {
    list.appendChild(renderToolEvent(event, index));
}

/**
 * Adds a collapsed tool timeline under an assistant message.
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

    const details = document.createElement('details');
    details.className = 'tool-events';
    details.dataset.disclosure = 'tool-events';
    const summary = document.createElement('summary');
    summary.textContent = 'Tool activity (' + events.length + ')';
    const list = document.createElement('div');
    list.className = 'tool-events-list';
    events.forEach(appendToolEventRow.bind(null, list));
    details.appendChild(summary);
    details.appendChild(list);
    wrap.appendChild(details);
}

/**
 * Builds a collapsible row for one tool call or result.
 *
 * @param {object} event - Tool event data from the extension host.
 * @param {number} index - Position of the event within the timeline.
 * @returns {HTMLDetailsElement} Collapsible DOM node for the event.
 */
function renderToolEvent(event, index) {
    const details = document.createElement('details');
    details.className = 'tool-event ' + String(event.kind || 'call');
    details.dataset.disclosure = toolEventDisclosureKey(event, index);
    const summary = document.createElement('summary');
    summary.textContent = toolEventTitle(event);
    const body = document.createElement('pre');
    body.textContent = toolEventBody(event);
    details.appendChild(summary);
    details.appendChild(body);
    return details;
}

/**
 * Derives a stable key identifying one tool event row across re-renders.
 *
 * Events with ids stay stable even when earlier events are inserted;
 * id-less events fall back to their timeline position.
 *
 * @param {object} event - Tool event with kind and optional id.
 * @param {number} index - Position of the event within the timeline.
 * @returns {string} Disclosure key unique within one message.
 */
function toolEventDisclosureKey(event, index) {
    const kind = String(event.kind || 'call');
    const identity = event.id ? String(event.id) : 'index-' + index;
    return 'tool-event:' + kind + ':' + identity;
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