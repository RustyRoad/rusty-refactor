import { appState } from './app-state';
import { element } from './dom';

/**
 * Shows or hides the module conversion warning.
 *
 * Class-based visibility keeps presentation in CSS and avoids inline style
 * mutations that would require broader CSP allowances.
 */
export function updateConversionInfo(): void {
    element('conversion-info').classList.toggle(
        'hidden',
        !appState.selectedNeedsConversion,
    );
}
