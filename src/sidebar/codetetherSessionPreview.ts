import { CodetetherSessionDirectory } from './codetetherSessionDirectory';

/**
 * Extracts compact display previews from persisted session turns.
 */
export class CodetetherSessionPreview {
    /**
     * Creates a preview reader for session turn files.
     */
    public constructor(
        private readonly directory = new CodetetherSessionDirectory()
    ) {}

    /**
     * Extracts a short preview from the first user-authored turn.
     */
    public async fromFirstUserTurn(
        sessionPath: string,
        turnFiles: string[]
    ): Promise<string> {
        const userTurn = turnFiles.find(name => name.endsWith('-user.md'));
        if (!userTurn) {
            return 'Codetether session';
        }

        const userTurnPath = this.directory.turnPath(sessionPath, userTurn);
        const content = await this.directory.safeReadFile(userTurnPath);
        return this.truncatePreview(content);
    }

    /**
     * Normalizes and limits preview text for compact sidebar display.
     */
    private truncatePreview(content: string): string {
        const normalized = content.replace(/\s+/g, ' ').trim();
        if (!normalized) {
            return 'Codetether session';
        }

        return normalized.length > 120
            ? `${normalized.slice(0, 117)}...`
            : normalized;
    }
}
