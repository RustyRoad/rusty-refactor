import {
    CHAT_MODES,
    CODETETHER_FEATURES
} from './chatConstants';
import { featureInstruction } from './chatFeatureInstructions';
import { ChatMode, CodetetherFeature } from './chatTypes';

export { featureInstruction };

/**
 * Returns a supported mode, falling back to normal chat for bad input.
 */
export function normalizeMode(mode?: ChatMode): ChatMode {
    return mode && CHAT_MODES.includes(mode) ? mode : 'chat';
}

/**
 * Returns a supported feature preset, falling back to automatic routing.
 */
export function normalizeFeature(
    feature?: CodetetherFeature
): CodetetherFeature {
    return feature && CODETETHER_FEATURES.includes(feature)
        ? feature
        : 'auto';
}

/**
 * Builds the status label shown while the assistant handles a request.
 */
export function statusForMode(mode: ChatMode): string {
    switch (mode) {
        case 'agent':
            return 'Running Codetether agent with tools…';
        case 'orchestrate':
            return 'Coordinating Codetether sub-agents…';
        case 'plan':
            return 'Asking Codetether to inspect and plan…';
        case 'review':
            return 'Reviewing with Codetether tools…';
        default:
            return 'Thinking…';
    }
}

/**
 * Describes the operating mode so the model uses the right workflow.
 */
export function modeInstruction(mode: ChatMode): string {
    switch (mode) {
        case 'agent':
            return [
                'Mode: Agentic workspace task.',
                'Act as an autonomous coding agent.',
                'Use Codetether tools to inspect the repository, edit files,',
                'run tests/builds, and iterate until the request is complete.'
            ].join(' ');
        case 'orchestrate':
            return [
                'Mode: Sub-agent orchestration.',
                'Lead with focused sub-agents for independent workstreams,',
                'but keep this chat as the supervising conversation.',
                'Delegate bounded tasks, collect their findings, make any',
                'final decisions here, and run final validation from this chat.'
            ].join(' ');
        case 'plan':
            return [
                'Mode: Plan first.',
                'Inspect enough context with tools to produce a grounded',
                'implementation plan.',
                'Prefer not to edit files unless the user explicitly asks you',
                'to continue with implementation.'
            ].join(' ');
        case 'review':
            return [
                'Mode: Code review.',
                'Use search, git diff/status, and file inspection tools to',
                'find concrete issues.',
                'Prioritize correctness, security, regressions, missing tests,',
                'and build risks.'
            ].join(' ');
        default:
            return [
                'Mode: Chat with optional tools.',
                'Answer directly, but use Codetether tools when repository',
                'facts, diagnostics, or file contents are needed.'
            ].join(' ');
    }
}
