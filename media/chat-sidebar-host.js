/**
 * Handles a host-authored chat message for the thread that owns it.
 *
 * @param {object} message - Host message containing chat content.
 * @returns {void}
 */
function handleReceiveMessage(message) {
    const record = appendMessage(
        message.role,
        message.content,
        message.error,
        message.toolEvents,
        message.sessionId,
        message.modelId,
        message.threadId,
    );
    if (message.autoSpeak && !record.error) {
        queueVoiceInputAfterSpeech(record.id);
        startSpeech(record);
    }
}

/**
 * Upserts one live assistant response without creating duplicate bubbles.
 *
 * @param {object} message - Host snapshot with a stable response id.
 * @returns {void}
 */
function handleChatProgressMessage(message) {
    upsertStreamingMessage({
        id: message.id,
        threadId: message.threadId,
        content: message.content,
        thinking: message.thinking,
        phase: message.phase,
        modelId: message.modelId,
        toolEvents: message.toolEvents,
        sessionId: message.sessionId,
        streaming: message.streaming,
        error: message.error,
        autoSpeak: message.autoSpeak,
    });
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
 * Resets one thread transcript after the host clears current chat state.
 *
 * @param {object} message - Host message naming the cleared thread.
 * @returns {void}
 */
function handleThreadClearedMessage(message) {
    stopSpeech();
    const state = dispatchChatState('clearThreadMessages', {
        threadId: message.threadId || '',
    });
    if (message.threadId === state.activeThreadId) {
        renderActiveThreadTranscript('Chat cleared.');
        setBusy(false, 'Ready');
    }
}

/**
 * Updates model controls from a host model list response.
 *
 * @param {object} message - Host message with model option data.
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
 * Applies validated provider-runtime options received from the host.
 *
 * @param {object} message - Host message with persisted model options.
 * @returns {void}
 */
function handleModelOptionsChangedMessage(message) {
    populateModelRuntimeOptions(message.options || {});
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
 * Updates live chat rows and the selected transcript from the host index.
 *
 * @param {object} message - Host message with live thread summaries.
 * @returns {void}
 */
function handleChatThreadsChangedMessage(message) {
    renderChatThreads(
        message.threads || [],
        message.activeThreadId || '',
    );
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
        case 'chatProgress':
            handleChatProgressMessage(message);
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
        case 'speechAudio':
            handleSpeechAudioMessage(message);
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
        case 'threadCleared':
            handleThreadClearedMessage(message);
            break;
        case 'modelsListed':
            handleModelsListedMessage(message);
            break;
        case 'modelOptionsChanged':
            handleModelOptionsChangedMessage(message);
            break;
        case 'sessionsListed':
            handleSessionsListedMessage(message);
            break;
        case 'chatThreadsChanged':
            handleChatThreadsChangedMessage(message);
            break;
        case 'sessionLoaded':
            handleSessionLoadedMessage(message);
            break;
        case 'subagentsChanged':
            handleSubagentsChangedMessage(message);
            break;
    }
}
