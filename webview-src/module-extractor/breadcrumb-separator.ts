/**
 * Creates the visual separator between breadcrumb segments.
 *
 * The separator is hidden from assistive technology because the breadcrumb
 * buttons already communicate navigation structure.
 */
export function createBreadcrumbSeparator(): HTMLElement {
    const separatorEl = document.createElement('span');
    separatorEl.className = [
        'breadcrumb-separator',
        'codicon',
        'codicon-chevron-right',
    ].join(' ');
    separatorEl.setAttribute('aria-hidden', 'true');
    return separatorEl;
}
