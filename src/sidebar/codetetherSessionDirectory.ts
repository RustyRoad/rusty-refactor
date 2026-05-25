import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Reads filesystem details for persisted Codetether session directories.
 */
export class CodetetherSessionDirectory {
    /**
     * Reads a directory and returns an empty list when it is absent.
     */
    public async safeReadDirectory(
        directory: string
    ): Promise<fsSync.Dirent[]> {
        try {
            return await fs.readdir(directory, { withFileTypes: true });
        } catch {
            return [];
        }
    }

    /**
     * Returns sorted turn file names for a session directory.
     */
    public async turnFiles(sessionPath: string): Promise<string[]> {
        const entries = await this.safeReadDirectory(sessionPath);

        return entries
            .filter(entry => entry.isFile())
            .map(entry => entry.name)
            .filter(name => /^turn-\d{4}-.+\.md$/.test(name))
            .sort();
    }

    /**
     * Reads a text file and hides file-system errors from the sidebar.
     */
    public async safeReadFile(filePath: string): Promise<string> {
        try {
            return await fs.readFile(filePath, 'utf8');
        } catch {
            return '';
        }
    }

    /**
     * Builds an absolute path inside a session directory.
     */
    public turnPath(sessionPath: string, turnFile: string): string {
        return path.join(sessionPath, turnFile);
    }
}
