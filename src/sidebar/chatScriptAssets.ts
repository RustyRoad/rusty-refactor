/**
 * Lists browser scripts required by the Codetether chat sidebar.
 */
export class ChatScriptAssets {
    /**
     * Returns script file names in dependency order.
     */
    public names(): string[] {
        return [
            'chat-sidebar-state.generated.js',
            'chat-sidebar-core.js',
            'chat-sidebar-tts-text.js',
            'chat-sidebar-tts.js',
            'chat-sidebar-voice-input.js',
            'chat-sidebar-messages.js',
            'chat-sidebar-subagents.js',
            'chat-sidebar-models.js',
            'chat-sidebar-sessions.js',
            'chat-sidebar-events.js',
            'chat-sidebar-host.js',
            'chat-sidebar.js',
        ];
    }
}
