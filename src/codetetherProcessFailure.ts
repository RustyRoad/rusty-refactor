/**
 * Summarizes Codetether child-process output for user-facing failures.
 */

/**
 * Returns a compact failure detail from process output streams.
 *
 * Codetether may echo the full prompt after a "Running with message" log line.
 * That echo can be much longer than the actual failure and should not replace
 * useful error lines in the sidebar. Streams are filtered independently so a
 * prompt echo on stderr never hides structured stdout from the same process.
 */
export function summarizeCodetetherProcessFailure(
    primary: string,
    secondary = ''
): string {
    const lines = [
        ...failureLinesFromStream(primary),
        ...failureLinesFromStream(secondary)
    ];
    const errorLines = lines.filter(isErrorLikeLine);
    const selected = errorLines.length > 0 ? errorLines : lines;

    return selected.slice(-6).join(' | ');
}

/**
 * Extracts non-log, non-prompt lines from one process output stream.
 */
function failureLinesFromStream(output: string): string[] {
    const lines: string[] = [];
    let skippingPromptEcho = false;

    for (const rawLine of output.split(/\r?\n/)) {
        const line = normalizeOutputLine(rawLine);

        if (!line) {
            continue;
        }

        if (line.includes('Running with message:')) {
            skippingPromptEcho = true;
            continue;
        }

        if (isTimestampedProcessLine(line)) {
            skippingPromptEcho = false;
        }

        if (skippingPromptEcho || isNonErrorLogLine(line)) {
            continue;
        }

        lines.push(line);
    }

    return lines;
}

/**
 * Normalizes a raw process output line for comparison and display.
 */
function normalizeOutputLine(line: string): string {
    return stripAnsi(line).replace(/\r/g, '').trim();
}

/**
 * Detects timestamped tracing lines produced by Codetether dependencies.
 */
function isTimestampedProcessLine(line: string): boolean {
    return /^\d{4}-\d{2}-\d{2}T/.test(line)
        || /^[\w.-]+(?:\/[\w.-]+)*:\s+\d{4}-\d{2}-\d{2}T/.test(line);
}

/**
 * Detects tracing lines that do not carry the underlying failure.
 */
function isNonErrorLogLine(line: string): boolean {
    const hasNonErrorLevel = /\b(INFO|WARN|DEBUG|TRACE)\b/.test(line);

    return isTimestampedProcessLine(line) && hasNonErrorLevel;
}

/**
 * Detects lines that are more likely to describe the actual failure.
 */
function isErrorLikeLine(line: string): boolean {
    return /\b(ERROR|error|failed|failure|panic|exception)\b/.test(line);
}

/**
 * Removes ANSI color and style escape sequences from process output.
 */
function stripAnsi(value: string): string {
    return value.replace(/\u001b\[[0-9;]*m/g, '');
}
