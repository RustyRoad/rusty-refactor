
import * as vscode from 'vscode';

/**
 * Provides AI-powered documentation and summary generation for Rust code
 * using the VS Code Language Model API.
 */
export class AIDocGenerator {
    /**
     * Generates comprehensive Rust documentation for a given code snippet.
     *
     * This method selects a suitable language model, constructs a detailed prompt
     * based on rustdoc conventions, sends the request to the model, and
     * processes the streamed response.
     *
     * @param code The Rust code to be documented.
     * @param moduleName The name of the module containing the code.
     * @returns A promise that resolves to the documented code as a string, or null if an error occurs.
     */
    async generateDocumentation(code: string, moduleName: string): Promise<string | null> {
        try {
            // Select a fast and cost-effective model for documentation generation.
            const models = await vscode.lm.selectChatModels({
                vendor: 'copilot',
                family: 'gpt-5-mini'
            });

            if (models.length === 0) {
                vscode.window.showWarningMessage('No language models available for documentation generation.');
                return null;
            }

            const model = models[0];

            // Construct a detailed prompt for generating high-quality Rust documentation.
            const messages = [
                vscode.LanguageModelChatMessage.User(
                    `You are an expert in Rust and its documentation conventions (rustdoc).
                    Your task is to generate idiomatic and comprehensive documentation comments for the provided Rust code module.

                    **Rules:**
                    1.  Start with a module-level doc comment (//!) that provides a concise summary of the module's purpose.
                    2.  Add doc comments (///) for all public items: functions, structs, enums, traits, and impl blocks.
                    3.  For functions, include descriptions of parameters using the format: \`param_name\` - description.
                    4.  Include a clear description of the return value.
                    5.  When a function can panic, include a '# Panics' section detailing the conditions that cause a panic.
                    6.  If a function returns a Result, include an '# Errors' section describing the possible error conditions.
                    7.  For \`unsafe\` functions, include a '# Safety' section explaining the invariants the caller must uphold.
                    8.  Provide meaningful code examples in \`\`\`rust code blocks where appropriate to illustrate usage.
                    9.  Keep descriptions informative yet concise.
                    10. Adhere strictly to rustdoc conventions.
                    11. **Crucially, do not modify the actual Rust code.** Only add documentation comments.
                    12. Return the complete, original code with the added documentation comments.
                    13. Maintain the original code's structure and formatting exactly.`
                ),
                vscode.LanguageModelChatMessage.User(
                    `Module name: ${moduleName}\n\nAdd comprehensive documentation to this Rust code:\n\n${code}`
                )
            ];

            // Send the request to the language model and handle the streaming response.
            const response = await model.sendRequest(
                messages,
                {},
                new vscode.CancellationTokenSource().token
            );

            let documentedCode = '';
            for await (const fragment of response.text) {
                documentedCode += fragment;
            }

            // Clean up any markdown formatting from the response.
            return this.cleanMarkdownCodeBlocks(documentedCode);

        } catch (err) {
            if (err instanceof vscode.LanguageModelError) {
                console.error('Language Model Error:', err.message, err.code);
                this.handleLanguageModelError(err);
            } else {
                console.error('Error generating documentation:', err);
                vscode.window.showErrorMessage('An unexpected error occurred while generating documentation.');
            }
            return null;
        }
    }

