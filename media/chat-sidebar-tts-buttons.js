/**
 * Creates a read-aloud button for an assistant message.
 *
 * @param {object} record - Message record stored in chat state.
 * @returns {HTMLButtonElement} Button wired to host speech playback.
 */
function createSpeechButton(record) {
    const button = document.createElement('button');
    button.className = 'read-btn';
    button.textContent = 'Read';
    button.title = 'Read this response aloud';
    button.dataset.messageId = record.id;
    button.onclick = toggleSpeech.bind(null, record);
    updateSpeechButton(button, false);
    return button;
}

/**
 * Updates every read-aloud button from the current speech state.
 *
 * @returns {void}
 */
function updateSpeechButtons() {
    document.querySelectorAll('.read-btn').forEach(updateSpeechButtonState);
}

/**
 * Updates one read-aloud button from the current speech state.
 *
 * @param {Element} item - Button element to update.
 * @returns {void}
 */
function updateSpeechButtonState(item) {
    const button = /** @type {HTMLButtonElement} */ (item);
    const state = getChatState();
    const speaking = isSpeakingMessage(button.dataset.messageId || '');
    button.disabled = !state.speechSupported;
    updateSpeechButton(button, speaking);
}

/**
 * Updates a read-aloud button for the current playback state.
 *
 * @param {HTMLButtonElement} button - Button to update.
 * @param {boolean} speaking - Whether the button is currently speaking.
 * @returns {void}
 */
function updateSpeechButton(button, speaking) {
    button.textContent = speaking ? 'Stop' : 'Read';
    button.classList.toggle('speaking', speaking);
    button.title = speaking
        ? 'Stop reading this response'
        : 'Read this response aloud';
}

/**
 * Finds the read button associated with a message id.
 *
 * @param {string} messageId - Message id to find.
 * @returns {HTMLButtonElement|null} Matching button or null.
 */
function speechButtonForMessage(messageId) {
    return document.querySelector(
        '.read-btn[data-message-id="' + String(messageId) + '"]',
    );
}
