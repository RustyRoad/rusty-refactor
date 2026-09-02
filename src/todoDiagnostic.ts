import * as vscode from 'vscode';

import { findTodoMarkers } from './todoMarker';

export const TODO_DIAGNOSTIC_SOURCE = 'Codetether TODO';
export const TODO_DIAGNOSTIC_CODE = 'codetether.todo';

/**
 * Creates Problems-panel diagnostics for every TODO in one document.
 */
export function createTodoDiagnostics(
    document: vscode.TextDocument
): vscode.Diagnostic[] {
    return findTodoMarkers(document).map(marker => {
        return createTodoDiagnostic(document, marker.range);
    });
}

/**
 * Reports whether a diagnostic belongs to the Codetether TODO feature.
 */
export function isTodoDiagnostic(
    diagnostic: vscode.Diagnostic
): boolean {
    return diagnostic.source === TODO_DIAGNOSTIC_SOURCE
        && diagnostic.code === TODO_DIAGNOSTIC_CODE;
}

/**
 * Creates one information diagnostic for a TODO marker.
 */
function createTodoDiagnostic(
    document: vscode.TextDocument,
    range: vscode.Range
): vscode.Diagnostic {
    const diagnostic = new vscode.Diagnostic(
        range,
        todoDiagnosticMessage(document, range),
        vscode.DiagnosticSeverity.Information
    );
    diagnostic.source = TODO_DIAGNOSTIC_SOURCE;
    diagnostic.code = TODO_DIAGNOSTIC_CODE;
    return diagnostic;
}

/**
 * Uses the TODO suffix as its concise Problems-panel description.
 */
function todoDiagnosticMessage(
    document: vscode.TextDocument,
    range: vscode.Range
): string {
    const line = document.lineAt(range.start.line).text;
    const suffix = line
        .slice(range.end.character)
        .replace(/^\s*[:-]?\s*/u, '')
        .trim();

    return suffix
        ? `TODO: ${suffix}`
        : 'TODO requires implementation.';
}
