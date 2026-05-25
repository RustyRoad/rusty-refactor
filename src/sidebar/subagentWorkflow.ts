/**
 * Describes the sub-agent orchestration contract used by chat prompts.
 */
export class SubagentWorkflow {
    /**
     * Builds the workflow instruction injected into every Codetether request.
     *
     * The instruction keeps the sidebar chat as the supervising conversation
     * while allowing the hosted agent to delegate focused work to sub-agents.
     */
    public instruction(): string {
        return [
            'Sub-agent workflow:',
            'When the request has independent research, review, testing, or',
            'implementation workstreams, try to spawn a focused sub-agent with',
            'the agent tool or use swarm_execute. Keep this chat as the',
            'orchestrator: delegate bounded tasks, collect results, synthesize',
            'the final answer, and run validation from the main chat before',
            'claiming completion. If a requested sub-agent model is rejected,',
            'retry with an allowed free/subscription model or omit the model.',
            'If sub-agent spawning is unavailable, continue in this chat and',
            'report the blocker concisely.'
        ].join(' ');
    }
}
