
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { RustAnalyzerIntegration } from './rustAnalyzerIntegration';
import { logToOutput } from './extractor';
import { log } from 'console';

/**
 * Provides AI-powered documentation generation for Rust code
 * using the built-in VS Code Language Model API (same as VS Code's "Generate Documentation").
 */
export class AIDocGenerator {
    private static hasWarnedAboutMissingLm = false;

    /**
     * Generates comprehensive Rust documentation for a given code snippet.
     *
     * Uses the built-in VS Code LM API (vscode.lm) to generate documentation,
     * mirroring the behavior of VS Code's native "Generate Documentation" command.
     *
     * @param code The Rust code to be documented.
     * @param moduleName The name of the module containing the code.
     * @returns A promise that resolves to the documented code as a string, or null if an error occurs.
     */

    async generateDocumentation(code: string, moduleName: string): Promise<string | null> {
        try {
            if (!this.isLanguageModelApiAvailable()) {
                this.warnLanguageModelUnavailable();
                return null;
            }

            // --- Model Selection (Refactored) ---
            const model = await this.selectDocumentationModel();
            if (!model) {
                vscode.window.showWarningMessage('No language models available for documentation generation.');
                return null;
            }

            logToOutput('Using language model for documentation generation.');
            logToOutput(`Selected model: ${model.name} (${model.vendor})`);

            // Construct prompt using built-in LM API message helpers
            const messages = [
                vscode.LanguageModelChatMessage.User(
                    `You are an expert in Rust and its documentation conventions (rustdoc).
                    Your task is to ENHANCE the existing documentation comments in the provided Rust code module.

                    **Rules:**
                    1.  If there's already a basic module-level doc comment (//!), IMPROVE it with more detail while keeping the same structure.
                    2.  Add doc comments (///) for all public items (functions, structs, enums, traits, impl blocks) that don't already have them.
                    3.  For functions, include descriptions of parameters using the format: \`param_name\` - description.
                    4.  Include a clear description of the return value.
                    5.  When a function can panic, include a '# Panics' section detailing the conditions that cause a panic.
                    6.  If a function returns a Result, include an '# Errors' section describing the possible error conditions.
                    7.  For \`unsafe\` functions, include a '# Safety' section explaining the invariants the caller must uphold.
                    8.  Provide meaningful code examples in \`\`\`rust code blocks where appropriate to illustrate usage.
                    9.  Keep descriptions informative yet concise.
                    10. Adhere strictly to rustdoc conventions.
                    11. **Crucially, do not modify the actual Rust code.** Only add or enhance documentation comments.
                    12. **NEVER replace function bodies, struct fields, or any code with placeholder comments**
                    13. **NEVER use phrases like "remains unchanged", "implementation remains", "Field definitions remain", etc.**
                    14. **PRESERVE ALL function bodies, struct fields, enum variants, and executable code EXACTLY as-is**
                    15. Return the complete code with enhanced documentation.
                    16. Maintain the original code's structure and formatting exactly.
                    17. **Do NOT wrap your output in markdown code blocks (\`\`\`rust).** Return raw Rust code only.
                    
                    CRITICAL: Your output MUST contain ALL the original code PLUS documentation comments. Nothing should be removed or replaced with placeholders.`
                ),
                vscode.LanguageModelChatMessage.User(
                    `Module name: ${moduleName}\n\nEnhance the documentation in this Rust code:\n\n${code}`
                )
            ];

            // Use built-in LM chat request options (mirrors VS Code's native flow)
            const requestOptions: vscode.LanguageModelChatRequestOptions = {
                justification: 'Generating Rust documentation for extracted module'
            };


            const response = await model.sendRequest(
                messages,
                requestOptions,
                new vscode.CancellationTokenSource().token
            );

            logToOutput('Received documentation from language model.');
            logToOutput('Validating generated documentation...');
            logToOutput('--- Generated Documentation Start ---');
            logToOutput('Response streaming in...');

            // Process streaming response (standard LM API pattern)
            let documentedCode = '';
            for await (const fragment of response.text) {
                documentedCode += fragment;
            }

            // Clean up any markdown formatting from the response
            const cleaned = this.cleanMarkdownCodeBlocks(documentedCode);

            // Quick validation: Check for placeholder comments that indicate code was deleted
            if (cleaned.includes('remains unchanged') ||
                cleaned.includes('implementation remains') ||
                cleaned.includes('Field definitions remain') ||
                cleaned.includes('// Function implementation') ||
                cleaned.includes('// Field definitions')) {
                logToOutput('AI generated placeholder comments instead of preserving code - rejecting output');
                return null; // Return null to use original undocumented code
            }

            // Check that output isn't drastically shorter (which would indicate deleted code)
            const originalLines = code.split('\n').filter(l => l.trim()).length;
            const cleanedLines = cleaned.split('\n').filter(l => l.trim()).length;
            const lineRatio = cleanedLines / originalLines;

            if (lineRatio < 0.7) {
                logToOutput(`AI output is too short (${cleanedLines} vs ${originalLines} non-empty lines) - likely deleted code`);
                return null; // Return null to use original undocumented code
            }


            // First: Use LLM as a judge to validate the documentation
            const judgeResult = await this.validateWithLLMJudge(cleaned, code, model);

            if (!judgeResult.isValid) {
                logToOutput(`LLM judge rejected the documentation: ${judgeResult.reason}`);

                if (judgeResult.canRetry) {
                    logToOutput('Retrying with LLM feedback...');
                    return await this.retryDocumentationGeneration(code, moduleName, model, [judgeResult.reason]);
                }

                return null;
            }

            // Second: Validate using built-in VS Code diagnostics (mirrors built-in validation)
            const validationResult = await this.validateWithDiagnostics(cleaned, code, moduleName);

            if (!validationResult.isValid) {
                logToOutput(`Generated code failed validation: ${validationResult.errors}`);

                // Retry once with corrective prompt if validation failed
                if (validationResult.canRetry) {
                    logToOutput('Retrying documentation generation with corrective prompt...');
                    return await this.retryDocumentationGeneration(code, moduleName, model, validationResult.errors);
                }

                return null;
            }

            return cleaned;

        } catch (err) {
            if (this.isLanguageModelError(err)) {
                logToOutput(`Language Model Error: ${err.message, err.code}`);
                this.handleLanguageModelError(err);
            } else {
                logToOutput(`Error generating documentation: ${err}`);
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
            // --- Model Selection (Refactored) ---
            const model = await this.selectDocumentationModel();
            if (!model) {
                logToOutput('No language models available for extraction summary. Using default summary.');
                return defaultSummary;
            }

            // Construct summary request using built-in message helpers
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

            const requestOptions: vscode.LanguageModelChatRequestOptions = {
                justification: 'Generating summary for extracted Rust module'
            };

            const response = await model.sendRequest(
                messages,
                requestOptions,
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

            return `${summary}\n// Module: ${modulePath}\n// Use: ${moduleName}::*\n`;

        } catch (err) {
            logToOutput(`Error generating extraction summary: ${err}`);
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
        if (!this.isLanguageModelApiAvailable()) {
            this.warnLanguageModelUnavailable();
            return false;
        }

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

    private isLanguageModelApiAvailable(): boolean {
        const lmNamespace = (vscode as unknown as { lm?: { selectChatModels?: unknown } }).lm;
        return !!lmNamespace && typeof lmNamespace.selectChatModels === 'function';
    }

    private warnLanguageModelUnavailable(): void {
        logToOutput('Language Model API not available; skipping AI documentation generation.');
        if (!AIDocGenerator.hasWarnedAboutMissingLm) {
            vscode.window.showWarningMessage(
                'AI documentation requires a VS Code build with language model access (GitHub Copilot). Skipping documentation generation.'
            );
            AIDocGenerator.hasWarnedAboutMissingLm = true;
        }
    }

    /**
     * Uses an LLM as a judge to validate that documentation was added correctly
     * without modifying the original code structure.
     * Uses the same built-in LM API for validation.
     */
    private async validateWithLLMJudge(
        documentedCode: string,
        originalCode: string,
        model: vscode.LanguageModelChat
    ): Promise<{ isValid: boolean; reason: string; canRetry: boolean }> {
        try {
            const judgeMessages = [
                vscode.LanguageModelChatMessage.User(
                    `You are a Rust code validator. Your task is to verify that documentation was added to code correctly.
                    
                    Compare the ORIGINAL code with the DOCUMENTED code and check:
                    
                    1. **Code Preservation**: All original code (functions, structs, enums, impl blocks, etc.) must be EXACTLY preserved
                    2. **No Code Modification**: The actual Rust code should not be changed, only documentation comments added
                    3. **Valid Doc Comments**: Documentation must use proper /// or //! syntax
                    4. **No Inline Docs**: Documentation comments should NOT appear on the same line as code keywords
                    5. **No Commented Code**: The actual code should NOT be commented out (no // before pub, fn, struct, etc.)
                    6. **Complete Code**: All functions, structs, and other items from original must be present
                    7. **Balanced Braces**: All { and } must be balanced
                    8. **No #[doc] attributes**: Only /// and //! comments should be used, not #[doc = "..."] attributes
                    9. **No Placeholder Comments**: REJECT if code contains "remains unchanged", "implementation remains", "Field definitions remain", or similar placeholders
                    10. **Function Bodies Present**: All function bodies must be complete with actual code, not replaced with comments
                    11. **Struct Fields Present**: All struct fields must be present with their types, not replaced with comments
                    
                    Respond with JSON in this exact format:
                    {
                        "valid": true/false,
                        "reason": "explanation of what's wrong (if invalid)",
                        "canRetry": true/false (whether the issue can be fixed by retrying)
                    }
                    
                    If the documented code is valid, set valid to true with an empty reason.
                    If invalid, explain specifically what's wrong.`
                ),
                vscode.LanguageModelChatMessage.User(
                    `ORIGINAL CODE:
\`\`\`rust
${originalCode}
\`\`\`

DOCUMENTED CODE:
\`\`\`rust
${documentedCode}
\`\`\``
                )
            ];

            const requestOptions: vscode.LanguageModelChatRequestOptions = {
                justification: 'Validating generated Rust documentation'
            };

            const response = await model.sendRequest(
                judgeMessages,
                requestOptions,
                new vscode.CancellationTokenSource().token
            );

            let judgment = '';
            for await (const fragment of response.text) {
                judgment += fragment;
            }

            // Parse the JSON response
            const jsonMatch = judgment.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                logToOutput(`LLM judge returned non-JSON response: ${judgment}`);
                // Fix: If JSON is malformed, assume failure and allow retry instead of success.
                return { isValid: false, reason: 'LLM judge failed to return valid JSON', canRetry: true };
            }

            try {
                const result = JSON.parse(jsonMatch[0]);

                return {
                    isValid: result.valid === true,
                    reason: result.reason || 'LLM judge rejected the code',
                    canRetry: result.canRetry === true
                };
            } catch (parseErr) {
                logToOutput(`Failed to parse LLM judge response JSON: ${parseErr}`);
                // Fix: If JSON parsing fails, assume failure and allow retry instead of success.
                return { isValid: false, reason: 'Failed to parse LLM judge JSON response', canRetry: true };
            }

        } catch (err) {
            logToOutput(`Error in LLM judge validation: ${err}`);
            // Don't block on judge errors, return valid but don't retry immediately.
            return { isValid: true, reason: '', canRetry: false };
        }
    }

    /**
     * Validates generated code using VS Code's built-in diagnostics.
     * Creates a temporary file, checks for errors, and verifies symbols are detected.
     * This mirrors how the built-in "Generate Documentation" validates output.
     */
    private async validateWithDiagnostics(
        documentedCode: string,
        originalCode: string,
        moduleName: string
    ): Promise<{ isValid: boolean; errors: string[]; canRetry: boolean }> {
        const errors: string[] = [];

        // --- Logic Fix: Ensure cleanup with a try/finally block ---
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            logToOutput('No workspace folder for validation');
            return { isValid: true, errors: [], canRetry: false };
        }

        const tempDir = path.join(workspaceFolder.uri.fsPath, 'target', '.rusty-refactor-temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const tempFilePath = path.join(tempDir, `${moduleName}_validation.rs`);
        const tempFileUri = vscode.Uri.file(tempFilePath);

        try {
            // Basic structural validation first
            if (!this.hasBasicStructure(documentedCode, originalCode)) {
                errors.push('Code structure was modified or lost');
                return { isValid: false, errors, canRetry: true };
            }

            // Write the documented code to temp file
            fs.writeFileSync(tempFilePath, documentedCode, 'utf-8');

            // Open the document in VS Code (but don't show it)
            const document = await vscode.workspace.openTextDocument(tempFileUri);

            // Wait for rust-analyzer to process the file (use a more reliable method if possible)
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Get diagnostics using built-in VS Code API
            const diagnostics = vscode.languages.getDiagnostics(tempFileUri);
            const errorDiagnostics = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Error);

            if (errorDiagnostics.length > 0) {
                errors.push(...errorDiagnostics.map(d => `${d.message} at line ${d.range.start.line + 1}`));

                // Check if errors are documentation-related (can retry) or structural (can't retry)
                const isDocError = errorDiagnostics.some(d =>
                    d.message.includes('expected item') ||
                    d.message.includes('doc comment') ||
                    d.message.includes('expected expression')
                );

                return { isValid: false, errors, canRetry: isDocError };
            }

            // Check if symbols are properly detected using built-in VS Code symbol provider
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider',
                tempFileUri
            );

            if (!symbols || symbols.length === 0) {
                errors.push('No symbols detected in generated code - may be malformed');
                return { isValid: false, errors, canRetry: true };
            }

            // Validate that key symbols from original code are present
            const symbolNames = this.extractSymbolNames(symbols);
            const originalSymbols = this.extractSymbolsFromCode(originalCode);

            const missingSymbols = originalSymbols.filter(s => !symbolNames.includes(s));
            if (missingSymbols.length > 0) {
                errors.push(`Missing symbols: ${missingSymbols.join(', ')}`);
                return { isValid: false, errors, canRetry: true };
            }

            // All validations passed
            return { isValid: true, errors: [], canRetry: false };

        } catch (err) {
            logToOutput(`Error during validation: ${err}`);
            return { isValid: true, errors: [], canRetry: false };
        } finally {
            // Fix: Ensure cleanup code runs regardless of success or failure in the try block.
            try {
                if (fs.existsSync(tempFilePath)) {
                    fs.unlinkSync(tempFilePath);
                }
            } catch (e) {
                // Ignore cleanup errors
            }
        }
    }
    /**
     * Helper function to select a language model based on user preferences.
     * @returns A promise resolving to the selected model or null if none are available.
     */
    private async selectDocumentationModel(): Promise<vscode.LanguageModelChat | null> {
        // Query all available models
        const allModels = await vscode.lm.selectChatModels();
        
        if (allModels.length === 0) {
            logToOutput('No language models available');
            return null;
        }

        // Filter out models with insufficient token limits (need at least 4000 for documentation)
        const suitableModels = allModels.filter(m => m.maxInputTokens >= 4000);
        
        if (suitableModels.length === 0) {
            logToOutput('No models with sufficient token capacity found');
            vscode.window.showWarningMessage('No suitable language models available for documentation generation (need at least 4000 input tokens).');
            return null;
        }

        // Check if user has a preferred model in settings
        const config = vscode.workspace.getConfiguration('rustyRefactor');
        const preferredModelId = config.get<string>('aiPreferredModel');

        // Try to find the preferred model
        if (preferredModelId) {
            const preferredModel = suitableModels.find(m => `${m.vendor}/${m.family}` === preferredModelId);
            if (preferredModel) {
                logToOutput(`Using preferred model: ${preferredModel.name} (${preferredModel.vendor}/${preferredModel.family})`);
                logToOutput(`Model capabilities: maxInputTokens=${preferredModel.maxInputTokens}`);
                return preferredModel;
            }
            logToOutput(`Preferred model ${preferredModelId} not available or doesn't meet requirements`);
        }

        // If no preference or preferred not available, use the first suitable model
        const model = suitableModels[0];
        logToOutput(`Selected model: ${model.name} (${model.vendor}/${model.family})`);
        logToOutput(`Model capabilities: maxInputTokens=${model.maxInputTokens}`);
        return model;
    }

    /**
     * Shows a quick pick dialog to let the user select their preferred AI model.
     * Saves the selection to workspace settings.
     */
    async selectPreferredModel(): Promise<void> {
        const allModels = await vscode.lm.selectChatModels();
        
        if (allModels.length === 0) {
            vscode.window.showWarningMessage('No language models available.');
            return;
        }

        // Filter to suitable models
        const suitableModels = allModels.filter(m => m.maxInputTokens >= 4000);
        
        if (suitableModels.length === 0) {
            vscode.window.showWarningMessage('No language models with sufficient capacity (4000+ tokens) available.');
            return;
        }

        const items = suitableModels.map(model => ({
            label: model.name,
            description: `${model.vendor}/${model.family}`,
            detail: `Vendor: ${model.vendor}, Family: ${model.family}, Max tokens: ${model.maxInputTokens}`,
            modelId: `${model.vendor}/${model.family}`
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select your preferred AI model for documentation',
            title: 'Choose AI Model'
        });

        if (selected) {
            try {
                const config = vscode.workspace.getConfiguration('rustyRefactor');
                await config.update('aiPreferredModel', selected.modelId, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage(`AI model set to: ${selected.label}. Reload VS Code if you just installed this extension.`);
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Failed to save model preference: ${errorMsg}. Please reload VS Code and try again.`);
                logToOutput(`Error saving aiPreferredModel: ${errorMsg}`);
            }
        }
    }

    /**
     * Retry documentation generation with a corrective prompt.
     * Uses the same built-in LM API patterns as the initial generation.
     */
    private async retryDocumentationGeneration(
        code: string,
        moduleName: string,
        model: vscode.LanguageModelChat,
        previousErrors: string[]
    ): Promise<string | null> {
        try {
            const errorSummary = previousErrors.join('; ');

            const messages = [
                vscode.LanguageModelChatMessage.User(
                    `You are an expert in Rust and its documentation conventions (rustdoc).
                    Your previous attempt at adding documentation had these errors: ${errorSummary}
                    
                    **CRITICAL RULES:**
                    1. NEVER modify the actual Rust code - only add documentation comments
                    2. NEVER put /// on the same line as code keywords (pub, fn, struct, etc.)
                    3. NEVER add /// inside code examples
                    4. NEVER replace function bodies with placeholder comments like "remains unchanged" or "implementation remains"
                    5. NEVER replace struct fields with placeholder comments like "Field definitions remain"
                    6. Keep ALL original code exactly as-is - every function body, struct field, enum variant, etc.
                    7. Only add //! module comments at the top and /// item comments above items
                    8. Ensure all braces and parentheses remain balanced
                    9. Do NOT use #[doc = "..."] attributes, only use /// and //! comments
                    10. Return the COMPLETE code with ALL original logic preserved
                    
                    Add documentation comments to this Rust code, being very careful not to break the syntax or remove any code:`
                ),
                vscode.LanguageModelChatMessage.User(
                    `Module name: ${moduleName}\n\nCode:\n\n${code}`
                )
            ];

            const requestOptions: vscode.LanguageModelChatRequestOptions = {
                justification: 'Retrying Rust documentation generation with corrections'
            };

            const response = await model.sendRequest(
                messages,
                requestOptions,
                new vscode.CancellationTokenSource().token
            );

            let documentedCode = '';
            for await (const fragment of response.text) {
                documentedCode += fragment;
            }

            const cleaned = this.cleanMarkdownCodeBlocks(documentedCode);

            // Validate again (don't retry a second time)
            const validationResult = await this.validateWithDiagnostics(cleaned, code, moduleName);

            if (!validationResult.isValid) {
                logToOutput('Retry failed validation, using original code');
                return null;
            }

            return cleaned;

        } catch (err) {
            logToOutput(`Error in retry: ${err}`);
            return null;
        }
    }

    /**
     * Basic structure validation - ensures original code elements are still present
     */
    private hasBasicStructure(documentedCode: string, originalCode: string): boolean {
        // Check that major code elements are preserved
        const structMatch = originalCode.match(/struct\s+\w+/g);
        const fnMatch = originalCode.match(/fn\s+\w+/g);
        const enumMatch = originalCode.match(/enum\s+\w+/g);
        const implMatch = originalCode.match(/impl\s+/g);

        if (structMatch && !structMatch.every(s => documentedCode.includes(s))) return false;
        if (fnMatch && !fnMatch.every(f => documentedCode.includes(f))) return false;
        if (enumMatch && !enumMatch.every(e => documentedCode.includes(e))) return false;
        if (implMatch && implMatch.length > 0) {
            const implCount = (documentedCode.match(/impl\s+/g) || []).length;
            if (implCount !== implMatch.length) return false;
        }

        // Check brace balance
        const openBraces = (documentedCode.match(/\{/g) || []).length;
        const closeBraces = (documentedCode.match(/\}/g) || []).length;
        if (openBraces !== closeBraces) return false;

        return true;
    }

    /**
     * Extract symbol names from DocumentSymbol array recursively
     */
    private extractSymbolNames(symbols: vscode.DocumentSymbol[]): string[] {
        const names: string[] = [];

        for (const symbol of symbols) {
            names.push(symbol.name);
            if (symbol.children && symbol.children.length > 0) {
                names.push(...this.extractSymbolNames(symbol.children));
            }
        }

        return names;
    }

    /**
     * Extract expected symbol names from original code
     */
    private extractSymbolsFromCode(code: string): string[] {
        const symbols: string[] = [];

        // Extract struct names
        const structMatches = code.matchAll(/pub\s+struct\s+(\w+)|struct\s+(\w+)/g);
        for (const match of structMatches) {
            symbols.push(match[1] || match[2]);
        }

        // Extract function names
        const fnMatches = code.matchAll(/pub\s+fn\s+(\w+)|fn\s+(\w+)/g);
        for (const match of fnMatches) {
            symbols.push(match[1] || match[2]);
        }

        // Extract enum names
        const enumMatches = code.matchAll(/pub\s+enum\s+(\w+)|enum\s+(\w+)/g);
        for (const match of enumMatches) {
            symbols.push(match[1] || match[2]);
        }

        // Extract trait names
        const traitMatches = code.matchAll(/pub\s+trait\s+(\w+)|trait\s+(\w+)/g);
        for (const match of traitMatches) {
            symbols.push(match[1] || match[2]);
        }

        return symbols;
    }

    /**
     * Handles specific `LanguageModelError` types with user-friendly notifications.
     *
     * @param err The `LanguageModelError` instance.
     */
    private handleLanguageModelError(err: vscode.LanguageModelError): void {
        switch (err.code) {
            case 'NotFound':
                vscode.window.showWarningMessage(
                    'The selected language model is not available. Documentation generation was skipped.'
                );
                break;
            case 'NoPermissions':
                vscode.window.showWarningMessage(
                    'You do not have permission to use the language model. Please ensure GitHub Copilot is enabled and configured correctly.'
                );
                break;
            case 'Blocked':
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

    private isLanguageModelError(err: unknown): err is vscode.LanguageModelError {
        const LanguageModelErrorCtor = (vscode as unknown as { LanguageModelError?: new (...args: any[]) => vscode.LanguageModelError }).LanguageModelError;

        if (typeof LanguageModelErrorCtor === 'function' && err instanceof LanguageModelErrorCtor) {
            return true;
        }

        if (err && typeof err === 'object' && 'code' in err && 'message' in err) {
            const code = (err as { code?: unknown }).code;
            return typeof code === 'string' && ['NotFound', 'NoPermissions', 'Blocked', 'ModelOverloaded', 'ServiceUnavailable', 'TranscriptTooLong', 'Unknown'].includes(code);
        }

        return false;
    }
}