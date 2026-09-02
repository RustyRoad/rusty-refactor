/**
 * Installed voice exposed by a chat speech backend.
 */
export interface ChatSpeechVoice {
    id: string;
    name: string;
    natural: boolean;
}

/**
 * State update emitted when speech starts, stops, or fails.
 */
export interface ChatSpeechState {
    messageId: string;
    speaking: boolean;
    supported: boolean;
    backend: ChatSpeechBackend;
    error?: string;
}

/**
 * Playback implementation selected for the current VS Code environment.
 */
export type ChatSpeechBackend =
    | 'system'
    | 'windows-native'
    | 'huggingface-windows'
    | 'server'
    | 'native'
    | 'none';

/**
 * Audio command sent from a remote extension host to its local webview.
 */
export type ChatSpeechAudioCommand = ChatSpeechPlayCommand
    | ChatSpeechFinishCommand
    | ChatSpeechStopCommand;

/**
 * One queued WAV chunk sent to the local webview for ordered playback.
 */
interface ChatSpeechPlayCommand {
    action: 'play';
    messageId: string;
    audioBase64: string;
    final: boolean;
}

/**
 * Marks the latest queued audio as the end of streamed speech input.
 */
interface ChatSpeechFinishCommand {
    action: 'finish';
    messageId: string;
}

/**
 * Command that clears queued and currently playing webview speech.
 */
interface ChatSpeechStopCommand {
    action: 'stop';
    messageId: string;
}

/**
 * Callback used to publish speech state changes to the chat webview.
 */
export type ChatSpeechStateSink = (state: ChatSpeechState) => void;

/**
 * Callback used to publish transferable audio to the local webview.
 */
export type ChatSpeechAudioSink = (
    command: ChatSpeechAudioCommand
) => void;
