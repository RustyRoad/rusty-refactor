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
 * Formats a session update timestamp for compact sidebar display.
 *
 * @param {string|number|Date} value - Timestamp accepted by Date.
 * @returns {string} Local date and time, or a missing-date placeholder.
 */
function formatSessionDate(value) {
    if (!value) {
        return 'unknown date';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return 'unknown date';
    }

    return date.toLocaleString([], {
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        month: 'short',
        year: 'numeric',
    });
}

/**
 * Requests a blank chat thread without interrupting background sessions.
 *
 * @returns {void}
 */
function startNewChat() {
    logUiAction('newChat', 'button=new-chat-btn');
    postTelemetry('newChat', { source: 'toolbar' });
    vscode.postMessage({ type: 'newChat' });
}

/**
 * Selects one live thread and requests its host-owned side effects.
 *
 * @param {object} thread - Live thread summary selected by the user.
 * @returns {void}
 */
function selectChatThread(thread) {
    dispatchChatState('setActiveThread', { threadId: thread.id });
    renderActiveThreadTranscript('Start a new conversation.');
    renderChatThreadList(getChatState());
    setBusy(Boolean(thread.busy), thread.statusText || 'Ready');
    postTelemetry('selectChatThread', { threadId: thread.id });
    vscode.postMessage({
        type: 'selectChatThread',
        value: { threadId: thread.id },
    });
}

/**
 * Changes the session browser between live and persisted chats.
 *
 * @param {string} sessionView - Active or previous browser view.
 * @returns {void}
 */
function setSessionView(sessionView) {
    const state = dispatchChatState('setSessionView', { sessionView });
    renderSessionView(state);
}

/**
 * Selects the live chat browser tab.
 *
 * @returns {void}
 */
function showActiveSessions() {
    setSessionView('active');
}

/**
 * Selects the persisted chat browser tab.
 *
 * @returns {void}
 */
function showPreviousSessions() {
    setSessionView('previous');
}

/**
 * Applies tab selection and panel visibility from TetherScript state.
 *
 * @param {object} state - Current chat state snapshot.
 * @returns {void}
 */
function renderSessionView(state) {
    const previous = chatStateApi.sessionView(state) === 'previous';
    activeSessionsTab.classList.toggle('active', !previous);
    previousSessionsTab.classList.toggle('active', previous);
    activeSessionsTab.setAttribute('aria-selected', String(!previous));
    previousSessionsTab.setAttribute('aria-selected', String(previous));
    activeSessionsView.hidden = previous;
    previousSessionsView.hidden = !previous;
}

/**
 * Renders host-owned live chat threads and the selected transcript.
 *
 * @param {object[]} threads - Live chat summaries from the host.
 * @param {string} activeThreadId - Selected live chat identifier.
 * @returns {void}
 */
function renderChatThreads(threads, activeThreadId) {
    const previousActiveId = getChatState().activeThreadId;
    const state = dispatchChatState('chatThreadsListed', {
        threads,
        activeThreadId,
    });
    renderChatThreadList(state);
    renderSessionCounts(state);
    renderSessionView(state);
    const active = chatStateApi.activeThread(state);
    if (active && previousActiveId !== state.activeThreadId) {
        renderActiveThreadTranscript('Start a new conversation.');
    }
    if (active) {
        setBusy(Boolean(active.busy), active.statusText || 'Ready');
    }
}

/**
 * Rebuilds the live thread list from the current state snapshot.
 *
 * @param {object} state - Current chat state snapshot.
 * @returns {void}
 */
function renderChatThreadList(state) {
    const threads = chatStateApi.chatThreads(state);
    activeSessionsList.innerHTML = '';
    if (threads.length === 0) {
        const empty = document.createElement('span');
        empty.className = 'subtitle';
        empty.textContent = 'No active chats.';
        activeSessionsList.appendChild(empty);
        return;
    }

    threads.forEach(thread => {
        activeSessionsList.appendChild(
            createChatThreadItem(thread, state.activeThreadId),
        );
    });
}

/**
 * Creates one selectable row for a live or background chat thread.
 *
 * @param {object} thread - Live chat summary from the host.
 * @param {string} activeThreadId - Selected thread identifier.
 * @returns {HTMLButtonElement} Detached live chat row.
 */
function createChatThreadItem(thread, activeThreadId) {
    const button = document.createElement('button');
    const selected = thread.id === activeThreadId;
    button.className = 'session-item chat-thread-item'
        + (selected ? ' selected' : '')
        + (thread.busy ? ' running' : '');
    button.setAttribute('aria-pressed', String(selected));
    button.onclick = selectChatThread.bind(null, thread);

    const heading = document.createElement('span');
    heading.className = 'chat-thread-heading';
    const dot = document.createElement('span');
    dot.className = 'chat-thread-dot';
    const title = document.createElement('span');
    title.className = 'session-title';
    title.textContent = thread.title || 'New chat';
    heading.appendChild(dot);
    heading.appendChild(title);

    const meta = document.createElement('span');
    meta.className = 'session-meta';
    meta.textContent = thread.busy
        ? thread.statusText || 'Working...'
        : 'Ready - ' + formatSessionDate(thread.updatedAt);
    button.appendChild(heading);
    button.appendChild(meta);
    return button;
}

/**
 * Updates live, previous, and combined session counts.
 *
 * @param {object} state - Current chat state snapshot.
 * @returns {void}
 */
function renderSessionCounts(state) {
    const activeCount = chatStateApi.chatThreads(state).length;
    const previousCount = state.sessions.length;
    activeSessionsCount.textContent = String(activeCount);
    previousSessionsCount.textContent = String(previousCount);
    sessionsCaption.textContent = String(activeCount) + ' active - '
        + String(previousCount) + ' previous';
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
 * Appends one compact session button to the sessions list.
 *
 * @param {object} session - Session metadata from the extension host.
 * @returns {void}
 */
function appendSessionItem(session) {
    const button = document.createElement('button');
    button.className = 'session-item';
    button.title = [
        session.path || '',
        'Double-click or right-click to open in a new window.',
    ].filter(Boolean).join('\n');

    const title = document.createElement('span');
    title.className = 'session-title';
    title.textContent = session.preview || session.id;

    const id = document.createElement('code');
    id.className = 'session-id';
    id.textContent = session.id;

    const meta = document.createElement('span');
    meta.className = 'session-meta';
    const identity = [session.agent, session.model]
        .filter(Boolean)
        .join(' - ');
    meta.textContent = String(session.turnCount || 0)
        + ' turns - ' + formatSessionDate(session.updatedAt)
        + (identity ? ' - ' + identity : '');

    button.appendChild(title);
    button.appendChild(id);
    button.appendChild(meta);
    bindSessionWindowActions(button, session);
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
    renderSessionCounts(state);
    if (items.length === 0) {
        const empty = document.createElement('span');
        empty.className = 'subtitle';
        empty.textContent = 'No Codetether sessions found.';
        sessionsList.appendChild(empty);
        return;
    }
    items.forEach(appendSessionItem);
}