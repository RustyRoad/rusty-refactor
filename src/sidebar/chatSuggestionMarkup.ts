import { ChatSuggestionPrompts } from './chatSuggestionPrompts';

/**
 * Builds empty-state suggestion markup for the chat sidebar.
 */
export class ChatSuggestionMarkup {
    /**
     * Creates a suggestion renderer with prompt text dependencies.
     */
    public constructor(
        private readonly prompts = new ChatSuggestionPrompts()
    ) {}

    /**
     * Returns the empty-state markup shown before any messages exist.
     */
    public emptyState(): string {
        return [
            '<div class="empty-state" id="empty-state">',
            '<div class="empty-title">',
            'Ask Codetether about your workspace.',
            '</div>',
            'Ask a question, or choose a preset below.',
            '<div class="quick-grid">',
            this.explainSuggestion(),
            this.agentFixSuggestion(),
            this.reviewSuggestion(),
            this.subagentSuggestion(),
            this.findSuggestion(),
            '</div>',
            '</div>',
        ].join('\n');
    }

    /**
     * Creates the explanation suggestion button markup.
     */
    private explainSuggestion(): string {
        return this.suggestion(
            'Explain current module',
            this.prompts.explainPrompt(),
        );
    }

    /**
     * Creates the agent-fix suggestion button markup.
     */
    private agentFixSuggestion(): string {
        return this.suggestion(
            'Agent fix',
            this.prompts.agentFixPrompt(),
            'agent',
            'code',
        );
    }

    /**
     * Creates the review suggestion button markup.
     */
    private reviewSuggestion(): string {
        return this.suggestion(
            'Review changes',
            this.prompts.reviewPrompt(),
            'review',
            'git',
        );
    }

    /**
     * Creates the sub-agent workflow suggestion button markup.
     */
    private subagentSuggestion(): string {
        return this.suggestion(
            'Sub-agent workflow',
            this.prompts.subagentPrompt(),
            'orchestrate',
            'swarm',
        );
    }

    /**
     * Creates the implementation-search suggestion button markup.
     */
    private findSuggestion(): string {
        return this.suggestion(
            'Find code',
            this.prompts.findPrompt(),
            'agent',
            'search',
        );
    }

    /**
     * Creates a quick-prompt button with optional mode and feature values.
     */
    private suggestion(
        label: string,
        prompt: string,
        mode = '',
        feature = '',
    ): string {
        const modeAttr = mode ? ` data-mode="${mode}"` : '';
        const featureAttr = feature ? ` data-feature="${feature}"` : '';

        return [
            `<button class="suggestion"${modeAttr}${featureAttr}`,
            ` data-prompt="${prompt}">${label}</button>`,
        ].join('');
    }
}