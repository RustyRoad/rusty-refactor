import { selectDirectory } from './directory-navigation';

/**
 * Creates one breadcrumb navigation button.
 *
 * The target path is captured at creation time to avoid closure bugs as the
 * breadcrumb loop continues building deeper segments.
 */
export function createBreadcrumbButton(
    label: string,
    targetPath: string,
): HTMLElement {
    const itemEl = document.createElement('button');
    itemEl.className = 'breadcrumb-item';
    itemEl.type = 'button';
    itemEl.textContent = label;
    itemEl.addEventListener('click', () => selectDirectory(targetPath));
    return itemEl;
}
