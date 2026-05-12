import * as vscode from 'vscode';
import { CodetetherClient } from './codetetherClient';
import { logToOutput } from './extractor';

function logFixStatus(scope: 'Fix' | 'Fix All', relativePath: string, message: string): void {
    logToOutput(`[Codetether ${scope}] ${relativePath} - ${message}`);
}

function diagnosticSeverityLabel(severity?: vscode.DiagnosticSeverity): string {
    switch (severity) {
        case vscode.DiagnosticSeverity.Error:
            return 'error';
        case vscode.DiagnosticSeverity.Warning:
            return 'warning';
        case vscode.DiagnosticSeverity.Information:
            return 'information';
        case vscode.DiagnosticSeverity.Hint:
            return 'hint';
        default:
            return 'unknown';
    }
}

function formatDiagnostic(diagnostic: vscode.Diagnostic, index?: number): string {
    const prefix = index === undefined ? '' : `${index + 1}. `;
    const code = typeof diagnostic.code === 'object'
        ? diagnostic.code.value
        : diagnostic.code;

    return [
        `${prefix}${diagnosticSeverityLabel(diagnostic.severity).toUpperCase()}: ${diagnostic.message}`,
        `   Range: line ${diagnostic.range.start.line + 1}, column ${diagnostic.range.start.character + 1} to line ${diagnostic.range.end.line + 1}, column ${diagnostic.range.end.character + 1}`,
        diagnostic.source ? `   Source: ${diagnostic.source}` : '',
        code ? `   Code: ${String(code)}` : ''
    ].filter(Boolean).join('\n');
}

function buildSingleFixPrompt(relativePath: string, diagnostic: vscode.Diagnostic): string {
    return [
        `Fix the diagnostic in ${relativePath}.`,
        '',
        'Edit the workspace files directly. Do not return a replacement snippet for the plugin to apply.',
        'Only finish once the relevant diagnostics are resolved and any follow-up issues caused by your edits have also been handled.',
        '',
        'Target diagnostic:',
        formatDiagnostic(diagnostic),
        '',
        'After the code changes are complete, explain briefly what changed.'
    ].join('\n');
}

function buildFixAllPrompt(relativePath: string, diagnostics: readonly vscode.Diagnostic[]): string {
    return [
        `Fix the diagnostics in ${relativePath}.`,
        '',
        'Edit the workspace files directly. Do not return a replacement snippet for the plugin to apply.',
        'Only finish once the file is in a valid state or the task must fail.',
        '',
        'Diagnostics to address:',
        diagnostics.map((diagnostic, index) => formatDiagnostic(diagnostic, index)).join('\n\n'),
        '',
        'After the code changes are complete, explain briefly what changed.'
    ].join('\n');
}

async function ensureDocumentSaved(document: vscode.TextDocument): Promise<void> {
    if (!document.isDirty) {
        return;
    }

    const saved = await document.save();
    if (!saved) {
        throw new Error('Save the file before asking Codetether to edit it.');
    }
}

async function waitForDocumentUpdate(uri: vscode.Uri, previousText: string, timeoutMs = 3000): Promise<vscode.TextDocument> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const document = await vscode.workspace.openTextDocument(uri);
        if (document.getText() !== previousText) {
            return document;
        }

        await new Promise(resolve => setTimeout(resolve, 250));
    }

    return vscode.workspace.openTextDocument(uri);
}

function summarizeForNotification(summary: string): string {
    const normalized = summary.replace(/\s+/g, ' ').trim();
    if (normalized.length <= 160) {
        return normalized;
    }

    return `${normalized.slice(0, 157)}...`;
}

function getDiagnosticCodeValue(diagnostic: vscode.Diagnostic): string {
    const code = typeof diagnostic.code === 'object'
        ? diagnostic.code.value
        : diagnostic.code;
    return code ? String(code) : '';
}

function diagnosticsFingerprint(diagnostics: readonly vscode.Diagnostic[]): string {
    return diagnostics
        .map(diagnostic => [
            diagnostic.severity ?? 'unknown',
            diagnostic.message,
            diagnostic.source ?? '',
            getDiagnosticCodeValue(diagnostic),
            diagnostic.range.start.line,
            diagnostic.range.start.character,
            diagnostic.range.end.line,
            diagnostic.range.end.character
        ].join('|'))
        .sort()
        .join('\n');
}

