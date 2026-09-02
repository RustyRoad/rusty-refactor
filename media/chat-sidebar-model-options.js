/**
 * Resolves the provider whose runtime controls should be visible.
 *
 * @returns {string} Effective selected provider.
 */
function selectedRuntimeProvider() {
    const state = getChatState();
    const model = getSelectedModel()
        || state.configuredDefaultModel
        || '';
    return getProvider(model).toLowerCase();
}

/**
 * Converts one runtime value into a concise selector label.
 *
 * @param {string} value - Provider runtime value.
 * @returns {string} Human-readable option label.
 */
function runtimeOptionLabel(value) {
    if (value === 'xhigh') {
        return 'XHigh';
    }
    return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Appends one runtime choice to a select element.
 *
 * @param {HTMLSelectElement} input - Select receiving the option.
 * @param {string} value - Provider runtime value.
 * @returns {void}
 */
function appendRuntimeOption(input, value) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = runtimeOptionLabel(value);
    input.appendChild(option);
}

/**
 * Rebuilds a runtime selector from contract-owned choices.
 *
 * @param {HTMLSelectElement} input - Select to populate.
 * @param {string[]} choices - Supported provider values.
 * @param {string} selected - Current provider value.
 * @returns {void}
 */
function fillRuntimeSelect(input, choices, selected) {
    input.innerHTML = '';
    choices.forEach(appendRuntimeOption.bind(null, input));
    input.value = selected;
}

/**
 * Renders only the controls supported by the effective model provider.
 *
 * @returns {void}
 */
function renderModelRuntimeOptions() {
    const state = getChatState();
    const provider = selectedRuntimeProvider();
    const controls = chatStateApi.modelOptionsForProvider(
        state,
        provider,
    );
    const hasThinking = controls.thinkingEfforts.length > 0;
    const hasServiceTier = controls.serviceTiers.length > 0;

    modelRuntimeOptions.hidden = !hasThinking && !hasServiceTier;
    modelThinkingRow.hidden = !hasThinking;
    modelServiceTierRow.hidden = !hasServiceTier;

    if (hasThinking) {
        fillRuntimeSelect(
            modelThinkingInput,
            controls.thinkingEfforts,
            controls.thinkingEffort,
        );
    }
    if (hasServiceTier) {
        fillRuntimeSelect(
            modelServiceTierInput,
            controls.serviceTiers,
            controls.serviceTier,
        );
    }
}

/**
 * Maps one visible control change to its provider-owned state field.
 *
 * @param {string} option - Runtime option name.
 * @param {string} value - Newly selected value.
 * @returns {void}
 */
function updateProviderModelOption(option, value) {
    const provider = selectedRuntimeProvider();
    const patch = {};

    if (provider === 'bedrock' && option === 'thinking') {
        patch.bedrockThinkingEffort = value;
    } else if (provider === 'bedrock' && option === 'serviceTier') {
        patch.bedrockServiceTier = value;
    } else if (provider === 'openai-codex') {
        patch.codexThinkingEffort = value;
    } else if (provider === 'openrouter') {
        patch.openRouterThinkingEffort = value;
    } else {
        return;
    }

    const state = dispatchChatState('setModelOptions', {
        options: patch,
    });
    vscode.postMessage({
        type: 'setModelOptions',
        value: { options: state.modelOptions },
    });
    postTelemetry('modelRuntimeOptionChanged', {
        provider,
        option,
        value,
    });
}

/**
 * Persists the thinking effort selected for the active provider.
 *
 * @returns {void}
 */
function handleThinkingEffortChange() {
    updateProviderModelOption('thinking', modelThinkingInput.value);
}

/**
 * Persists the Bedrock service tier selected by the user.
 *
 * @returns {void}
 */
function handleServiceTierChange() {
    updateProviderModelOption(
        'serviceTier',
        modelServiceTierInput.value,
    );
}

/**
 * Replaces runtime options with the host's validated persisted snapshot.
 *
 * @param {object} options - Complete options received from the host.
 * @returns {void}
 */
function populateModelRuntimeOptions(options) {
    dispatchChatState('setModelOptions', { options });
    renderModelRuntimeOptions();
}

/**
 * Returns a detached option snapshot for one outgoing chat request.
 *
 * @returns {object} Provider runtime options validated by state.
 */
function modelRuntimeOptionsForRequest() {
    return Object.assign({}, getChatState().modelOptions);
}
