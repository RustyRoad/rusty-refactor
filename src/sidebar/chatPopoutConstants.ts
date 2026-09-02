/** Command that opens a new Rusty Refactor chat window. */
export const OPEN_CHAT_WINDOW_COMMAND =
    'rustyRefactor.openChatInNewWindow';

/** Built-in command used to detach the active editor. */
export const MOVE_EDITOR_TO_NEW_WINDOW_COMMAND =
    'workbench.action.moveEditorToNewWindow';

/** View type assigned to detached Rusty Refactor chat panels. */
export const CHAT_POPOUT_VIEW_TYPE = 'rustyRefactor.chatPanel';

/**
 * Identifies an optional persisted session to load in a new chat window.
 */
export interface ChatPopoutRequest {
    /** Session identifier shown by the previous-chat browser. */
    sessionId?: string;

    /** Session storage path supplied by the extension host. */
    sessionPath?: string;
}