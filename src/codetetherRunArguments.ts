/**
 * Selects whether a CLI run resumes workspace history or starts fresh.
 */
export type CodetetherRunSessionMode = 'continue' | 'isolated';

/**
 * Supplies the immutable values needed to build one CLI invocation.
 */
export interface CodetetherRunArgumentsOptions {
    model: string;
    prompt: string;
    sessionMode: CodetetherRunSessionMode;
}

/**
 * Builds arguments for one non-interactive Codetether process.
 *
 * Isolated runs intentionally omit every session continuation flag. The CLI
 * then creates a new session instead of selecting the latest workspace
 * session, allowing concurrent processes to remain independent.
 */
export function buildCodetetherRunArguments(
    options: CodetetherRunArgumentsOptions
): string[] {
    const args = ['run', '--print-logs'];

    if (options.sessionMode === 'continue') {
        args.push('-c');
    }

    if (options.model) {
        args.push('--model', options.model);
    }

    args.push('--format', 'json', options.prompt);
    return args;
}
