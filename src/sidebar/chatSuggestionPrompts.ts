/**
 * Provides quick prompt text for chat sidebar suggestion buttons.
 */
export class ChatSuggestionPrompts {
    /**
     * Provides the quick prompt for explaining the active module.
     */
    public explainPrompt(): string {
        return [
            'Explain the active Rust module and suggest cleanup',
            'opportunities.',
        ].join(' ');
    }

    /**
     * Provides the quick prompt for an agentic code fix.
     */
    public agentFixPrompt(): string {
        return [
            'Use Codetether tools to inspect this repository and implement',
            'the smallest safe fix for the current issue. Validate with',
            'the relevant build or test command.',
        ].join(' ');
    }

    /**
     * Provides the quick prompt for coordinating delegated sub-agent work.
     */
    public subagentPrompt(): string {
        return [
            'Lead with sub-agents while keeping this chat as the main',
            'orchestrator. Spawn focused agents for independent repository',
            'inspection, implementation, or validation tasks, then continue',
            'the conversation here with synthesized results and final',
            'main-chat validation.',
        ].join(' ');
    }

    /**
     * Provides the quick prompt for reviewing current changes.
     */
    public reviewPrompt(): string {
        return [
            'Review the current changes with git diff and file inspection.',
            'Focus on correctness, regressions, and missing validation.',
        ].join(' ');
    }

    /**
     * Provides the quick prompt for finding implementation points.
     */
    public findPrompt(): string {
        return [
            'Search this repository for relevant implementation points and',
            'summarize the exact files/functions involved.',
        ].join(' ');
    }
}
