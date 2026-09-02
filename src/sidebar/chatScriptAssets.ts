/**
 * Lists browser scripts required by the Codetether chat sidebar.
 */
export class ChatScriptAssets {
    /**
     * Returns extension-relative script paths in dependency order.
     */
    public paths(): string[][] {
        const paths = [
            ['out', 'webview', 'chat-sidebar-markdown.js'],
        ];

        for (const name of this.mediaNames()) {
            paths.push(['media', name]);
        }

        return paths;
    }

    /**
     * Lists hand-authored media scripts in their browser dependency order.
     */
    private mediaNames(): string[] {
        return [
            'chat-sidebar-state.generated.js',
            'chat-sidebar-core.js',
            'chat-sidebar-tts-text.js',
            'chat-sidebar-tts-buttons.js',
            'chat-sidebar-tts-audio.js',
            'chat-sidebar-tts-system.js',
            'chat-sidebar-tts-voice.js',
            'chat-sidebar-tts.js',
            'chat-sidebar-tts-stream-chunks.js',
            'chat-sidebar-tts-stream.js',
            'chat-sidebar-voice-input.js',
            'chat-sidebar-workspace-files.js',
            'chat-sidebar-disclosure-state.js',
            'chat-sidebar-message-update.js',
            'chat-sidebar-messages.js',
            'chat-sidebar-session-load.js',
            'chat-sidebar-subagents.js',
            'chat-sidebar-models.js',
            'chat-sidebar-model-options.js',
            'chat-sidebar-session-actions.js',
            'chat-sidebar-sessions.js',
            'chat-sidebar-events.js',
            'chat-sidebar-host.js',
            'chat-sidebar.js',
        ];
    }
}