/**
 * Workspace file and optional source point detected in an assistant response.
 */
export interface WorkspaceFileReference {
    column?: number;
    line?: number;
    path: string;
}

/**
 * Converts an untrusted webview value into a bounded workspace reference.
 */
export function normalizeWorkspaceFileReference(
    value: unknown
): WorkspaceFileReference | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const record = value as Record<string, unknown>;
    if (typeof record.path !== 'string') {
        return undefined;
    }
    const filePath = record.path.trim();
    if (!filePath || filePath.includes('\0')) {
        return undefined;
    }

    return {
        path: filePath,
        line: positiveInteger(record.line),
        column: positiveInteger(record.column)
    };
}

/**
 * Returns a positive integer from an optional webview source location.
 */
function positiveInteger(value: unknown): number | undefined {
    return typeof value === 'number'
        && Number.isSafeInteger(value)
        && value > 0
        ? value
        : undefined;
}