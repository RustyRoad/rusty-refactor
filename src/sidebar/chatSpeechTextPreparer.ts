import { spokenMarkdownBlocks } from './chatSpeechMarkdownBlocks';

const STRUCTURED_RESPONSE_NOTICE = [
    'This response contains structured details.',
    'Review them on screen.'
].join(' ');

/**
 * Converts assistant Markdown into concise text intended for speech.
 */
export class ChatSpeechTextPreparer {
    /**
     * Keeps narrative prose while omitting visually structured detail.
     */
    public prepare(markdown: string): string {
        const speech = this.narrative(markdown);
        if (speech) {
            return speech;
        }
        return markdown.trim() ? STRUCTURED_RESPONSE_NOTICE : '';
    }

    /**
     * Prepares a streamed fragment without repeating structure notices.
     */
    public prepareFragment(markdown: string): string {
        return this.narrative(markdown);
    }

    /**
     * Extracts clean narrative prose shared by complete and partial input.
     */
    private narrative(markdown: string): string {
        return spokenMarkdownBlocks(markdown)
            .map(block => this.cleanMarkdown(block))
            .filter(Boolean)
            .join(' ')
            .replace(/\s+/gu, ' ')
            .trim();
    }

    /**
     * Removes visual Markdown syntax without discarding its prose labels.
     */
    private cleanMarkdown(block: string): string {
        return block
            .replace(/!\[[^\]]*\]\([^)]*\)/gu, '')
            .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
            .replace(/<https?:\/\/[^>]+>/gu, '')
            .replace(/https?:\/\/\S+/gu, '')
            .replace(/^\s{0,3}#{1,6}\s+/gmu, '')
            .replace(/<[^>]+>/gu, '')
            .replace(/[`*_~]{1,3}/gu, '')
            .trim();
    }
}
