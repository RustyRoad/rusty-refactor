/**
 * Handles an assistant or host-authored chat message from the extension host.
 *
 * User messages are ignored because they are optimistically rendered by the
 * webview before the request is sent.
 *
 * @param {object} message - Host message containing chat content.
 * @returns {void}
 */
function handleReceiveMessage(message) {
    if (message.role !== 'user') {
        const record = appendMessage(
            message.role,
            message.content,
            message.error,
            message.toolEvents,
            message.sessionId,
        );
        if (message.autoSpeak && !record.error) {
            queueVoiceInputAfterSpeech(record.id);
            startSpeech(record);
        }
    }
}

/**
 * Handles host status updates for busy state and status text.
 *
 * @param {object} message - Host status message.
 * @returns {void}
 */
function handleStatusMessage(message) {
    setBusy(Boolean(message.busy), message.message);
}

/**
 * Shows a short host-provided toast message in the status area.
 *
 * @param {object} message - Host toast message.
 * @returns {void}
 */
function handleToastMessage(message) {
    statusText.textContent = message.message;
}

/**
 * Updates the model loading status caption from the host.
 *
 * @param {object} message - Host model status message.
 * @returns {void}
 */
function handleModelStatusMessage(message) {
    dispatchChatState('setModelStatus', {
        status: message.status || 'Loading models...',
    });
    modelCaption.textContent = chatStateApi.modelCaptionText(getChatState());
}

/**
 * Resets the chat container after the host clears transcript state.
 *
 * @returns {void}
 */
function handleClearedMessage() {
    stopSpeech();
    dispatchChatState('clearChat');
    chatContainer.innerHTML = '<div class="empty-state"'
        + ' id="empty-state">Chat cleared.</div>';
    setBusy(false, 'Ready');
}

/**
 * Updates model controls from a host model list response.
 *
 * @param {object} message - Host message with model list data.
 * @returns {void}
 */
function handleModelsListedMessage(message) {
    populateModels(
        message.models,
        message.configuredModel,
        message.status,
        message.discoveryTelemetry || {},
    );
}

/**
 * Updates the sessions panel from a host session list response.
 *
 * @param {object} message - Host message with session metadata.
 * @returns {void}
 */
function handleSessionsListedMessage(message) {
    renderSessions(message.sessions);
}

/**
 * Updates the sub-agent activity panel from the extension host.
 *
 * @param {object} message - Host message with sub-agent activity rows.
 * @returns {void}
 */
function handleSubagentsChangedMessage(message) {
    renderSubagentActivity(
        message.subagents || [],
        message.summary || '',
    );
}

/**
 * Dispatches one extension host message to the matching UI handler.
 *
 * Unknown message types are ignored because older hosts or experimental
 * features may send events this sidebar does not need.
 *
 * @param {MessageEvent} event - Browser message event from the VS Code host.
 * @returns {void}
 */
function handleHostMessage(event) {
    const message = event.data;
    dispatchChatState('hostMessageReceived', {
        type: String(message?.type || ''),
    });
    logUiAction('hostMessageReceived', 'type=' + String(message?.type || ''));
    switch (message?.type) {
        case 'receiveMessage':
            handleReceiveMessage(message);
            break;
        case 'status':
            handleStatusMessage(message);
            break;
        case 'toast':
            handleToastMessage(message);
            break;
        case 'modelStatus':
            handleModelStatusMessage(message);
            break;
        case 'speechState':
            handleSpeechStateMessage(message);
            break;
        case 'speechVoicesListed':
            handleSpeechVoicesListedMessage(message);
            break;
        case 'voiceInputState':
            handleVoiceInputStateMessage(message);
            break;
        case 'voiceInputResult':
            handleVoiceInputResultMessage(message);
            break;
        case 'cleared':
            handleClearedMessage();
            break;
        case 'modelsListed':
            handleModelsListedMessage(message);
            break;
        case 'sessionsListed':
            handleSessionsListedMessage(message);
            break;
        case 'sessionLoaded':
            handleSessionLoadedMessage(message);
            break;
        case 'subagentsChanged':
            handleSubagentsChangedMessage(message);
            break;
    }
}
