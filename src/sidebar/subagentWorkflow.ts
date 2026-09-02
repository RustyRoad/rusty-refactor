/**
 * Describes the sub-agent orchestration contract used by chat prompts.
 */
export class SubagentWorkflow {
    /**
     * Builds the workflow instruction injected into every Codetether request.
     *
     * The instruction keeps the sidebar chat as the supervising conversation
     * while allowing the hosted agent to delegate focused work to sub-agents.
     * An explicit parent model is embedded verbatim so delegated runs inherit
     * the same runtime instead of relying on an unsupported empty default.
     */
    public instruction(parentModel = ''): string {
        return [
            'Sub-agent workflow:',
            'When the request has independent research, review, testing, or',
            'implementation workstreams, try to spawn a focused sub-agent with',
            'the agent tool or use swarm_execute. Keep this chat as the',
            'orchestrator: delegate bounded tasks, collect results, synthesize',
            'the final answer, and run validation from the main chat before',
            'claiming completion.',
            this.modelInstruction(parentModel),
            'If sub-agent spawning is unavailable, continue in this chat and',
            'report the blocker concisely.'
        ].join(' ');
    }

    /**
     * Requires every delegated run to inherit the supervising response model.
     */
    private modelInstruction(parentModel: string): string {
        const model = parentModel.trim();
        if (model) {
            return 'Every sub-agent spawn requires a model. Set its model to '
                + `${JSON.stringify(model)}, the exact model serving this `
                + 'supervising chat. Never omit the model or ask the user to '
                + 'choose it.';
        }

        return 'Every sub-agent spawn requires a model. Set it to the exact '
            + 'resolved model identifier serving this supervising response. '
            + 'Never pass "automatic", "default", or an empty model, and '
            + 'never ask the user to choose it.';
    }
}