async function waitForDiagnosticsToSettle(
    uri: vscode.Uri,
    timeoutMs?: number,
    pollIntervalMs?: number
): Promise<void> {
    const config = vscode.workspace.getConfiguration('rustyRefactor');
    const timeout = Math.max(1000, timeoutMs ?? config.get<number>('rustAnalyzerValidationTimeoutMs', 5000));
    const pollMs = Math.max(100, pollIntervalMs ?? config.get<number>('rustAnalyzerValidationPollIntervalMs', 200));
    const settleWindowMs = Math.max(250, Math.min(750, pollMs * 2));
    const start = Date.now();
    let lastFingerprint = diagnosticsFingerprint(vscode.languages.getDiagnostics(uri));
    let lastChangeAt = start;

    return new Promise<void>((resolve) => {
        let completed = false;

        const finish = (intervalTimer: NodeJS.Timeout, diagnosticsListener: vscode.Disposable, finalTimer: NodeJS.Timeout) => {
            if (completed) {
                return;
            }
            completed = true;
            clearInterval(intervalTimer);
            clearTimeout(finalTimer);
            diagnosticsListener.dispose();
            resolve();
        };

        const observe = () => {
            const currentFingerprint = diagnosticsFingerprint(vscode.languages.getDiagnostics(uri));
            if (currentFingerprint !== lastFingerprint) {
                lastFingerprint = currentFingerprint;
                lastChangeAt = Date.now();
            }
        };

        const diagnosticsListener = vscode.languages.onDidChangeDiagnostics((event) => {
            if (event.uris.some(changedUri => changedUri.toString() === uri.toString())) {
                observe();
            }
        });

        const intervalTimer = setInterval(() => {
            observe();

            if (Date.now() - lastChangeAt >= settleWindowMs) {
                finish(intervalTimer, diagnosticsListener, finalTimer);
                return;
            }

            if (Date.now() - start >= timeout) {
                finish(intervalTimer, diagnosticsListener, finalTimer);
            }
        }, pollMs);

        const finalTimer = setTimeout(() => {
            finish(intervalTimer, diagnosticsListener, finalTimer);
        }, timeout);
    });
}

function matchesDiagnosticTemplate(candidate: vscode.Diagnostic, template: vscode.Diagnostic): boolean {
    return candidate.severity === template.severity
        && candidate.message === template.message
        && (candidate.source ?? '') === (template.source ?? '')
        && getDiagnosticCodeValue(candidate) === getDiagnosticCodeValue(template);
}

function countMatchingDiagnostics(
    diagnostics: readonly vscode.Diagnostic[],
    template: vscode.Diagnostic
): number {
    return diagnostics.filter(diagnostic => matchesDiagnosticTemplate(diagnostic, template)).length;
}

function summarizeDiagnostics(diagnostics: readonly vscode.Diagnostic[]): string {
    const errors = diagnostics.filter(diagnostic => diagnostic.severity === vscode.DiagnosticSeverity.Error).length;
    const warnings = diagnostics.filter(diagnostic => diagnostic.severity === vscode.DiagnosticSeverity.Warning).length;
    const info = diagnostics.filter(diagnostic => diagnostic.severity === vscode.DiagnosticSeverity.Information).length;
    const hints = diagnostics.filter(diagnostic => diagnostic.severity === vscode.DiagnosticSeverity.Hint).length;

    return `total=${diagnostics.length}, errors=${errors}, warnings=${warnings}, info=${info}, hints=${hints}`;
}

interface CodetetherTaskResult {
    summary: string;
    changed: boolean;
    diagnosticsBefore: readonly vscode.Diagnostic[];
    diagnosticsAfter: readonly vscode.Diagnostic[];
}

