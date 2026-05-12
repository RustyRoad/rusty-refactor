/**
 * Resolves an element by ID or throws with a useful diagnostic message.
 *
 * Failing fast avoids repeated null checks and surfaces template/source drift
 * immediately in the extension output channel.
 */
export function element<T extends HTMLElement = HTMLElement>(id: string): T {
    const value = document.getElementById(id);
    if (!value) {
        throw new Error(`Missing required DOM element: ${id}`);
    }

    return value as T;
}

/**
 * Verifies that all required element IDs exist in the HTML shell.
 *
 * The function has no side effects beyond throwing, which keeps startup
 * failures deterministic and easy to diagnose.
 */
export function requireElements(ids: readonly string[]): void {
    const missing = ids.filter((id) => !document.getElementById(id));
    if (missing.length > 0) {
        throw new Error(`Missing DOM elements: ${missing.join(', ')}`);
    }
}
