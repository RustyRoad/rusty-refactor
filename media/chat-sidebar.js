/**
 * Wires chat sidebar controls after domain scripts define handlers.
 *
 * Keeping this file as the composition root satisfies the line-budget guard
 * for oversized files while each behavior area lives in its own script.
 *
 * @returns {void}
 */
function bootChatSidebar() {
    initializeSpeechState();
    initializeVoiceInputState();
    byId('send-btn').onclick = sendMessage;
    interruptButton.onclick = interruptChat;
    byId('popout-chat-btn').onclick = openChatWindow;
    byId('new-chat-btn').onclick = startNewChat;
    voiceButton.onclick = toggleVoiceInput;
    byId('clear-btn').onclick = clearChat;
    byId('tui-btn').onclick = openTui;
    byId('refresh-btn').onclick = refreshModels;
    byId('refresh-sessions-btn').onclick = refreshSessions;
    activeSessionsTab.onclick = showActiveSessions;
    previousSessionsTab.onclick = showPreviousSessions;
    byId('refresh-subagents-btn').onclick = refreshSubagents;
    sessionIdOpenButton.onclick = openSessionByEnteredId;
    sessionIdInput.addEventListener('keydown', handleSessionIdKeydown);
    byId('save-model-btn').onclick = saveSelectedModel;
    byId('use-model-btn').onclick = useSelectedModel;
    modelInput.onchange = handleModelInputChange;
    modelInput.onfocus = refreshModelsForSelector;
    modelInput.onpointerdown = refreshModelsForSelector;
    modelSearchInput.oninput = handleModelSearchInput;
    customModelInput.oninput = handleCustomModelInput;
    modelThinkingInput.onchange = handleThinkingEffortChange;
    modelServiceTierInput.onchange = handleServiceTierChange;
    modeInput.onchange = handleModeChange;
    featureInput.onchange = handleFeatureChange;
    contextToggle.onchange = handleContextToggleChange;
    voiceInput.onchange = handleVoiceChange;
    voiceSourceInput.onchange = handleVoiceInputSourceChange;
    document.querySelectorAll('.suggestion').forEach(bindSuggestion);
    promptInput.addEventListener('input', handlePromptInput);
    promptInput.addEventListener('keydown', handlePromptKeydown);
    window.addEventListener('message', handleHostMessage);
    updateRunSettingSummary();
    resizePromptInput();
    logUiAction('webviewReady', 'posting-ready-event');
    vscode.postMessage({ type: 'webviewReady' });
    promptInput.focus();
}

bootChatSidebar();