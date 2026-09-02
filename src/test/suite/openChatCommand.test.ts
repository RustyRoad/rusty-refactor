import * as assert from 'assert';
import { readFileSync } from 'fs';

import * as vscode from 'vscode';

import { extensionTestPath } from './extensionTestPath';
import {
    ChatTopControlsMarkup
} from '../../sidebar/chatTopControlsMarkup';
import {
    MOVE_EDITOR_TO_NEW_WINDOW_COMMAND
} from '../../sidebar/chatPopoutConstants';

interface CommandContribution {
    command?: string;
    icon?: unknown;
}

interface MenuContribution {
    command?: string;
    group?: string;
    when?: string;
}

interface ExtensionManifest {
    contributes?: {
        commands?: CommandContribution[];
        menus?: {
            'editor/title'?: MenuContribution[];
            'view/title'?: MenuContribution[];
        };
    };
}

const commandId = 'rustyRefactor.openChat';
const popoutCommandId = 'rustyRefactor.openChatInNewWindow';

/**
 * Reads the extension manifest used by both local and remote installations.
 */
function readManifest(): ExtensionManifest {
    const source = readFileSync(
        extensionTestPath('package.json'),
        'utf8'
    );
    return JSON.parse(source) as ExtensionManifest;
}

/**
 * Verifies the open-chat command is registered in the Extension Host.
 */
async function registersOpenChatCommand(): Promise<void> {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes(commandId));
}

/**
 * Verifies the pop-out command is registered in the Extension Host.
 */
async function registersPopoutCommand(): Promise<void> {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes(popoutCommandId));
}

/**
 * Verifies the active VS Code target supports auxiliary editor windows.
 */
async function supportsAuxiliaryEditorWindows(): Promise<void> {
    const commands = await vscode.commands.getCommands(true);

    assert.ok(
        commands.includes(MOVE_EDITOR_TO_NEW_WINDOW_COMMAND),
        'VS Code does not expose the move-editor-to-new-window command.'
    );
}

/**
 * Verifies the command is an inline icon in the editor title toolbar.
 */
function contributesEditorTitleAction(): void {
    const contributions = readManifest().contributes;
    const command = contributions?.commands?.find(item => {
        return item.command === commandId;
    });
    const menu = contributions?.menus?.['editor/title']?.find(item => {
        return item.command === commandId;
    });

    assert.ok(command?.icon);
    assert.strictEqual(menu?.group, 'navigation@100');
}

/**
 * Verifies the sidebar exposes a native open-in-new-window toolbar action.
 */
function contributesPopoutAction(): void {
    const contributions = readManifest().contributes;
    const command = contributions?.commands?.find(item => {
        return item.command === popoutCommandId;
    });
    const menu = contributions?.menus?.['view/title']?.find(item => {
        return item.command === popoutCommandId;
    });

    assert.strictEqual(command?.icon, '$(open-preview)');
    assert.strictEqual(menu?.group, 'navigation@1');
    assert.strictEqual(
        menu?.when, 'view == rustyRefactor.chatView'
    );
}

/**
 * Verifies the webview toolbar sends the pop-out request to its host.
 */
function exposesWebviewPopoutAction(): void {
    const markup = new ChatTopControlsMarkup().markup();
    const events = readFileSync(
        extensionTestPath('media', 'chat-sidebar-events.js'),
        'utf8'
    );
    const bindings = readFileSync(
        extensionTestPath('media', 'chat-sidebar.js'),
        'utf8'
    );

    assert.ok(markup.includes('id="popout-chat-btn"'));
    assert.ok(markup.includes('aria-label="Open chat in new window"'));
    assert.ok(markup.includes('Open in New Window'));
    assert.ok(events.includes("type: 'openChatWindow'"));
    assert.ok(bindings.includes(
        "byId('popout-chat-btn').onclick = openChatWindow"
    ));
}

/**
 * Registers coverage for the editor-title Rusty Refactor action.
 */
function defineOpenChatCommandTests(): void {
    test('registers the open-chat command', registersOpenChatCommand);
    test('contributes an editor-title icon', contributesEditorTitleAction);
    test('registers the pop-out command', registersPopoutCommand);
    test('contributes a sidebar pop-out action', contributesPopoutAction);
    test('exposes a webview pop-out action', exposesWebviewPopoutAction);
    test(
        'supports auxiliary editor windows',
        supportsAuxiliaryEditorWindows
    );
}

suite('Open Rusty Refactor chat command', defineOpenChatCommandTests);