    /**
     * Generates a concise, single-line summary comment for the extracted code.
     *
     * @param code The Rust code that was extracted.
     * @param moduleName The name of the new module.
     * @param modulePath The path to the new module file.
     * @returns A promise that resolves to a formatted summary comment.
     */
    async generateExtractionSummary(
        code: string,
        moduleName: string,
        modulePath: string
    ): Promise<string> {
        const defaultSummary = `// Code extracted to ${modulePath}\n// Available as: ${moduleName}::*`;

        try {
            // Attempt to use a custom or specified language model for summarization.
            let models = await vscode.lm.selectChatModels({
                vendor: 'CustomOAI',
                family: 'GLM-4.6 (Z.AI Coding)'
            })

            if (models.length === 0) {
                models = await vscode.lm.selectChatModels({
                    vendor: 'copilot',
                    family: 'gpt-5-mini'
                })
            }

            if (models.length === 0) {
                console.warn('No language models available for extraction summary. Using default summary.');
                return defaultSummary;
            }

            const model = models[0];

            const messages = [
                vscode.LanguageModelChatMessage.User(
                    `You are a Rust code summarizer. Your task is to create a brief, single-line comment (max 80 characters)
                    describing the primary responsibility of the extracted code.

                    **Rules:**
                    1.  Start the comment with "// Extracted: ".
                    2.  Be specific and concise (e.g., "database operations", "validation logic", "HTTP handlers").
                    3.  Do not use markdown or code blocks. Return only the comment text.
                    4.  The total length should not exceed 80 characters.`
                ),
                vscode.LanguageModelChatMessage.User(
                    `Summarize what this extracted code does:\n\n${code}`
                )
            ];

            const response = await model.sendRequest(
                messages,
                {},
                new vscode.CancellationTokenSource().token
            );

            let summary = '';
            for await (const fragment of response.text) {
                summary += fragment;
            }

            summary = summary.trim();

            if (!summary.startsWith('//')) {
                summary = `// Extracted: ${summary.replace(/^(Extracted:\s*)?/, '')}`;
            }

            return `${summary}\n// Module: ${modulePath}\n// Use: ${moduleName}::*`;

        } catch (err) {
            console.error('Error generating extraction summary:', err);
            return defaultSummary;
        }
    }

    /**
     * Prompts the user to determine if AI-powered documentation should be generated.
     *
     * This method checks extension settings to see if auto-documentation is enabled
     * or if the user should be prompted each time.
     *
     * @returns A promise that resolves to true if documentation should be generated, otherwise false.
     */
    async shouldGenerateDocumentation(): Promise<boolean> {
        const config = vscode.workspace.getConfiguration('rustyRefactor');
        const autoDoc = config.get<boolean>('aiAutoDocumentation', false);

        if (autoDoc) {
            return true;
        }

        const askEachTime = config.get<boolean>('aiAskEachTime', true);
        if (!askEachTime) {
            return false;
        }

        const response = await vscode.window.showInformationMessage(
            'Generate AI documentation for the extracted module?',
            'Yes',
            'No',
            'Always'
        );

        if (response === 'Always') {
            await config.update('aiAutoDocumentation', true, vscode.ConfigurationTarget.Global);
            return true;
        }

        return response === 'Yes';
    }

    /**
     * Removes markdown code block fences from a string.
     *
     * @param code The string to clean.
     * @returns The cleaned string.
     */
    private cleanMarkdownCodeBlocks(code: string): string {
        let cleaned = code.replace(/```rust\n?/g, '');
        cleaned = cleaned.replace(/```\n?/g, '');
        return cleaned.trim();
    }

    /**
     * Handles specific `LanguageModelError` types with user-friendly notifications.
     *
     * @param err The `LanguageModelError` instance.
     */
    private handleLanguageModelError(err: vscode.LanguageModelError): void {
        switch (err.code) {
            case vscode.LanguageModelError.NotFound.name:
                vscode.window.showWarningMessage(
                    'The selected language model is not available. Documentation generation was skipped.'
                );
                break;
            case vscode.LanguageModelError.NoPermissions.name:
                vscode.window.showWarningMessage(
                    'You do not have permission to use the language model. Please ensure GitHub Copilot is enabled and configured correctly.'
                );
                break;
            case vscode.LanguageModelError.Blocked.name:
                vscode.window.showWarningMessage(
                    'The request was blocked by a content filter. Documentation generation was skipped.'
                );
                break;
            default:
                vscode.window.showErrorMessage(
                    `An error occurred with the language model: ${err.message}`
                );
                break;
        }
    }
}