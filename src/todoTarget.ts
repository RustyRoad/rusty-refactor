import * as vscode from 'vscode';

import { isTodoMarkerText } from './todoMarker';

/**
 * Identifies one current TODO marker for a scoped implementation request.
 */
export interface TodoTarget {
    relativePath: string;
    lineNumber: number;
    columnNumber: number;
    sourceLine: string;
}

/**
 * Reads one current TODO target from its open editor document.
 */
export function readTodoTarget(
    document: vscode.TextDocument,
    range: vscode.Range
): TodoTarget | undefined {
    if (!isTodoMarkerText(document.getText(range))) {
        return undefined;
    }

    return {
        relativePath: vscode.workspace.asRelativePath(
            document.uri,
            false
        ),
        lineNumber: range.start.line + 1,
        columnNumber: range.start.character + 1,
        sourceLine: document.lineAt(range.start.line).text.trim()
    };
}
