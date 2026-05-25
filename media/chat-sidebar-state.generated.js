/**
 * Generated from webview-src/codetether-chat/state.tether.
 *
 * It owns the browser-side state model for the sidebar.
 */
(function installCodetetherChatState(global) {
    'use strict';

    const spec = {
  "actions": [
    "appendMessage",
    "clearChat",
    "hostMessageReceived",
    "modelsListed",
    "sessionsListed",
    "setActiveProvider",
    "setBusy",
    "setCustomModel",
    "setDraft",
    "setFeature",
    "setIncludeContext",
    "setMode",
    "setModelStatus",
    "setSelectedModel",
    "setSelectedVoice",
    "setSpeakingMessage",
    "setSpeechVoices",
    "setSpeechSupported",
    "setSubagents",
    "setVoiceInputActive",
    "setVoiceInputSource",
    "setVoiceInputSources",
    "setVoiceInputSupported",
    "toggleProvider"
  ],
  "defaults": {
    "busy": false,
    "busyStatusText": "Working...",
    "feature": "swarm",
    "includeContext": true,
    "mode": "orchestrate",
    "modelStatus": "Loading models...",
    "statusText": "Ready",
    "subagentSummary": "",
    "voiceInputActive": false,
    "voiceInputSource": "windows-default",
    "voiceInputSupported": false
  },
  "features": [
    "auto",
    "code",
    "debug",
    "refactor",
    "search",
    "test",
    "git",
    "browser",
    "swarm",
    "prd"
  ],
  "messageRoles": [
    "user",
    "assistant",
    "system",
    "tool"
  ],
  "modes": [
    "chat",
    "agent",
    "orchestrate",
    "plan",
    "review"
  ],
  "name": "codetether-chat-state",
  "toolEventKinds": [
    "call",
    "result"
  ],
  "version": 1
};

    /**
     * Returns the current time for state transition records.
     *
     * @returns {string} ISO timestamp for the current transition.
     */
    function nowIso() {
        return new Date().toISOString();
    }

    /**
     * Returns a shallow copy of an array value.
     *
     * @param {*} value - Potential array value.
     * @returns {Array} Copy of the value or an empty array.
     */
    function cloneArray(value) {
        return Array.isArray(value) ? value.slice() : [];
    }

    /**
     * Creates the initial browser state for the chat sidebar.
     *
     * @returns {object} Fresh mutable-free chat state.
     */
    function createInitialState() {
        return {
            version: spec.version,
            busy: spec.defaults.busy,
            statusText: spec.defaults.statusText,
            messages: [],
            models: [],
            configuredDefaultModel: '',
            selectedModel: '',
            customModel: '',
            activeProvider: '',
            modelStatus: spec.defaults.modelStatus,
            mode: spec.defaults.mode,
            feature: spec.defaults.feature,
            includeContext: spec.defaults.includeContext,
            draft: '',
            sessions: [],
            speechVoices: [],
            selectedVoiceId: '',
            speechSupported: false,
            speakingMessageId: '',
            voiceInputSupported: spec.defaults.voiceInputSupported,
            voiceInputActive: spec.defaults.voiceInputActive,
            voiceInputSources: [],
            selectedVoiceInputSource: spec.defaults.voiceInputSource,
            subagents: [],
            subagentSummary: spec.defaults.subagentSummary,
            toolEventCount: 0,
            lastHostMessageType: '',
            lastUpdatedAt: nowIso(),
        };
    }

    /**
     * Clones state so reducers can return fresh objects.
     *
     * @param {object} state - Previous state or a partial state.
     * @returns {object} State copy with array fields detached.
     */
    function cloneState(state) {
        const current = Object.assign(createInitialState(), state || {});
        current.messages = cloneArray(current.messages);
        current.models = cloneArray(current.models);
        current.sessions = cloneArray(current.sessions);
        current.speechVoices = cloneArray(current.speechVoices);
        current.voiceInputSources = cloneArray(current.voiceInputSources);
        current.subagents = cloneArray(current.subagents);
        return current;
    }

    /**
     * Applies a patch and records when the transition occurred.
     *
     * @param {object} state - Previous state object.
     * @param {object} patch - Fields to replace on the state.
     * @returns {object} New state with the patch applied.
     */
    function withUpdate(state, patch) {
        return Object.assign({}, state, patch, {
            lastUpdatedAt: nowIso(),
        });
    }

    /**
     * Normalizes a mode value against the TetherScript contract.
     *
     * @param {*} mode - Candidate mode from the UI.
     * @returns {string} Supported mode value.
     */
    function normalizeMode(mode) {
        return spec.modes.includes(mode) ? mode : spec.defaults.mode;
    }

    /**
     * Normalizes a feature value against the TetherScript contract.
     *
     * @param {*} feature - Candidate feature preset from the UI.
     * @returns {string} Supported feature value.
     */
    function normalizeFeature(feature) {
        return spec.features.includes(feature)
            ? feature
            : spec.defaults.feature;
    }

    /**
     * Returns the provider prefix for a model id.
     *
     * @param {string} model - Candidate model identifier.
     * @returns {string} Provider prefix or the fallback provider.
     */
    function getProvider(model) {
        const value = String(model || '');
        const slash = value.indexOf('/');
        return slash > 0 ? value.slice(0, slash) : 'other';
    }

    /**
     * Sorts model ids and includes the configured default if needed.
     *
     * @param {*} models - Raw model list from the host.
     * @param {string} configured - Persisted default model.
     * @returns {string[]} Normalized model ids.
     */
    function normalizeModels(models, configured) {
        const normalized = cloneArray(models).map(String).sort();
        if (configured && !normalized.includes(configured)) {
            normalized.unshift(configured);
        }
        return normalized;
    }

    /**
     * Counts rendered tool events across the transcript.
     *
     * @param {object[]} messages - Message records to scan.
     * @returns {number} Total visible tool event count.
     */
    function countToolEvents(messages) {
        let count = 0;
        for (let index = 0; index < messages.length; index++) {
            count += cloneArray(messages[index].toolEvents).length;
        }
        return count;
    }

    /**
     * Appends one transcript message to state.
     *
     * @param {object} state - Previous chat state.
     * @param {object} value - Incoming message fields.
     * @returns {object} State with the message appended.
     */
    function appendMessage(state, value) {
        const messages = cloneArray(state.messages);
        const toolEvents = cloneArray(value.toolEvents);
        messages.push({
            id: 'm-' + String(messages.length + 1),
            role: value.role || 'assistant',
            content: value.content || '',
            error: Boolean(value.error),
            sessionId: value.sessionId || '',
            toolEvents,
            createdAt: nowIso(),
        });
        return withUpdate(state, {
            messages,
            toolEventCount: countToolEvents(messages),
        });
    }

    /**
     * Reduces one webview action into the next chat state.
     *
     * @param {object} state - Previous state.
     * @param {object} action - Action type and value payload.
     * @returns {object} New state for the sidebar.
     */
    function reduce(state, action) {
        const current = cloneState(state);
        const type = action && action.type;
        const value = action && action.value ? action.value : {};
        switch (type) {
            case 'appendMessage':
                return appendMessage(current, value);
            case 'clearChat':
                return createInitialState();
            case 'hostMessageReceived':
                return withUpdate(current, {
                    lastHostMessageType: value.type || '',
                });
            case 'modelsListed':
                return withUpdate(current, {
                    models: normalizeModels(
                        value.models,
                        value.configuredModel || '',
                    ),
                    configuredDefaultModel: value.configuredModel || '',
                    modelStatus: value.status || '',
                });
            case 'sessionsListed':
                return withUpdate(current, {
                    sessions: cloneArray(value.sessions),
                });
            case 'setActiveProvider':
                return withUpdate(current, {
                    activeProvider: value.provider || '',
                });
            case 'setBusy':
                return withUpdate(current, {
                    busy: Boolean(value.busy),
                    statusText: value.message
                        || value.statusText
                        || (value.busy
                            ? spec.defaults.busyStatusText
                            : spec.defaults.statusText),
                });
            case 'setCustomModel':
                return withUpdate(current, {
                    customModel: value.model || '',
                });
            case 'setDraft':
                return withUpdate(current, {
                    draft: value.text || '',
                });
            case 'setFeature':
                return withUpdate(current, {
                    feature: normalizeFeature(value.feature),
                });
            case 'setIncludeContext':
                return withUpdate(current, {
                    includeContext: Boolean(value.includeContext),
                });
            case 'setMode':
                return withUpdate(current, {
                    mode: normalizeMode(value.mode),
                });
            case 'setModelStatus':
                return withUpdate(current, {
                    modelStatus: value.status || '',
                });
            case 'setSelectedModel':
                return withUpdate(current, {
                    selectedModel: value.model || '',
                });
            case 'setSelectedVoice':
                return withUpdate(current, {
                    selectedVoiceId: value.voiceId || '',
                });
            case 'setSpeakingMessage':
                return withUpdate(current, {
                    speakingMessageId: value.messageId || '',
                });
            case 'setSpeechVoices':
                return withUpdate(current, {
                    speechVoices: cloneArray(value.voices),
                    selectedVoiceId: selectedVoiceId(
                        value.voices,
                        value.selectedVoiceId || '',
                    ),
                });
            case 'setSpeechSupported':
                return withUpdate(current, {
                    speechSupported: Boolean(value.supported),
                });
            case 'setSubagents':
                return withUpdate(current, {
                    subagents: cloneArray(value.subagents),
                    subagentSummary: value.summary || '',
                });
            case 'setVoiceInputActive':
                return withUpdate(current, {
                    voiceInputActive: Boolean(value.active),
                });
            case 'setVoiceInputSource':
                return withUpdate(current, {
                    selectedVoiceInputSource: selectedVoiceInputSource(
                        current.voiceInputSources,
                        value.sourceId || '',
                    ),
                });
            case 'setVoiceInputSources':
                return withUpdate(current, {
                    voiceInputSources: cloneArray(value.sources),
                    selectedVoiceInputSource: selectedVoiceInputSource(
                        value.sources,
                        value.selectedInputId || '',
                    ),
                });
            case 'setVoiceInputSupported':
                return withUpdate(current, {
                    voiceInputSupported: Boolean(value.supported),
                });
            case 'toggleProvider':
                return withUpdate(current, {
                    activeProvider: current.activeProvider
                        === value.provider ? '' : value.provider || '',
                });
            default:
                return current;
        }
    }

    /**
     * Returns the model explicitly selected for the next request.
     *
     * @param {object} state - Current chat state.
     * @returns {string} Custom or selected model id.
     */
    function selectedModel(state) {
        const current = cloneState(state);
        return current.customModel.trim()
            || current.selectedModel.trim();
    }

    /**
     * Returns the model that will effectively be used.
     *
     * @param {object} state - Current chat state.
     * @returns {string} Effective model or automatic fallback.
     */
    function effectiveModel(state) {
        const current = cloneState(state);
        return selectedModel(current)
            || current.configuredDefaultModel
            || 'automatic';
    }

    /**
     * Counts models by provider for provider filter chips.
     *
     * @param {object} state - Current chat state.
     * @returns {object} Provider names mapped to counts.
     */
    function providerCounts(state) {
        const counts = {};
        const models = cloneState(state).models;
        for (let index = 0; index < models.length; index++) {
            const provider = getProvider(models[index]);
            counts[provider] = (counts[provider] || 0) + 1;
        }
        return counts;
    }

    /**
     * Filters models through the current active provider.
     *
     * @param {object} state - Current chat state.
     * @returns {string[]} Models visible in the dropdown.
     */
    function visibleModels(state) {
        const current = cloneState(state);
        const visible = [];
        for (let index = 0; index < current.models.length; index++) {
            const model = current.models[index];
            if (!current.activeProvider
                    || getProvider(model) === current.activeProvider) {
                visible.push(model);
            }
        }
        return visible;
    }

    /**
     * Formats the model metadata line.
     *
     * @param {object} state - Current chat state.
     * @returns {string} Human-readable model metadata.
     */
    function modelMetaText(state) {
        return 'Using ' + effectiveModel(state);
    }

    /**
     * Formats the model caption shown in the header.
     *
     * @param {object} state - Current chat state.
     * @returns {string} Caption for model availability.
     */
    function modelCaptionText(state) {
        const current = cloneState(state);
        return current.modelStatus
            || String(current.models.length) + ' models available';
    }

    /**
     * Explains why a send operation should be blocked.
     *
     * @param {object} state - Current chat state.
     * @param {string} text - Candidate prompt text.
     * @returns {string} Empty string when sending is allowed.
     */
    function sendBlockedReason(state, text) {
        if (!String(text || '').trim()) {
            return 'empty-input';
        }
        return cloneState(state).busy ? 'busy' : '';
    }

    /**
     * Keeps the selected voice only when it is present in the voice list.
     *
     * @param {object[]} voices - Voice records sent by the host.
     * @param {string} voiceId - Candidate selected voice id.
     * @returns {string} Valid selected voice id or an empty string.
     */
    function selectedVoiceId(voices, voiceId) {
        const items = cloneArray(voices);
        const selected = String(voiceId || '');
        return items.some(voice => voice.id === selected) ? selected : '';
    }

    /**
     * Keeps the selected input source only when it is host-provided.
     *
     * @param {object[]} sources - Voice input sources sent by the host.
     * @param {string} sourceId - Candidate selected input source id.
     * @returns {string} Valid source id or the contract default.
     */
    function selectedVoiceInputSource(sources, sourceId) {
        const items = cloneArray(sources);
        const selected = String(sourceId || '');
        return items.some(source => source.id === selected)
            ? selected
            : spec.defaults.voiceInputSource;
    }

    /**
     * Returns the display name for the selected voice.
     *
     * @param {object} state - Current chat state.
     * @returns {string} Voice label for compact UI display.
     */
    function selectedVoiceName(state) {
        const current = cloneState(state);
        const voice = current.speechVoices.find(item => {
            return item.id === current.selectedVoiceId;
        });
        return voice ? voice.name : 'Automatic voice';
    }

    /**
     * Checks whether a message is the active speech target.
     *
     * @param {object} state - Current chat state.
     * @param {string} messageId - Message id to compare.
     * @returns {boolean} True when that message is being spoken.
     */
    function isMessageSpeaking(state, messageId) {
        return Boolean(messageId)
            && cloneState(state).speakingMessageId === messageId;
    }

    /**
     * Returns the active sub-agent rows shown in the sidebar.
     *
     * @param {object} state - Current chat state.
     * @returns {object[]} Sub-agent activity records.
     */
    function subagents(state) {
        return cloneState(state).subagents;
    }

    /**
     * Returns a compact summary for the sub-agent activity panel.
     *
     * @param {object} state - Current chat state.
     * @returns {string} Summary text for the activity panel.
     */
    function subagentSummaryText(state) {
        const current = cloneState(state);
        return current.subagentSummary
            || String(current.subagents.length) + ' tracked';
    }

    global.CodetetherChatState = {
        spec,
        createInitialState,
        reduce,
        getProvider,
        selectedModel,
        effectiveModel,
        providerCounts,
        visibleModels,
        modelMetaText,
        modelCaptionText,
        sendBlockedReason,
        selectedVoiceName,
        isMessageSpeaking,
        subagents,
        subagentSummaryText,
    };
})(window);
