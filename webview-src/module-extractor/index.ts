// @ts-ignore
import './styles.css';

import { initialize } from './initialize';
import { handleExtensionMessage } from './message-router';

window.addEventListener('message', handleExtensionMessage);

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}