async function runCodetetherTask(
    uri: vscode.Uri,
    prompt: string,
    scope: 'Fix' | 'Fix All',
    progress?: vscode.Progress<{ message?: string; increment?: number }>
): Promise<CodetetherTaskResult> {
    const document = await vscode.workspace.openTextDocument(uri);
    const relativePath = vscode.workspace.asRelativePath(uri, false);

    logFixStatus(scope, relativePath, 'Opening document for workspace task.');
    progress?.report({ message: `Preparing ${relativePath}...` });

    const wasDirty = document.isDirty;
    await ensureDocumentSaved(document);
    const beforeText = document.getText();
    const diagnosticsBefore = vscode.languages.getDiagnostics(uri);
    logFixStatus(scope, relativePath, wasDirty ? 'Saved dirty document before dispatch.' : 'Document already saved.');
    logFixStatus(scope, relativePath, `Diagnostics before task: ${summarizeDiagnostics(diagnosticsBefore)}.`);

    const client = new CodetetherClient();
    progress?.report({ message: 'Sending task to Codetether...' });
    logFixStatus(scope, relativePath, `Dispatching task to Codetether (${prompt.length} chars).`);
    const response = await client.chatCompletion(
        [
            {
                role: 'system',
                content: 'You are a workspace-editing coding agent. Make the requested code changes in the workspace, let validation complete, and then summarize what changed.'
            },
            { role: 'user', content: prompt }
        ],
        { filePaths: [uri.fsPath], transport: 'serve' }
    );

    progress?.report({ message: 'Waiting for file updates...' });
    logFixStatus(scope, relativePath, 'Task returned completed; waiting for VS Code to observe file changes.');
    const updatedDocument = await waitForDocumentUpdate(uri, beforeText);
    progress?.report({ message: 'Waiting for diagnostics...' });
    await waitForDiagnosticsToSettle(uri);

    const changed = updatedDocument.getText() !== beforeText;
    const summary = (response.text || '').trim();
    const diagnosticsAfter = vscode.languages.getDiagnostics(uri);

    logFixStatus(scope, relativePath, `Completed task. Changed=${changed}.`);
    logFixStatus(scope, relativePath, `Diagnostics after task: ${summarizeDiagnostics(diagnosticsAfter)}.`);
    if (summary) {
        logFixStatus(scope, relativePath, `Summary: ${summary}`);
    }

    return { summary, changed, diagnosticsBefore, diagnosticsAfter };
}

/**
 * Provides a "Fix with Codetether" Quick Fix for diagnostics (errors/warnings)
 */
export class CodetetherCodeActionProvider implements vscode.CodeActionProvider {
    static readonly providedCodeActionKinds = [
        vscode.CodeActionKind.QuickFix
    ];

    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<(vscode.Command | vscode.CodeAction)[]> {
        const config = vscode.workspace.getConfiguration('rustyRefactor');
        if (!config.get<boolean>('useCodetether')) {
            return [];
        }

        if (context.diagnostics.length === 0) {
            return [];
        }

        const fixActions: vscode.CodeAction[] = [];
        const diagnostic = context.diagnostics[0];

        if (context.diagnostics.length > 1) {
            const fixAllAction = new vscode.CodeAction(
                `Fix All ${context.diagnostics.length} Errors with Codetether`,
                vscode.CodeActionKind.QuickFix
            );
            fixAllAction.command = {
                command: 'rustyRefactor.fixAllWithCodetether',
                title: 'Fix All with Codetether',
                arguments: [document.uri, context.diagnostics, range]
            };
            fixActions.push(fixAllAction);
        }

        const action = new vscode.CodeAction(
            `Fix Error with Codetether: "${diagnostic.message.substring(0, 50)}${diagnostic.message.length > 50 ? '...' : ''}"`,
            vscode.CodeActionKind.QuickFix
        );

        action.isPreferred = true;
        action.command = {
            command: 'rustyRefactor.fixWithCodetether',
            title: 'Fix with Codetether',
            arguments: [document.uri, diagnostic, range]
        };

        fixActions.push(action);
        return fixActions;
    }
}

/**
 * Handle the "Fix with Codetether" command
 */
export async function handleFixWithCodetether(
    uri: vscode.Uri,
    diagnostic: vscode.Diagnostic,
    _range: vscode.Range,
    autoApply = false
): Promise<boolean> {
    const relativePath = vscode.workspace.asRelativePath(uri, false);
    const prompt = buildSingleFixPrompt(relativePath, diagnostic);
    logFixStatus(
        'Fix',
        relativePath,
        `Received request for ${diagnosticSeverityLabel(diagnostic.severity)} diagnostic at ${diagnostic.range.start.line + 1}:${diagnostic.range.start.character + 1} - ${diagnostic.message}`
    );

    if (!autoApply) {
        logFixStatus('Fix', relativePath, 'Awaiting user confirmation before editing the workspace.');
        const choice = await vscode.window.showInformationMessage(
            `Codetether will edit ${relativePath} directly and wait for validation before finishing.`,
            { modal: true },
            'Run',
            'Cancel'
        );
        logFixStatus('Fix', relativePath, `Confirmation result: ${choice ?? '<dismissed>'}`);

        if (choice !== 'Run') {
            logFixStatus(
                'Fix',
                relativePath,
                choice === 'Cancel'
                    ? 'User cancelled before task dispatch.'
                    : 'Confirmation prompt dismissed before task dispatch.'
            );
            return false;
        }

        logFixStatus('Fix', relativePath, 'User approved task dispatch.');
    } else {
        logFixStatus('Fix', relativePath, 'Auto-apply mode enabled; skipping confirmation prompt.');
    }

    const result = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Codetether is fixing the diagnostic...',
            cancellable: false
        },
        async (progress) => {
            try {
                return await runCodetetherTask(uri, prompt, 'Fix', progress);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logFixStatus('Fix', relativePath, `Task failed: ${message}`);
                vscode.window.showErrorMessage(`Codetether fix failed: ${message}`);
                return null;
            }
        }
    );

    if (!result) {
        return false;
    }

    const remainingMatches = countMatchingDiagnostics(result.diagnosticsAfter, diagnostic);
    const resolved = remainingMatches === 0;

    logFixStatus('Fix', relativePath, `Target diagnostic resolved=${resolved}. Remaining matches=${remainingMatches}.`);

    if (!resolved) {
        const message = result.changed
            ? 'Codetether changed the file, but the target diagnostic is still present.'
            : 'Codetether completed without resolving the target diagnostic.';
        const summarySuffix = result.summary ? ` ${summarizeForNotification(result.summary)}` : '';
        vscode.window.showWarningMessage(`${message}${summarySuffix ? ` ${summarySuffix}` : ''}`);
        return false;
    }

    if (result.summary) {
        vscode.window.showInformationMessage(`Codetether completed: ${summarizeForNotification(result.summary)}`);
    } else if (result.changed || resolved) {
        vscode.window.showInformationMessage('Codetether fixed the diagnostic.');
    } else {
        vscode.window.showWarningMessage('Codetether completed without changing the file.');
    }

    return true;
}

