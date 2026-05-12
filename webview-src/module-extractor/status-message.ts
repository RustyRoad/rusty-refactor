/**
 * Creates a status message block for empty or error states.
 *
 * Text content is used so extension-provided messages cannot inject markup.
 */
export function statusMessage(message: string): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'status-message';
    wrapper.textContent = message;
    return wrapper;
}
