import * as vscode from 'vscode';

import { ChatControlMarkup } from './chatControlMarkup';
import { ChatScriptAssets } from './chatScriptAssets';
import { ChatSuggestionMarkup } from './chatSuggestionMarkup';

/**
 * Builds the complete HTML document for the Codetether chat webview.
 */
export class ChatWebviewHtml {
    /**
     * Creates the webview renderer with focused markup collaborators.
     */
    public constructor(
        private readonly controls = new ChatControlMarkup(),
        private readonly scripts = new ChatScriptAssets(),
        private readonly suggestions = new ChatSuggestionMarkup()
    ) {}

    /**
     * Creates the webview document with external script and style assets.
     */
    public render(
        webview: vscode.Webview,
        extensionUri: vscode.Uri,
    ): string {
        const styleUri = this.assetUri(
            webview,
            extensionUri,
            ['media', 'chat-sidebar.css'],
        );
        const scriptUris = this.scripts.paths().map((path) => {
            return this.assetUri(webview, extensionUri, path);
        });

        return [
            '<!DOCTYPE html>',
            '<html lang="en">',
            '<head>',
            '<meta charset="UTF-8">',
            this.viewportMeta(),
            this.cspMeta(webview),
            '<title>Codetether Chat</title>',
            `<link rel="stylesheet" href="${styleUri}">`,
            '</head>',
            '<body>',
            this.bodyMarkup(),
            this.scriptTags(scriptUris),
            '</body>',
            '</html>',
        ].join('\n');
    }

    /**
     * Returns static chat controls and message containers.
     */
    private bodyMarkup(): string {
        return [
            this.controls.controls(),
            `<div id="chat-container">${this.suggestions.emptyState()}</div>`,
            this.controls.subagentPanel(),
            this.composerMarkup(),
        ].join('\n');
    }

    /**
     * Groups prompt status and input into one cohesive composer surface.
     */
    private composerMarkup(): string {
        return [
            '<section class="composer-shell" aria-label="Chat composer">',
            this.controls.statusBar(),
            this.controls.inputControls(),
            '</section>',
        ].join('\n');
    }

    /**
     * Builds script tags for sidebar behavior assets.
     */
    private scriptTags(scriptUris: vscode.Uri[]): string {
        return scriptUris.map((scriptUri) => {
            return `<script src="${scriptUri}"></script>`;
        }).join('\n');
    }

    /**
     * Returns the webview URI for one extension-relative sidebar asset.
     */
    private assetUri(
        webview: vscode.Webview,
        extensionUri: vscode.Uri,
        path: string[],
    ): vscode.Uri {
        return webview.asWebviewUri(vscode.Uri.joinPath(
            extensionUri,
            ...path,
        ));
    }

    /**
     * Returns viewport metadata as a short source line.
     */
    private viewportMeta(): string {
        return [
            '<meta name="viewport"',
            ' content="width=device-width, initial-scale=1.0">',
        ].join('');
    }

    /**
     * Builds the content security policy meta tag for this webview.
     */
    private cspMeta(webview: vscode.Webview): string {
        const policy = [
            "default-src 'none';",
            `img-src ${webview.cspSource} https: data:;`,
            `style-src ${webview.cspSource};`,
            `script-src ${webview.cspSource};`,
        ].join(' ');

        return [
            '<meta http-equiv="Content-Security-Policy"',
            ` content="${policy}">`,
        ].join('');
    }
}
