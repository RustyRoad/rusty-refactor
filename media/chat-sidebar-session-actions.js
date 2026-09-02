const SESSION_SINGLE_CLICK_DELAY_MS = 240;
let sessionContextMenu;
let sessionContextDismissListener;

/**
 * Opens a persisted session in an independent auxiliary chat window.
 *
 * @param {object} session - Session metadata supplied by the host.
 * @param {string} source - Gesture that requested the pop-out.
 * @returns {void}
 */
function openSessionInNewWindow(session, source) {
    closeSessionContextMenu();
    postTelemetry('openSessionInNewWindow', {
        id: session.id,
        source,
    });
    vscode.postMessage({
        type: 'openChatWindow',
        value: {
            id: session.id,
            path: session.path,
        },
    });
}

/**
 * Gives one saved-session row click, double-click, and context actions.
 *
 * A short click delay prevents a double-click from first replacing the
 * transcript in the current chat surface.
 *
 * @param {HTMLButtonElement} button - Saved-session row to configure.
 * @param {object} session - Session represented by the row.
 * @returns {void}
 */
function bindSessionWindowActions(button, session) {
    let clickTimer;
    button.onclick = () => {
        clearTimeout(clickTimer);
        clickTimer = setTimeout(() => {
            openSession(session);
        }, SESSION_SINGLE_CLICK_DELAY_MS);
    };
    button.ondblclick = (event) => {
        event.preventDefault();
        clearTimeout(clickTimer);
        openSessionInNewWindow(session, 'double-click');
    };
    button.oncontextmenu = (event) => {
        showSessionContextMenu(event, session);
    };
}

/**
 * Shows the saved-session context menu at the pointer location.
 *
 * @param {MouseEvent} event - Right-click event from a session row.
 * @param {object} session - Session represented by the row.
 * @returns {void}
 */
function showSessionContextMenu(event, session) {
    event.preventDefault();
    event.stopPropagation();
    closeSessionContextMenu();

    const menu = createSessionContextMenu(session);
    document.body.appendChild(menu);
    positionSessionContextMenu(menu, event.clientX, event.clientY);
    sessionContextMenu = menu;
    sessionContextDismissListener = closeSessionContextMenu;
    document.addEventListener('click', sessionContextDismissListener);
    menu.querySelector('button').focus();
}

/**
 * Creates the accessible menu shown for one persisted session.
 *
 * @param {object} session - Session represented by the menu.
 * @returns {HTMLDivElement} Detached menu ready for positioning.
 */
function createSessionContextMenu(session) {
    const menu = document.createElement('div');
    menu.className = 'session-context-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Session actions');

    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'session-context-menu-item';
    item.setAttribute('role', 'menuitem');
    item.textContent = 'Open in New Window';
    item.onclick = () => {
        openSessionInNewWindow(session, 'context-menu');
    };
    menu.onkeydown = (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeSessionContextMenu();
        }
    };
    menu.appendChild(item);
    return menu;
}

/**
 * Keeps a session context menu inside the visible webview viewport.
 *
 * @param {HTMLDivElement} menu - Attached menu to position.
 * @param {number} pointerX - Pointer x coordinate within the webview.
 * @param {number} pointerY - Pointer y coordinate within the webview.
 * @returns {void}
 */
function positionSessionContextMenu(menu, pointerX, pointerY) {
    const margin = 8;
    const bounds = menu.getBoundingClientRect();
    const left = Math.max(
        margin,
        Math.min(pointerX, window.innerWidth - bounds.width - margin),
    );
    const top = Math.max(
        margin,
        Math.min(pointerY, window.innerHeight - bounds.height - margin),
    );
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
}

/**
 * Removes the current saved-session context menu, when present.
 *
 * @returns {void}
 */
function closeSessionContextMenu() {
    if (sessionContextDismissListener) {
        document.removeEventListener(
            'click',
            sessionContextDismissListener
        );
    }
    sessionContextMenu?.remove();
    sessionContextMenu = undefined;
    sessionContextDismissListener = undefined;
}