import {
    CHAT_MODES,
    CODETETHER_FEATURES
} from './chatConstants';
import { ChatMode, CodetetherFeature } from './chatTypes';

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

/**
 * Describes the selected feature so the model favors relevant tools.
 */
export function featureInstruction(feature: CodetetherFeature): string {
    switch (feature) {
        case 'code':
            return [
                'Codetether feature preset: Code editing.',
                'Prefer file inspection plus edit/multiedit/patch tools.',
                'After edits, run the smallest useful typecheck/build/test.'
            ].join(' ');
        case 'debug':
            return [
                'Codetether feature preset: Debug.',
                'Use diagnostics, logs, grep/search, file inspection, and',
                'targeted shell commands.',
                'Reproduce or identify the failing path before proposing fixes.'
            ].join(' ');
        case 'refactor':
            return [
                'Codetether feature preset: Refactor.',
                'Use symbol/search/LSP tools to understand dependencies, make',
                'behavior-preserving edits, and validate compilation/tests.'
            ].join(' ');
        case 'search':
            return [
                'Codetether feature preset: Repository search.',
                'Use grep/codesearch/search/glob/tree/read tools aggressively.',
                'Provide grounded file paths and line references.'
            ].join(' ');
        case 'test':
            return [
                'Codetether feature preset: Tests/build.',
                'Use bash to run relevant tests/builds, inspect failures, edit',
                'if requested, and rerun validation.'
            ].join(' ');
        case 'git':
            return [
                'Codetether feature preset: Git review.',
                'Use git status/diff/log plus file inspection.',
                'Focus on regressions, correctness, security, packaging risks,',
                'and missing validation.'
            ].join(' ');
        case 'browser':
            return [
                'Codetether feature preset: Browser/app automation.',
                'Use browserctl when a UI or web app needs inspection,',
                'screenshots, DOM checks, network logs, or replayed requests.'
            ].join(' ');
        case 'swarm':
            return [
                'Codetether feature preset: Swarm/subagents.',
                'For broad independent work, delegate with swarm_execute or',
                'subagents, then synthesize results.'
            ].join(' ');
        case 'prd':
            return [
                'Codetether feature preset: Autonomous PRD/Ralph/go.',
                'For larger feature work, create/validate a PRD or use',
                'Ralph/go-style autonomous execution when appropriate, with',
                'clear checkpoints.'
            ].join(' ');
        default:
            return [
                'Codetether feature preset: Auto.',
                'Choose the appropriate native tools for the task without',
                'waiting for user permission unless destructive or ambiguous.'
            ].join(' ');
    }
}
