import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Resolves response paths without allowing access outside open workspaces.
 */
export class WorkspaceFileResolver {
    /**
     * Finds the first regular workspace file matching an assistant path.
     *
     * Leading slashes are also treated as repository-root notation because
     * agents commonly describe paths as `/api/src/file.ts`.
     */
    public async resolve(filePath: string): Promise<vscode.Uri | undefined> {
        for (const candidate of this.candidates(filePath)) {
            if (await this.isFile(candidate)) {
                return candidate;
            }
        }
        return undefined;
    }

    /**
     * Creates safe URI candidates for absolute and repository-relative paths.
     */
    private candidates(filePath: string): vscode.Uri[] {
        const folders = vscode.workspace.workspaceFolders || [];
        const normalized = filePath.replace(/\\/g, '/');
        const relative = normalized
            .replace(/^[A-Za-z]:\//, '')
            .replace(/^\/+/, '');
        const candidates: vscode.Uri[] = [];

        for (const folder of folders) {
            const absolute = vscode.Uri.file(normalized);
            if (this.isInsideFolder(absolute, folder.uri)) {
                this.appendDistinct(candidates, absolute);
            }

            const workspaceRelative = vscode.Uri.joinPath(
                folder.uri,
                relative
            );
            if (this.isInsideFolder(workspaceRelative, folder.uri)) {
                this.appendDistinct(candidates, workspaceRelative);
            }
        }
        return candidates;
    }

    /**
     * Adds a URI unless an equivalent filesystem path is already present.
     */
    private appendDistinct(candidates: vscode.Uri[], uri: vscode.Uri): void {
        const duplicate = candidates.some(candidate => {
            return candidate.fsPath === uri.fsPath;
        });
        if (!duplicate) {
            candidates.push(uri);
        }
    }

    /**
     * Checks that one URI remains inside the supplied workspace folder.
     */
    private isInsideFolder(uri: vscode.Uri, folder: vscode.Uri): boolean {
        const relative = path.relative(folder.fsPath, uri.fsPath);
        return relative === ''
            || (!relative.startsWith('..') && !path.isAbsolute(relative));
    }

    /**
     * Checks whether a URI resolves to a regular workspace file.
     */
    private async isFile(uri: vscode.Uri): Promise<boolean> {
        try {
            const stat = await vscode.workspace.fs.stat(uri);
            return Boolean(stat.type & vscode.FileType.File);
        } catch {
            return false;
        }
    }
}