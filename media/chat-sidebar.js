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
    voiceButton.onclick = toggleVoiceInput;
    byId('clear-btn').onclick = clearChat;
    byId('tui-btn').onclick = openTui;
    byId('refresh-btn').onclick = refreshModels;
    byId('refresh-sessions-btn').onclick = refreshSessions;
    sessionIdOpenButton.onclick = openSessionByEnteredId;
    sessionIdInput.addEventListener('keydown', handleSessionIdKeydown);
    byId('save-model-btn').onclick = saveSelectedModel;
    byId('use-model-btn').onclick = useSelectedModel;
    modelInput.onchange = handleModelInputChange;
    customModelInput.oninput = handleCustomModelInput;
    modeInput.onchange = handleModeChange;
    featureInput.onchange = handleFeatureChange;
    contextToggle.onchange = handleContextToggleChange;
    voiceInput.onchange = handleVoiceChange;
    voiceSourceInput.onchange = handleVoiceInputSourceChange;
    document.querySelectorAll('.suggestion').forEach(bindSuggestion);
    promptInput.addEventListener('input', handlePromptInput);
    promptInput.addEventListener('keydown', handlePromptKeydown);
    window.addEventListener('message', handleHostMessage);
    resizePromptInput();
    logUiAction('webviewReady', 'posting-ready-event');
    vscode.postMessage({ type: 'webviewReady' });
    promptInput.focus();
}

bootChatSidebar();
