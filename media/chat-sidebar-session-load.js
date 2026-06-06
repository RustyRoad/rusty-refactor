/**
 * Replaces visible chat messages with a loaded session transcript.
 *
 * @param {string} sessionId - Session id loaded by the extension host.
 * @param {object[]} messages - Transcript messages to render.
 * @returns {void}
 */
function renderLoadedSession(sessionId, messages) {
    stopSpeech();
    dispatchChatState('clearMessages');
    chatContainer.innerHTML = '';
    const transcript = Array.isArray(messages) ? messages : [];
    transcript.forEach(message => {
        appendMessage(
            message.role,
            message.content || '',
            false,
            undefined,
            sessionId,
        );
    });
    renderEmptyLoadedSession(transcript);
}

/**
 * Shows an empty-state placeholder when a loaded session has no messages.
 *
 * @param {object[]} transcript - Visible messages loaded for the session.
 * @returns {void}
 */
function renderEmptyLoadedSession(transcript) {
    if (transcript.length !== 0) {
        return;
    }

    chatContainer.innerHTML = '<div class="empty-state"'
        + ' id="empty-state">Session has no visible messages.</div>';
}

/**
 * Renders a loaded Codetether session transcript in the current chat view.
 *
 * @param {object} message - Host message with session id and transcript.
 * @returns {void}
 */
function handleSessionLoadedMessage(message) {
    const sessionId = message.sessionId || '';
    renderLoadedSession(sessionId, message.messages || []);
    setBusy(false, 'Loaded session ' + shortToolId(sessionId));
}
