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
    "chatThreadsListed",
    "clearChat",
    "clearMessages",
    "clearThreadMessages",
    "hostMessageReceived",
    "modelsListed",
    "replaceThreadMessages",
    "sessionsListed",
    "setActiveThread",
    "setActiveProvider",
    "setBusy",
    "setCustomModel",
    "setDraft",
    "setFeature",
    "setIncludeContext",
    "setMode",
    "setModelStatus",
    "setModelFilter",
    "setModelOptions",
    "setSelectedModel",
    "setSelectedVoice",
    "setSessionView",
    "setSpeakingMessage",
    "setSpeechBackend",
    "setSpeechVoices",
    "setSpeechSupported",
    "setSubagents",
    "setVoiceInputActive",
    "setVoiceInputSource",
    "setVoiceInputSources",
    "setVoiceInputSupported",
    "toggleProvider",
    "upsertStreamingMessage"
  ],
  "defaults": {
    "activeThreadId": "",
    "busy": false,
    "busyStatusText": "Working...",
    "feature": "auto",
    "includeContext": true,
    "mode": "chat",
    "modelFilter": "",
    "modelOptions": {
      "bedrockServiceTier": "default",
      "bedrockThinkingEffort": "medium",
      "codexThinkingEffort": "default",
      "openRouterThinkingEffort": "default"
    },
    "modelStatus": "Loading models...",
    "sessionView": "active",
    "speechBackend": "server",
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
  "messageFields": [
    "id",
    "role",
    "content",
    "thinking",
    "phase",
    "modelId",
    "streaming",
    "error",
    "sessionId",
    "toolEvents",
    "autoSpeak",
    "createdAt",
    "threadId"
  ],
  "messageRoles": [
    "user",
    "assistant",
    "system",
    "tool"
  ],
  "modelFields": [
    "id",
    "name",
    "provider"
  ],
  "modelOptionChoices": {
    "bedrockServiceTiers": [
      "default",
      "standard",
      "priority"
    ],
    "bedrockThinkingEfforts": [
      "low",
      "medium",
      "high"
    ],
    "codexThinkingEfforts": [
      "default",
      "none",
      "low",
      "medium",
      "high",
      "xhigh",
      "max"
    ],
    "openRouterThinkingEfforts": [
      "default",
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max"
    ]
  },
  "modes": [
    "chat",
    "agent",
    "orchestrate",
    "plan",
    "review"
  ],
  "name": "codetether-chat-state",
  "threadFields": [
    "id",
    "title",
    "busy",
    "statusText",
    "updatedAt",
    "sessionId"
  ],
  "toolEventKinds": [
    "call",
    "result"
  ],
  "version": 6
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
     * Returns the opaque ID from a model option or legacy string.
     *
     * @param {*} model - Model option or legacy model ID.
     * @returns {string} Opaque model ID.
     */
    function modelId(model) {
        if (model && typeof model === 'object') {
            return String(model.id || model.modelId || '');
        }
        return String(model || '');
    }

    /**
     * Returns the provider used to sort one model option.
     *
     * @param {*} model - Model option or legacy model ID.
     * @returns {string} Lowercase provider name.
     */
    function modelProvider(model) {
        if (model && typeof model === 'object' && model.provider) {
            return String(model.provider).toLowerCase();
        }

        const text = modelId(model);
        const slash = text.indexOf('/');
        if (slash <= 0) {
            return 'other';
        }
        return text.slice(0, slash).toLowerCase();
    }

    const providerPriority = {
        'openai-codex': 0,
        openai: 1,
        anthropic: 2,
        'github-copilot': 3,
        copilot: 4,
        zai: 5,
        google: 6,
        gemini: 7,
        ollama: 8,
        local: 9,
        other: 99,
    };

    /**
     * Returns the sort rank for a model provider group.
     *
     * Provider names known to be common in Codetether are pinned first. New
     * providers remain alphabetized after the pinned groups.
     *
     * @param {string} provider - Provider name from model metadata.
     * @returns {number} Smaller numbers sort earlier.
     */
    function providerSortRank(provider) {
        const key = String(provider || 'other').toLowerCase();

        if (Object.prototype.hasOwnProperty.call(providerPriority, key)) {
            return providerPriority[key];
        }

        return 50;
    }

    /**
     * Sorts provider groups in a stable, user-facing order.
     *
     * @param {string} left - Left provider id.
     * @param {string} right - Right provider id.
     * @returns {number} Sort order.
     */
    function compareProviders(left, right) {
        const leftText = String(left || 'other').toLowerCase();
        const rightText = String(right || 'other').toLowerCase();
        const rankOrder = providerSortRank(leftText)
            - providerSortRank(rightText);

        if (rankOrder !== 0) {
            return rankOrder;
        }

        return leftText.localeCompare(rightText);
    }

    /**
     * Sorts models by provider, display name, and opaque ID.
     *
     * @param {*} left - Left model option.
     * @param {*} right - Right model option.
     * @returns {number} Sort order.
     */
    function compareModels(left, right) {
        const providerOrder = compareProviders(
            modelProvider(left),
            modelProvider(right),
        );
        if (providerOrder !== 0) {
            return providerOrder;
        }
        const nameOrder = modelName(left).localeCompare(modelName(right));
        if (nameOrder !== 0) {
            return nameOrder;
        }
        return modelId(left).localeCompare(modelId(right));
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
            modelFilter: spec.defaults.modelFilter,
            modelStatus: spec.defaults.modelStatus,
            modelOptions: normalizeRuntimeOptions(
                spec.defaults.modelOptions,
            ),
            mode: spec.defaults.mode,
            feature: spec.defaults.feature,
            includeContext: spec.defaults.includeContext,
            draft: '',
            chatThreads: [],
            activeThreadId: spec.defaults.activeThreadId,
            sessionView: spec.defaults.sessionView,
            sessions: [],
            speechVoices: [],
            selectedVoiceId: '',
            speechBackend: spec.defaults.speechBackend,
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
        current.modelOptions = normalizeRuntimeOptions(
            current.modelOptions,
        );
        current.chatThreads = cloneArray(current.chatThreads);
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
     * Returns one supported provider option or its configured fallback.
     *
     * @param {*} value - Candidate option value.
     * @param {string[]} choices - Supported values for one option.
     * @param {string} fallback - Value used for invalid input.
     * @returns {string} Normalized option value.
     */
    function normalizeRuntimeChoice(value, choices, fallback) {
        return choices.includes(value) ? value : fallback;
    }

    /**
     * Validates the complete provider-runtime option state.
     *
     * @param {*} value - Candidate options from host or browser state.
     * @returns {object} Complete normalized model options.
     */
    function normalizeRuntimeOptions(value) {
        const candidate = value && typeof value === 'object' ? value : {};
        const defaults = spec.defaults.modelOptions;
        const choices = spec.modelOptionChoices;

        return {
            bedrockThinkingEffort: normalizeRuntimeChoice(
                candidate.bedrockThinkingEffort,
                choices.bedrockThinkingEfforts,
                defaults.bedrockThinkingEffort,
            ),
            bedrockServiceTier: normalizeRuntimeChoice(
                candidate.bedrockServiceTier,
                choices.bedrockServiceTiers,
                defaults.bedrockServiceTier,
            ),
            codexThinkingEffort: normalizeRuntimeChoice(
                candidate.codexThinkingEffort,
                choices.codexThinkingEfforts,
                defaults.codexThinkingEffort,
            ),
            openRouterThinkingEffort: normalizeRuntimeChoice(
                candidate.openRouterThinkingEffort,
                choices.openRouterThinkingEfforts,
                defaults.openRouterThinkingEffort,
            ),
        };
    }

    /**
     * Returns controls and current values for one selected provider.
     *
     * @param {object} state - Current chat state.
     * @param {string} provider - Selected provider identifier.
     * @returns {object} Provider-specific choices for control rendering.
     */
    function modelOptionsForProvider(state, provider) {
        const current = cloneState(state);
        const normalized = String(provider || '').toLowerCase();
        const choices = spec.modelOptionChoices;

        if (normalized === 'bedrock') {
            return {
                provider: normalized,
                thinkingEffort: current.modelOptions
                    .bedrockThinkingEffort,
                thinkingEfforts: cloneArray(
                    choices.bedrockThinkingEfforts,
                ),
                serviceTier: current.modelOptions.bedrockServiceTier,
                serviceTiers: cloneArray(choices.bedrockServiceTiers),
            };
        }
        if (normalized === 'openai-codex') {
            return {
                provider: normalized,
                thinkingEffort: current.modelOptions
                    .codexThinkingEffort,
                thinkingEfforts: cloneArray(
                    choices.codexThinkingEfforts,
                ),
                serviceTier: '',
                serviceTiers: [],
            };
        }
        if (normalized === 'openrouter') {
            return {
                provider: normalized,
                thinkingEffort: current.modelOptions
                    .openRouterThinkingEffort,
                thinkingEfforts: cloneArray(
                    choices.openRouterThinkingEfforts,
                ),
                serviceTier: '',
                serviceTiers: [],
            };
        }
        return {
            provider: normalized,
            thinkingEffort: '',
            thinkingEfforts: [],
            serviceTier: '',
            serviceTiers: [],
        };
    }

    /**
     * Returns the explicit provider or a provider/model prefix.
     *
     * @param {*} model - Candidate model option or identifier.
     * @returns {string} Provider prefix or the other-model provider.
     */
    function getProvider(model) {
        if (model && typeof model === 'object' && model.provider) {
            return String(model.provider);
        }

        const value = modelId(model);
        const slash = value.indexOf('/');
        return slash > 0 ? value.slice(0, slash) : 'other';
    }

    /**
     * Returns a readable name from a model option or legacy model ID.
     *
     * @param {*} model - Candidate model option or identifier.
     * @returns {string} Human-readable model name.
     */
    function modelName(model) {
        if (model && typeof model === 'object') {
            const name = String(model.name || model.label || '').trim();
            if (name) {
                return name;
            }
        }

        const id = modelId(model);
        const slash = id.indexOf('/');
        return slash >= 0 ? id.slice(slash + 1) : id;
    }

    /**
     * Normalizes one host model into the selector contract.
     *
     * Legacy string models remain supported for configured values saved by
     * older extension builds.
     *
     * @param {*} model - Raw host model option or legacy ID.
     * @returns {object|null} Normalized model option or null without an ID.
     */
    function normalizeModel(model) {
        const id = modelId(model).trim();
        if (!id) {
            return null;
        }

        return {
            id,
            name: modelName(model).trim() || id,
            provider: getProvider(model).trim() || 'other',
        };
    }

    /**
     * Sorts only models reported by the latest authoritative host snapshot.
     *
     * @param {*} models - Raw model list from the host.
     * @returns {object[]} Normalized model options.
     */
    function normalizeModels(models) {
        const modelsById = new Map();
        const rawModels = cloneArray(models);

        for (let index = 0; index < rawModels.length; index++) {
            const model = normalizeModel(rawModels[index]);
            if (model) {
                modelsById.set(model.id, model);
            }
        }

        return [...modelsById.values()].sort(compareModels);
    }

    /**
     * Converts one session update value to a sortable timestamp.
     *
     * Missing or invalid dates sort as the oldest possible session.
     *
     * @param {*} session - Session metadata received from the extension host.
     * @returns {number} Milliseconds since the epoch, or zero when invalid.
     */
    function sessionUpdatedAt(session) {
        const timestamp = new Date(session?.updatedAt || 0).getTime();
        return Number.isFinite(timestamp) ? timestamp : 0;
    }

    /**
     * Orders session summaries from most recently updated to oldest.
     *
     * @param {*} left - Left session summary.
     * @param {*} right - Right session summary.
     * @returns {number} Sort order with newer timestamps first.
     */
    function compareSessions(left, right) {
        return sessionUpdatedAt(right) - sessionUpdatedAt(left);
    }

    /**
     * Copies and sorts host sessions without mutating the received payload.
     *
     * @param {*} sessions - Potential array of session summaries.
     * @returns {Array} Session summaries sorted from newest to oldest.
     */
    function normalizeSessions(sessions) {
        return cloneArray(sessions).sort(compareSessions);
    }

    /**
     * Orders running chats first and otherwise uses recent activity.
     *
     * @param {*} left - Left live chat summary.
     * @param {*} right - Right live chat summary.
     * @returns {number} Sort order for the Active session list.
     */
    function compareChatThreads(left, right) {
        const busyOrder = Number(Boolean(right?.busy))
            - Number(Boolean(left?.busy));
        if (busyOrder !== 0) {
            return busyOrder;
        }

        return sessionUpdatedAt(right) - sessionUpdatedAt(left);
    }

    /**
     * Copies and sorts live thread summaries from the extension host.
     *
     * @param {*} threads - Potential live chat summary array.
     * @returns {Array} Detached live thread summaries.
     */
    function normalizeChatThreads(threads) {
        return cloneArray(threads).sort(compareChatThreads);
    }

    /**
     * Converts loaded transcript rows into thread-scoped message records.
     *
     * @param {*} messages - Persisted transcript rows from the host.
     * @param {string} threadId - Live thread receiving the transcript.
     * @param {string} sessionId - Persisted transport session identifier.
     * @returns {object[]} Normalized message state records.
     */
    function normalizeThreadMessages(messages, threadId, sessionId) {
        return cloneArray(messages).map((message, index) => ({
            id: threadId + '-loaded-' + String(index + 1),
            role: message.role || 'assistant',
            content: message.content || '',
            thinking: message.thinking || '',
            phase: '',
            modelId: message.model_id
                || message.modelId
                || message.model
                || '',
            streaming: false,
            error: false,
            sessionId: message.sessionId || sessionId || '',
            threadId,
            toolEvents: cloneArray(message.toolEvents),
            autoSpeak: false,
            createdAt: nowIso(),
        }));
    }

    /**
     * Removes every visible message owned by one chat thread.
     *
     * @param {object} state - Previous chat state.
     * @param {string} threadId - Thread whose transcript is cleared.
     * @returns {object} State with only the target transcript removed.
     */
    function clearThreadMessages(state, threadId) {
        const target = threadId || state.activeThreadId;
        const messages = cloneArray(state.messages).filter(message => {
            return message.threadId !== target;
        });
        return withUpdate(state, {
            messages,
            speakingMessageId: '',
            toolEventCount: countToolEvents(messages),
        });
    }

    /**
     * Replaces one thread transcript while preserving all background chats.
     *
     * @param {object} state - Previous chat state.
     * @param {object} value - Thread id and persisted messages.
     * @returns {object} State containing the loaded transcript.
     */
    function replaceThreadMessages(state, value) {
        const threadId = value.threadId || state.activeThreadId;
        const retained = cloneArray(state.messages).filter(message => {
            return message.threadId !== threadId;
        });
        const messages = retained.concat(
            normalizeThreadMessages(
                value.messages,
                threadId,
                value.sessionId,
            ),
        );
        return withUpdate(state, {
            messages,
            activeThreadId: threadId,
            speakingMessageId: '',
            toolEventCount: countToolEvents(messages),
        });
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
            thinking: value.thinking || '',
            phase: value.phase || '',
            modelId: value.modelId || '',
            streaming: Boolean(value.streaming),
            error: Boolean(value.error),
            sessionId: value.sessionId || '',
            threadId: value.threadId || state.activeThreadId,
            toolEvents,
            autoSpeak: Boolean(value.autoSpeak),
            createdAt: nowIso(),
        });
        return withUpdate(state, {
            messages,
            toolEventCount: countToolEvents(messages),
        });
    }

    /**
     * Inserts or replaces one progressively rendered assistant message.
     *
     * @param {object} state - Previous chat state.
     * @param {object} value - Complete host snapshot for one response id.
     * @returns {object} State containing the latest response snapshot.
     */
    function upsertStreamingMessage(state, value) {
        const messages = cloneArray(state.messages);
        const id = String(value.id || '');
        const threadId = value.threadId || state.activeThreadId;
        const index = messages.findIndex(message => {
            return message.id === id && message.threadId === threadId;
        });
        const previous = index >= 0 ? messages[index] : {};
        const record = {
            id: id || 'm-' + String(messages.length + 1),
            role: 'assistant',
            content: value.content || '',
            thinking: value.thinking || '',
            phase: value.phase || '',
            modelId: value.modelId || '',
            streaming: Boolean(value.streaming),
            error: Boolean(value.error),
            sessionId: value.sessionId || '',
            threadId,
            toolEvents: cloneArray(value.toolEvents),
            autoSpeak: Boolean(value.autoSpeak),
            createdAt: previous.createdAt || nowIso(),
        };

        if (index >= 0) {
            messages[index] = record;
        } else {
            messages.push(record);
        }

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
            case 'chatThreadsListed': {
                const chatThreads = normalizeChatThreads(value.threads);
                const requestedId = value.activeThreadId
                    || current.activeThreadId;
                const activeThreadId = chatThreads.some(thread => {
                    return thread.id === requestedId;
                }) ? requestedId : chatThreads[0]?.id || '';
                return withUpdate(current, {
                    chatThreads,
                    activeThreadId,
                });
            }
            case 'clearChat':
                return clearThreadMessages(
                    current,
                    current.activeThreadId,
                );
            case 'clearMessages':
                return clearThreadMessages(
                    current,
                    current.activeThreadId,
                );
            case 'clearThreadMessages':
                return clearThreadMessages(current, value.threadId);
            case 'hostMessageReceived':
                return withUpdate(current, {
                    lastHostMessageType: value.type || '',
                });
            case 'modelsListed': {
                const liveModels = normalizeModels(value.models);
                const selectedModel = liveModels.some(model => {
                    return model.id === current.selectedModel;
                }) ? current.selectedModel : '';
                return withUpdate(current, {
                    models: liveModels,
                    selectedModel,
                    configuredDefaultModel: value.configuredModel || '',
                    modelStatus: value.status || '',
                });
            }
            case 'replaceThreadMessages':
                return replaceThreadMessages(current, value);
            case 'sessionsListed':
                return withUpdate(current, {
                    sessions: normalizeSessions(value.sessions),
                });
            case 'setActiveThread':
                return current.chatThreads.some(thread => {
                    return thread.id === value.threadId;
                }) ? withUpdate(current, {
                        activeThreadId: value.threadId,
                    }) : current;
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
            case 'setModelFilter':
                return withUpdate(current, {
                    modelFilter: normalizeModelFilter(value.filter),
                });
            case 'setModelOptions':
                return withUpdate(current, {
                    modelOptions: normalizeRuntimeOptions(
                        Object.assign(
                            {},
                            current.modelOptions,
                            value.options || value,
                        ),
                    ),
                });
            case 'setSelectedModel':
                return withUpdate(current, {
                    selectedModel: value.model || '',
                });
            case 'setSelectedVoice':
                return withUpdate(current, {
                    selectedVoiceId: value.voiceId || '',
                });
            case 'setSessionView':
                return withUpdate(current, {
                    sessionView: value.sessionView === 'previous'
                        ? 'previous'
                        : 'active',
                });
            case 'setSpeakingMessage':
                return withUpdate(current, {
                    speakingMessageId: value.messageId || '',
                });
            case 'setSpeechBackend':
                return withUpdate(current, {
                    speechBackend: value.backend || 'server',
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
            case 'upsertStreamingMessage':
                return upsertStreamingMessage(current, value);
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
     * @returns {string} Effective model or automatic selection.
     */
    function effectiveModel(state) {
        const current = cloneState(state);
        return selectedModel(current)
            || current.configuredDefaultModel
            || 'automatic';
    }

    /**
     * Normalizes model search text for case-insensitive matching.
     *
     * @param {*} filter - Raw search value from the model search input.
     * @returns {string} Lowercase trimmed search text.
     */
    function normalizeModelFilter(filter) {
        return String(filter || '').trim().toLowerCase();
    }

    /**
     * Returns whether a model option matches all search terms.
     *
     * @param {*} model - Candidate model option.
     * @param {string} filter - Normalized or raw model search text.
     * @returns {boolean} True when every query term appears in the model.
     */
    function modelMatchesFilter(model, filter) {
        const query = normalizeModelFilter(filter);
        const text = [
            modelId(model),
            modelName(model),
            getProvider(model),
        ].join(' ').toLowerCase();

        if (!query) {
            return true;
        }

        return query.split(/\s+/).every(part => text.includes(part));
    }

    /**
     * Returns the selector option for an opaque model ID.
     *
     * @param {object} state - Current chat state.
     * @param {string} id - Opaque model ID to find.
     * @returns {object|null} Matching model option or null.
     */
    function modelOptionForId(state, id) {
        const models = cloneState(state).models;
        const wanted = String(id || '');

        for (let index = 0; index < models.length; index++) {
            if (modelId(models[index]) === wanted) {
                return models[index];
            }
        }
        return null;
    }

    /**
     * Formats one model option for compact selector display.
     *
     * @param {*} model - Model option or legacy model ID.
     * @returns {string} Model name followed by its provider.
     */
    function modelOptionLabel(model) {
        const name = modelName(model) || modelId(model);
        return name + ' — ' + getProvider(model);
    }

    /**
     * Formats a known model ID for user-facing status text.
     *
     * @param {object} state - Current chat state.
     * @param {string} id - Opaque model ID to format.
     * @returns {string} Model selector label or the original ID.
     */
    function modelLabelForId(state, id) {
        const option = modelOptionForId(state, id);
        return option ? modelOptionLabel(option) : String(id || '');
    }

    /**
     * Resolves immutable display provenance for one response model ID.
     *
     * @param {object} state - Current chat state containing model metadata.
     * @param {string} id - Opaque model ID recorded for the response.
     * @returns {object|null} Model name and provenance, or null without an ID.
     */
    function modelIdentityForId(state, id) {
        const value = String(id || '').trim();
        if (!value) {
            return null;
        }

        const option = modelOptionForId(state, value) || value;
        return {
            id: value,
            name: modelName(option) || value,
            provider: getProvider(option),
        };
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
     * Filters models through the current provider and search filters.
     *
     * @param {object} state - Current chat state.
     * @returns {object[]} Models visible in the dropdown.
     */
    function visibleModels(state) {
        const current = cloneState(state);
        const visible = [];
        for (let index = 0; index < current.models.length; index++) {
            const model = current.models[index];
            const providerVisible = !current.activeProvider
                || getProvider(model) === current.activeProvider;
            const searchVisible = modelMatchesFilter(
                model,
                current.modelFilter,
            );

            if (providerVisible && searchVisible) {
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
        const current = cloneState(state);
        const matching = current.modelFilter
            ? ' | ' + String(visibleModels(current).length) + ' matching'
            : '';

        const effective = effectiveModel(current);
        const label = effective === 'automatic'
            ? effective
            : modelLabelForId(current, effective);

        return 'Using ' + label + matching;
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
        void state;
        return '';
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
     * Returns live chat threads in browser display order.
     *
     * @param {object} state - Current chat state.
     * @returns {object[]} Live chat summaries.
     */
    function chatThreads(state) {
        return cloneState(state).chatThreads;
    }

    /**
     * Returns the selected live chat summary when one exists.
     *
     * @param {object} state - Current chat state.
     * @returns {object|undefined} Selected live chat summary.
     */
    function activeThread(state) {
        const current = cloneState(state);
        return current.chatThreads.find(thread => {
            return thread.id === current.activeThreadId;
        });
    }

    /**
     * Returns only messages belonging to the selected live chat.
     *
     * @param {object} state - Current chat state.
     * @returns {object[]} Selected chat transcript messages.
     */
    function activeThreadMessages(state) {
        const current = cloneState(state);
        return current.messages.filter(message => {
            return message.threadId === current.activeThreadId;
        });
    }

    /**
     * Returns the selected Active or Previous session-browser view.
     *
     * @param {object} state - Current chat state.
     * @returns {string} Session-browser view identifier.
     */
    function sessionView(state) {
        return cloneState(state).sessionView;
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
        compareProviders,
        selectedModel,
        effectiveModel,
        modelOptionForId,
        modelOptionLabel,
        modelLabelForId,
        modelIdentityForId,
        providerCounts,
        visibleModels,
        modelMetaText,
        modelCaptionText,
        modelOptionsForProvider,
        sendBlockedReason,
        selectedVoiceName,
        isMessageSpeaking,
        chatThreads,
        activeThread,
        activeThreadMessages,
        sessionView,
        subagents,
        subagentSummaryText,
    };
})(window);
