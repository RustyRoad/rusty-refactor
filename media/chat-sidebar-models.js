/**
 * Updates the busy state of controls and the visible status text.
 *
 * @param {boolean} nextBusy - Whether the webview should block input.
 * @param {string} [message] - Optional status message to show.
 * @returns {void}
 */
function setBusy(nextBusy, message) {
    const state = dispatchChatState('setBusy', {
        busy: nextBusy,
        message,
    });
    byId('send-btn').disabled = state.busy;
    promptInput.disabled = state.busy;
    statusBar.classList.toggle('busy', state.busy);
    statusText.textContent = state.statusText;
    updateVoiceInputButtonIfReady();
}

/**
 * Refreshes the microphone button when voice scripts are loaded.
 *
 * Busy state changes can happen after assistant speech starts. The microphone
 * button also depends on busy state, so it must be refreshed here to avoid a
 * stale disabled button after read-aloud playback.
 *
 * @returns {void}
 */
function updateVoiceInputButtonIfReady() {
    if (typeof updateVoiceInputButton === 'function') {
        updateVoiceInputButton();
    }
}

/**
 * Counts how many models are available for each provider.
 *
 * @param {string[]} models - Model ids to group by provider prefix.
 * @returns {Object.<string, number>} Provider names mapped to model counts.
 */
function providerCounts(models) {
    return chatStateApi.providerCounts({ models });
}

/**
 * Toggles the active provider filter and refreshes model options.
 *
 * @param {string} provider - Provider represented by the clicked chip.
 * @param {Object.<string, number>} counts - Current provider count map.
 * @returns {void}
 */
function toggleProviderFilter(provider, counts) {
    const state = dispatchChatState('toggleProvider', { provider });
    postTelemetry('providerFilterToggled', {
        provider,
        activeProvider: state.activeProvider || 'all',
        modelsForProvider: counts[provider] || 0,
    });
    renderModelOptions();
}

/**
 * Appends one provider filter chip to the provider strip.
 *
 * @param {Object.<string, number>} counts - Current provider count map.
 * @param {string} provider - Provider name for the chip.
 * @returns {void}
 */
function appendProviderChip(counts, provider) {
    const chip = document.createElement('button');
    const activeProvider = getChatState().activeProvider;
    chip.className = 'provider-chip'
        + (activeProvider === provider ? ' active' : '');
    chip.textContent = provider + ' ' + counts[provider];
    chip.onclick = toggleProviderFilter.bind(null, provider, counts);
    providerStrip.appendChild(chip);
}

/**
 * Renders provider filter chips for the supplied model list.
 *
 * @param {string[]} models - Model ids to summarize by provider.
 * @returns {void}
 */
function renderProviderStrip(models) {
    providerStrip.innerHTML = '';
    const counts = providerCounts(models);
    Object.keys(counts).sort().forEach(appendProviderChip.bind(null, counts));
}

/**
 * Returns whether a model should be visible under the active provider filter.
 *
 * @param {string} model - Model id to test.
 * @returns {boolean} True when the model passes the current provider filter.
 */
function isModelVisible(model) {
    const state = getChatState();
    return !state.activeProvider || getProvider(model) === state.activeProvider;
}

/**
 * Appends one selectable model option to the model dropdown.
 *
 * @param {string} model - Model id to add as an option.
 * @returns {void}
 */
function appendModelOption(model) {
    const option = document.createElement('option');
    option.value = model;
    option.textContent = model;
    modelInput.appendChild(option);
}

/**
 * Rebuilds the model dropdown from cached models and the active filter.
 *
 * @returns {void}
 */
function renderModelOptions() {
    const state = getChatState();
    const previous = state.selectedModel;
    modelInput.innerHTML = '';
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = state.configuredDefaultModel
        ? 'Default: ' + state.configuredDefaultModel
        : 'Default / automatic';
    modelInput.appendChild(defaultOption);
    const visible = state.models.filter(isModelVisible);
    visible.forEach(appendModelOption);
    modelInput.value = visible.includes(previous) ? previous : '';
    dispatchChatState('setSelectedModel', { model: modelInput.value });
    renderProviderStrip(getChatState().models);
    updateModelMeta();
}

/**
 * Updates the model metadata caption for the current selection.
 *
 * @returns {void}
 */
function updateModelMeta() {
    modelMeta.textContent = chatStateApi.modelMetaText(getChatState());
}

/**
 * Replaces cached model data and refreshes model-related controls.
 *
 * @param {string[]} models - Model ids returned by the extension host.
 * @param {string} configuredModel - Persisted default model id.
 * @param {string} status - Human-readable status for the model list.
 * @returns {void}
 */
function populateModels(models, configuredModel, status) {
    const state = dispatchChatState('modelsListed', {
        models,
        configuredModel,
        status,
    });
    const counts = providerCounts(state.models);
    const providers = Object.keys(counts).sort();
    postTelemetry('modelsListed', {
        totalModels: state.models.length,
        configuredDefaultModel: state.configuredDefaultModel || 'automatic',
        providerCount: providers.length,
        providers,
        providerModelCounts: counts,
        status: status || '',
    });

    renderModelOptions();
    modelCaption.textContent = chatStateApi.modelCaptionText(getChatState());
}
