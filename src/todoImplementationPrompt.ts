import type { TodoTarget } from './todoTarget';

/**
 * Builds the scoped request displayed in the Codetether session.
 */
export function buildTodoImplementationPrompt(
    target: TodoTarget
): string {
    return [
        `Implement the TODO in ${target.relativePath} at line `
            + `${target.lineNumber}, column ${target.columnNumber}.`,
        '',
        'TODO line:',
        target.sourceLine,
        '',
        'Inspect the surrounding code to determine the intended behavior.',
        'Edit the workspace directly and remove the TODO when it is complete.',
        'Preserve existing behavior outside the TODO and run relevant tests.'
    ].join('\n');
}
