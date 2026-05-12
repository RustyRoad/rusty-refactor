import { element } from './dom';

/**
 * Displays a loading placeholder while the extension reads directories.
 *
 * DOM nodes are created directly so the webview does not need unsafe inline
 * HTML or broad Content Security Policy permissions.
 */
export function renderLoadingState(): void {
    const treeContent = element('file-tree-content');
    treeContent.replaceChildren();

    const wrapper = document.createElement('div');
    wrapper.className = 'loading';

    const spinner = document.createElement('div');
    spinner.className = 'spinner';

    const label = document.createElement('p');
    label.textContent = 'Loading directories...';

    wrapper.append(spinner, label);
    treeContent.appendChild(wrapper);
}
