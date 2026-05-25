/**
 * Host-supported microphone source shown in the sidebar selector.
 */
export interface ChatVoiceInputSource {
    id: string;
    label: string;
}

/**
 * State update emitted when microphone recognition starts, stops, or fails.
 */
export interface ChatVoiceInputState {
    listening: boolean;
    supported: boolean;
    error?: string;
    sources?: ChatVoiceInputSource[];
    selectedInputId?: string;
}

/**
 * Result emitted when one speech recognition attempt returns text.
 */
export interface ChatVoiceInputResult {
    text: string;
    confidence: string;
    status: string;
}

/**
 * Callback used to publish microphone state changes to the webview.
 */
export type ChatVoiceInputStateSink = (state: ChatVoiceInputState) => void;

/**
 * Callback used to publish recognized text to the webview.
 */
export type ChatVoiceInputResultSink = (
    result: ChatVoiceInputResult
) => void;
