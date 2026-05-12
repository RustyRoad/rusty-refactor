import { createBreadcrumbButton } from './breadcrumb-button';
import { createBreadcrumbSeparator } from './breadcrumb-separator';
import { breadcrumbPaths } from './breadcrumb-segment';
import { element } from './dom';

/**
 * Renders clickable breadcrumb buttons for every path segment.
 *
 * Buttons are used instead of generic divs so keyboard and screen reader users
 * receive native semantics.
 */
export function updateBreadcrumb(breadcrumb: string[]): void {
    const breadcrumbEl = element('breadcrumb');
    breadcrumbEl.replaceChildren();

    breadcrumbPaths(breadcrumb).forEach((segment, index, segments) => {
        breadcrumbEl.appendChild(createBreadcrumbButton(
            segment.label,
            segment.path,
        ));

        if (index < segments.length - 1) {
            breadcrumbEl.appendChild(createBreadcrumbSeparator());
        }
    });
}