/**
 * Handle the "Fix All with Codetether" command
 */
export async function handleFixAllWithCodetether(
    uri: vscode.Uri,
    diagnostics: readonly vscode.Diagnostic[],
    _range: vscode.Range,
    autoApply = false
): Promise<void> {
    const relativePath = vscode.workspace.asRelativePath(uri, false);
    const prompt = buildFixAllPrompt(relativePath, diagnostics);
    logFixStatus('Fix All', relativePath, `Received request for ${diagnostics.length} diagnostics.`);

    if (!autoApply) {
        logFixStatus('Fix All', relativePath, 'Awaiting user confirmation before editing the workspace.');
        const choice = await vscode.window.showInformationMessage(
            `Codetether will edit ${relativePath} directly and validate the full task before finishing.`,
            { modal: true },
            'Run',
            'Cancel'
        );
        logFixStatus('Fix All', relativePath, `Confirmation result: ${choice ?? '<dismissed>'}`);

        if (choice !== 'Run') {
            logFixStatus(
                'Fix All',
                relativePath,
                choice === 'Cancel'
                    ? 'User cancelled before task dispatch.'
                    : 'Confirmation prompt dismissed before task dispatch.'
            );
            return;
        }

        logFixStatus('Fix All', relativePath, 'User approved task dispatch.');
    } else {
        logFixStatus('Fix All', relativePath, 'Auto-apply mode enabled; skipping confirmation prompt.');
    }

    const result = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Codetether is fixing ${diagnostics.length} diagnostics...`,
            cancellable: false
        },
        async (progress) => {
            try {
                return await runCodetetherTask(uri, prompt, 'Fix All', progress);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logFixStatus('Fix All', relativePath, `Task failed: ${message}`);
                vscode.window.showErrorMessage(`Codetether fix-all failed: ${message}`);
                return null;
            }
        }
    );

    if (!result) {
        return;
    }

    const unresolvedDiagnostics = diagnostics.filter(diagnostic => countMatchingDiagnostics(result.diagnosticsAfter, diagnostic) > 0);
    const unresolvedCount = unresolvedDiagnostics.length;

    logFixStatus('Fix All', relativePath, `Requested diagnostics unresolved after task: ${unresolvedCount}/${diagnostics.length}.`);

    if (unresolvedCount > 0) {
        const message = result.changed
            ? `Codetether changed the file, but ${unresolvedCount} requested diagnostics are still present.`
            : `Codetether completed without resolving ${unresolvedCount} requested diagnostics.`;
        const summarySuffix = result.summary ? ` ${summarizeForNotification(result.summary)}` : '';
        vscode.window.showWarningMessage(`${message}${summarySuffix ? ` ${summarySuffix}` : ''}`);
        return;
    }

    if (result.summary) {
        vscode.window.showInformationMessage(`Codetether completed: ${summarizeForNotification(result.summary)}`);
    } else if (result.changed || diagnostics.length > 0) {
        vscode.window.showInformationMessage('Codetether fixed the requested diagnostics.');
    } else {
        vscode.window.showWarningMessage('Codetether completed without changing the file.');
    }
}