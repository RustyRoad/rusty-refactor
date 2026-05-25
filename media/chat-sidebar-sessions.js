/**
 * Opens a transcript file by a session id pasted from the shell TUI.
 *
 * @returns {void}
 */
function openSessionByEnteredId() {
    const sessionId = sessionIdInput.value.trim();
    const session = findSessionById(sessionId);
    if (session) {
        openSession(session);
        return;
    }

    postTelemetry('openSessionById', { id: sessionId });
    vscode.postMessage({
        type: 'openSessionById',
        value: { id: sessionId },
    });
}

/**
 * Finds a known session by full id or visible prefix.
 *
 * @param {string} sessionId - Session id copied from the shell TUI.
 * @returns {object|undefined} Matching session summary, if one is loaded.
 */
function findSessionById(sessionId) {
    if (!sessionId) {
        return undefined;
    }
    return getChatState().sessions.find(session => {
        return session.id === sessionId || session.id.startsWith(sessionId);
    });
}

/**
 * Opens the entered session id when the user presses Enter.
 *
 * @param {KeyboardEvent} event - Key event from the session id input.
 * @returns {void}
 */
function handleSessionIdKeydown(event) {
    if (event.key !== 'Enter') {
        return;
    }
    event.preventDefault();
    openSessionByEnteredId();
}

/**
 * Formats a session update timestamp for display in the sessions list.
 *
 * @param {string|number|Date} value - Timestamp accepted by Date.
 * @returns {string} Localized timestamp, or a placeholder for missing values.
 */
function formatSessionTime(value) {
    if (!value) {
        return 'unknown time';
    }
    return new Date(value).toLocaleString();
}

/**
 * Opens a transcript file when the user clicks a session item.
 *
 * @param {object} session - Session metadata from the extension host.
 * @returns {void}
 */
function openSession(session) {
    postTelemetry('openSession', { id: session.id });
    vscode.postMessage({
        type: 'openSession',
        value: { id: session.id, path: session.path },
    });
}

/**
 * Appends one session button to the sessions list.
 *
 * @param {object} session - Session metadata from the extension host.
 * @returns {void}
 */
function appendSessionItem(session) {
    const button = document.createElement('button');
    button.className = 'session-item';
    button.title = session.path || '';
    button.textContent = session.preview || session.id;
    const id = document.createElement('code');
    id.className = 'session-id';
    id.textContent = session.id;
    const meta = document.createElement('span');
    meta.className = 'session-meta';
    meta.textContent = String(session.turnCount || 0)
        + ' turns · ' + formatSessionTime(session.updatedAt);
    button.appendChild(id);
    button.appendChild(meta);
    button.onclick = openSession.bind(null, session);
    sessionsList.appendChild(button);
}

/**
 * Renders available Codetether transcript sessions.
 *
 * @param {object[]} sessions - Session metadata from the extension host.
 * @returns {void}
 */
function renderSessions(sessions) {
    const state = dispatchChatState('sessionsListed', { sessions });
    const items = state.sessions;
    sessionsList.innerHTML = '';
    if (items.length === 0) {
        const empty = document.createElement('span');
        empty.className = 'subtitle';
        empty.textContent = 'No Codetether sessions found.';
        sessionsList.appendChild(empty);
        return;
    }
    items.forEach(appendSessionItem);
}
