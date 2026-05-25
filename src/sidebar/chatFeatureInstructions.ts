import { CodetetherFeature } from './chatTypes';

const FEATURE_INSTRUCTIONS: Record<CodetetherFeature, string[]> = {
    auto: [
        'Codetether feature preset: Auto.',
        'Choose the appropriate native tools for the task without',
        'waiting for user permission unless destructive or ambiguous.'
    ],
    code: [
        'Codetether feature preset: Code editing.',
        'Prefer file inspection plus edit/multiedit/patch tools.',
        'After edits, run the smallest useful typecheck/build/test.'
    ],
    debug: [
        'Codetether feature preset: Debug.',
        'Use diagnostics, logs, grep/search, file inspection, and',
        'targeted shell commands.',
        'Reproduce or identify the failing path before proposing fixes.'
    ],
    refactor: [
        'Codetether feature preset: Refactor.',
        'Use symbol/search/LSP tools to understand dependencies, make',
        'behavior-preserving edits, and validate compilation/tests.'
    ],
    search: [
        'Codetether feature preset: Repository search.',
        'Use grep/codesearch/search/glob/tree/read tools aggressively.',
        'Provide grounded file paths and line references.'
    ],
    test: [
        'Codetether feature preset: Tests/build.',
        'Use bash to run relevant tests/builds, inspect failures, edit',
        'if requested, and rerun validation.'
    ],
    git: [
        'Codetether feature preset: Git review.',
        'Use git status/diff/log plus file inspection.',
        'Focus on regressions, correctness, security, packaging risks,',
        'and missing validation.'
    ],
    browser: [
        'Codetether feature preset: Browser/app automation.',
        'Use browserctl when a UI or web app needs inspection,',
        'screenshots, DOM checks, network logs, or replayed requests.'
    ],
    swarm: [
        'Codetether feature preset: Swarm/subagents.',
        'Try focused sub-agents or swarm_execute for independent work,',
        'then synthesize results and validation evidence in this chat.'
    ],
    prd: [
        'Codetether feature preset: Autonomous PRD/Ralph/go.',
        'For larger feature work, create/validate a PRD or use',
        'Ralph/go-style autonomous execution when appropriate, with',
        'clear checkpoints.'
    ]
};

/**
 * Describes the selected feature so the model favors relevant tools.
 */
export function featureInstruction(feature: CodetetherFeature): string {
    return (FEATURE_INSTRUCTIONS[feature] ?? FEATURE_INSTRUCTIONS.auto)
        .join(' ');
}
