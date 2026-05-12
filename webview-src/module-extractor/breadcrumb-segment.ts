interface BreadcrumbSegment {
    label: string;
    path: string;
}

/**
 * Calculates labels and target paths for breadcrumb rendering.
 *
 * The root path is represented by an empty string to match the extension
 * protocol for workspace-relative navigation.
 */
export function breadcrumbPaths(
    breadcrumb: string[],
): BreadcrumbSegment[] {
    let pathSoFar = '';
    return [''].concat(breadcrumb).map((item) => {
        pathSoFar = item ? joinPath(pathSoFar, item) : '';
        return { label: item || 'Workspace Root', path: pathSoFar };
    });
}

/**
 * Joins workspace-relative path segments without introducing leading slashes.
 */
function joinPath(prefix: string, item: string): string {
    return prefix ? `${prefix}/${item}` : item;
}
