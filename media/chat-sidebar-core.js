const vscode = acquireVsCodeApi();

/**
 * Finds a DOM element by id inside the webview document.
 *
 * @param {string} id - Element id without the leading hash.
 * @returns {HTMLElement|null} Matching element, or null when absent.
 */
function byId(id) {
    return document.getElementById(id);
}

const chatContainer = byId('chat-container');
const promptInput = byId('prompt-input');
const modelInput = byId('model-input');
const customModelInput = byId('custom-model-input');
const providerStrip = byId('provider-strip');
const modelMeta = byId('model-meta');
const statusBar = byId('status-bar');
const statusText = byId('status');
const modelCaption = byId('model-caption');
const contextToggle = byId('context-toggle');
const modeInput = byId('mode-input');
const featureInput = byId('feature-input');
const sessionsList = byId('sessions-list');
const sessionIdInput = byId('session-id-input');
const sessionIdOpenButton = byId('open-session-id-btn');
const subagentPanel = byId('subagent-panel');
const subagentSummary = byId('subagent-summary');
const subagentList = byId('subagent-list');
const voiceInput = byId('voice-input');
const voiceSourceInput = byId('voice-source-input');
const voiceButton = byId('voice-btn');
const chatStateApi = window.CodetetherChatState;
let chatState = chatStateApi.createInitialState();

/**
 * Returns the latest TetherScript-backed chat state.
 *
 * @returns {object} Current chat state snapshot.
 */
function getChatState() {
    return chatState;
}

/**
 * Applies one TetherScript-backed state action.
 *
 * @param {string} type - Action type from the generated state contract.
 * @param {object} [value] - Optional action payload.
 * @returns {object} Updated chat state snapshot.
 */
function dispatchChatState(type, value) {
    chatState = chatStateApi.reduce(chatState, {
        type,
        value: value || {},
    });
    return chatState;
}

/**
 * Extracts the provider prefix from a model identifier.
 *
 * @param {string} model - Model id, usually in provider/name form.
 * @returns {string} Provider prefix, or "other" when no prefix exists.
 */
function getProvider(model) {
    return chatStateApi.getProvider(model);
}

/**
 * Resolves the model currently selected by the user.
 *
 * Custom text takes precedence over the dropdown because it represents an
 * explicit model id entered by the user.
 *
 * @returns {string} Selected model id, or an empty string for default.
 */
function getSelectedModel() {
    return chatStateApi.selectedModel(getChatState());
}

/**
 * Sends a telemetry event to the extension host.
 *
 * Non-object payloads are ignored so host telemetry receives a predictable
 * detail object. The post is asynchronous and intentionally has no response.
 *
 * @param {string} event - Telemetry event name understood by the host.
 * @param {object} [payload] - Optional structured event details.
 * @returns {void}
 */
function postTelemetry(event, payload) {
    const detail = payload && typeof payload === 'object' ? payload : {};
    vscode.postMessage({
        type: 'uiTelemetry',
        value: {
            event,
            detail,
        },
    });
}

/**
 * Writes a UI action line to the extension host log.
 *
 * @param {string} action - Short action name for the log entry.
 * @param {string} [detail] - Optional formatted action metadata.
 * @returns {void}
 */
function logUiAction(action, detail) {
    const details = detail ? ' | ' + detail : '';
    vscode.postMessage({
        type: 'log',
        message: '[UI] ' + action + details,
    });
}

/**
 * Escapes user or assistant text before it is inserted as HTML.
 *
 * @param {*} value - Value to stringify and escape for HTML display.
 * @returns {string} HTML-safe text that preserves the original characters.
 */
function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Renders one escaped fenced code block for the markdown subset.
 *
 * @param {string} _match - Full matched fenced code text.
 * @param {string} code - Captured code block body.
 * @returns {string} HTML for the fenced code block.
 */
function renderCodeFence(_match, code) {
    return '<pre><code>' + code.trim() + '</code></pre>';
}

/**
 * Renders the small markdown subset supported by the chat view.
 *
 * The renderer escapes all input before adding tags for fenced code, inline
 * code, bold text, paragraphs, and line breaks.
 *
 * @param {string} source - Assistant message text to render.
 * @returns {string} HTML string safe to assign to a message element.
 */
function renderMarkdown(source) {
    let text = escapeHtml(source || '');
    const tick = String.fromCharCode(96);
    const fence = new RegExp(
        tick + tick + tick + '([\\s\\S]*?)' + tick + tick + tick,
        'g',
    );
    const inlineCode = new RegExp(tick + '([^' + tick + ']+)' + tick, 'g');
    text = text.replace(fence, renderCodeFence);
    text = text.replace(inlineCode, '<code>$1</code>');
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\n{2,}/g, '</p><p>');
    text = text.replace(/\n/g, '<br>');
    return '<p>' + text + '</p>';
}
