/**
 * Updates the busy state of controls and the visible status text.
 *
 * @param {boolean} nextBusy - Whether a response is currently running.
 * @param {string} [message] - Optional status message to show.
 * @returns {void}
 */
function setBusy(nextBusy, message) {
    const state = dispatchChatState('setBusy', {
        busy: nextBusy,
        message,
    });
    const sendButton = byId('send-btn');
    sendButton.disabled = false;
    sendButton.textContent = state.busy ? 'Steer' : 'Send';
    sendButton.setAttribute(
        'aria-label',
        state.busy ? 'Steer active response' : 'Send prompt',
    );
    interruptButton.disabled = !state.busy;
    promptInput.disabled = false;
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
 * @param {object[]} models - Model options to group by provider.
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
 * @param {object[]} models - Model options to summarize by provider.
 * @returns {void}
 */
function renderProviderStrip(models) {
    providerStrip.innerHTML = '';
    const counts = providerCounts(models);
    Object.keys(counts)
        .sort(chatStateApi.compareProviders)
        .forEach(appendProviderChip.bind(null, counts));
}

/**
 * Returns the model options visible under the active filters.
 *
 * @returns {object[]} Filtered model options for the dropdown.
 */
function visibleModelOptions() {
    return chatStateApi.visibleModels(getChatState());
}

/**
 * Appends one selectable model option to the model dropdown.
 *
 * @param {object} model - Model option to add to the dropdown.
 * @param {string} [label] - Optional display label for the option.
 * @returns {void}
 */
function appendModelOption(model, label) {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = label || chatStateApi.modelOptionLabel(model);
    modelInput.appendChild(option);
}

/**
 * Keeps the active model visible even when filters hide it.
 *
 * Search and provider filters are browsing tools. They should not silently
 * clear an already selected model before the user picks a replacement.
 *
 * @param {string} selected - Current selected model id.
 * @param {object[]} visible - Filtered model options.
 * @returns {void}
 */
function appendPinnedSelectedModel(selected, visible) {
    const isVisible = visible.some(model => model.id === selected);
    if (!selected || isVisible) {
        return;
    }

    const state = getChatState();
    const model = chatStateApi.modelOptionForId(state, selected) || {
        id: selected,
        name: selected,
        provider: getProvider(selected),
    };
    const label = 'Selected: ' + chatStateApi.modelOptionLabel(model);
    appendModelOption(model, label);
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
        ? 'Default: ' + chatStateApi.modelLabelForId(
            state,
            state.configuredDefaultModel,
        )
        : 'Default / automatic';
    modelInput.appendChild(defaultOption);
    const visible = visibleModelOptions();
    appendPinnedSelectedModel(previous, visible);
    for (const model of visible) {
        appendModelOption(model);
    }
    const previousVisible = visible.some(model => model.id === previous);
    modelInput.value = previousVisible ? previous : '';
    if (previous && !previousVisible) {
        modelInput.value = previous;
    }
    dispatchChatState('setSelectedModel', { model: modelInput.value });
    renderProviderStrip(getChatState().models);
    updateModelMeta();
    renderModelRuntimeOptions();
}

/**
 * Applies the model search box to dropdown rendering.
 *
 * @returns {void}
 */
function handleModelSearchInput() {
    const state = dispatchChatState('setModelFilter', {
        filter: modelSearchInput.value,
    });
    renderModelOptions();
    logUiAction(
        'modelSearchChanged',
        'chars=' + String(modelSearchInput.value.length),
    );
    postTelemetry('modelSearchChanged', {
        textLength: modelSearchInput.value.length,
        activeProvider: state.activeProvider || 'all',
        visibleModels: visibleModelOptions().length,
    });
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
 * @param {object[]} models - Model options returned by the extension host.
 * @param {string} configuredModel - Persisted default model id.
 * @param {string} status - Human-readable status for the model list.
 * @param {object} discoveryTelemetry - Host-side discovery diagnostics.
 * @returns {void}
 */
function populateModels(
    models,
    configuredModel,
    status,
    discoveryTelemetry
) {
    const state = dispatchChatState('modelsListed', {
        models,
        configuredModel,
        status,
    });
    const counts = providerCounts(state.models);
    const providers = Object.keys(counts)
        .sort(chatStateApi.compareProviders);
    postTelemetry('modelsListed', {
        totalModels: state.models.length,
        configuredDefaultModel: state.configuredDefaultModel || 'automatic',
        providerCount: providers.length,
        providers,
        providerModelCounts: counts,
        status: status || '',
        discoveryTelemetry: discoveryTelemetry || {},
    });

    renderModelOptions();
    modelCaption.textContent = chatStateApi.modelCaptionText(getChatState());
}
