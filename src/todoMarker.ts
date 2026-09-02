import * as vscode from 'vscode';

const TODO_PATTERN = /\btodo\b/giu;

/**
 * Identifies the editor range occupied by one complete TODO word.
 */
export interface TodoMarker {
    range: vscode.Range;
}

/**
 * Finds every complete TODO word while honoring optional cancellation.
 */
export function findTodoMarkers(
    document: vscode.TextDocument,
    token?: vscode.CancellationToken
): TodoMarker[] {
    const markers: TodoMarker[] = [];

    for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
        if (token?.isCancellationRequested) {
            return markers;
        }

        const line = document.lineAt(lineIndex);
        TODO_PATTERN.lastIndex = 0;

        for (const match of line.text.matchAll(TODO_PATTERN)) {
            const character = match.index ?? 0;
            const start = new vscode.Position(lineIndex, character);
            markers.push({
                range: new vscode.Range(
                    start,
                    start.translate(0, match[0].length)
                )
            });
        }
    }

    return markers;
}

/**
 * Reports whether text is exactly one TODO marker in any casing.
 */
export function isTodoMarkerText(text: string): boolean {
    return /^todo$/iu.test(text);
}
