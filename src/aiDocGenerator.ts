
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { RustAnalyzerIntegration } from './rustAnalyzerIntegration';

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
            const cleaned = this.cleanMarkdownCodeBlocks(documentedCode);
            
            // First: Use LLM as a judge to validate the documentation
            const judgeResult = await this.validateWithLLMJudge(cleaned, code, model);
            
            if (!judgeResult.isValid) {
                console.warn('LLM judge rejected the documentation:', judgeResult.reason);
                
                if (judgeResult.canRetry) {
                    console.log('Retrying with LLM feedback...');
                    return await this.retryDocumentationGeneration(code, moduleName, model, [judgeResult.reason]);
                }
                
                return null;
            }
            
            // Second: Validate the generated code with rust-analyzer and VS Code diagnostics
            const validationResult = await this.validateWithRustAnalyzer(cleaned, code, moduleName);
            
            if (!validationResult.isValid) {
                console.warn('AI generated code failed rust-analyzer validation:', validationResult.errors);
                
                // Retry once with a corrective prompt if first attempt failed
                if (validationResult.canRetry) {
                    console.log('Retrying documentation generation with corrective prompt...');
                    return await this.retryDocumentationGeneration(code, moduleName, model, validationResult.errors);
                }
                
                return null;
            }
            
            return cleaned;

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
     * Uses an LLM as a judge to validate that documentation was added correctly
     * without modifying the original code structure
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
            
            const response = await model.sendRequest(
                judgeMessages,
                {},
                new vscode.CancellationTokenSource().token
            );
            
            let judgment = '';
            for await (const fragment of response.text) {
                judgment += fragment;
            }
            
            // Parse the JSON response
            const jsonMatch = judgment.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                console.warn('LLM judge returned non-JSON response:', judgment);
                // If we can't parse, assume valid (fail open)
                return { isValid: true, reason: '', canRetry: false };
            }
            
            try {
                const result = JSON.parse(jsonMatch[0]);
                
                return {
                    isValid: result.valid === true,
                    reason: result.reason || 'LLM judge rejected the code',
                    canRetry: result.canRetry === true
                };
            } catch (parseErr) {
                console.error('Failed to parse LLM judge response:', parseErr);
                // Fail open if we can't parse
                return { isValid: true, reason: '', canRetry: false };
            }
            
        } catch (err) {
            console.error('Error in LLM judge validation:', err);
            // Fail open - don't block on judge errors
            return { isValid: true, reason: '', canRetry: false };
        }
    }

    /**
     * Validates generated code using rust-analyzer and VS Code diagnostics
     * Creates a temporary file, checks for errors, and verifies symbols are detected
     */
    private async validateWithRustAnalyzer(
        documentedCode: string,
        originalCode: string,
        moduleName: string
    ): Promise<{ isValid: boolean; errors: string[]; canRetry: boolean }> {
        const errors: string[] = [];
        
        try {
            // Basic structural validation first
            if (!this.hasBasicStructure(documentedCode, originalCode)) {
                errors.push('Code structure was modified or lost');
                return { isValid: false, errors, canRetry: true };
            }
            
            // Create a temporary file to validate with rust-analyzer
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                // Can't validate without workspace, but don't fail
                console.warn('No workspace folder for validation');
                return { isValid: true, errors: [], canRetry: false };
            }
            
            const tempDir = path.join(workspaceFolder.uri.fsPath, 'target', '.rusty-refactor-temp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }
            
            const tempFilePath = path.join(tempDir, `${moduleName}_validation.rs`);
            const tempFileUri = vscode.Uri.file(tempFilePath);
            
            // Write the documented code to temp file
            fs.writeFileSync(tempFilePath, documentedCode, 'utf-8');
            
            // Open the document in VS Code (but don't show it)
            const document = await vscode.workspace.openTextDocument(tempFileUri);
            
            // Wait a bit for rust-analyzer to process the file
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Get diagnostics from VS Code
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
                
                // Clean up temp file
                try {
                    fs.unlinkSync(tempFilePath);
                } catch (e) {
                    // Ignore cleanup errors
                }
                
                return { isValid: false, errors, canRetry: isDocError };
            }
            
            // Check if symbols are properly detected using VS Code's symbol provider
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider',
                tempFileUri
            );
            
            if (!symbols || symbols.length === 0) {
                errors.push('No symbols detected in generated code - may be malformed');
                
                // Clean up temp file
                try {
                    fs.unlinkSync(tempFilePath);
                } catch (e) {
                    // Ignore cleanup errors
                }
                
                return { isValid: false, errors, canRetry: true };
            }
            
            // Validate that key symbols from original code are present
            const symbolNames = this.extractSymbolNames(symbols);
            const originalSymbols = this.extractSymbolsFromCode(originalCode);
            
            const missingSymbols = originalSymbols.filter(s => !symbolNames.includes(s));
            if (missingSymbols.length > 0) {
                errors.push(`Missing symbols: ${missingSymbols.join(', ')}`);
                
                // Clean up temp file
                try {
                    fs.unlinkSync(tempFilePath);
                } catch (e) {
                    // Ignore cleanup errors
                }
                
                return { isValid: false, errors, canRetry: true };
            }
            
            // Clean up temp file
            try {
                fs.unlinkSync(tempFilePath);
            } catch (e) {
                // Ignore cleanup errors
            }
            
            // All validations passed
            return { isValid: true, errors: [], canRetry: false };
            
        } catch (err) {
            console.error('Error during validation:', err);
            // Don't fail on validation errors, just log
            return { isValid: true, errors: [], canRetry: false };
        }
    }

    /**
     * Retry documentation generation with a corrective prompt
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
                    4. Keep all original code exactly as-is
                    5. Only add //! module comments at the top and /// item comments above items
                    6. Ensure all braces and parentheses remain balanced
                    7. Do NOT use #[doc = "..."] attributes, only use /// and //! comments
                    
                    Add documentation comments to this Rust code, being very careful not to break the syntax:`
                ),
                vscode.LanguageModelChatMessage.User(
                    `Module name: ${moduleName}\n\nCode:\n\n${code}`
                )
            ];
            
            const response = await model.sendRequest(
                messages,
                {},
                new vscode.CancellationTokenSource().token
            );
            
            let documentedCode = '';
            for await (const fragment of response.text) {
                documentedCode += fragment;
            }
            
            const cleaned = this.cleanMarkdownCodeBlocks(documentedCode);
            
            // Validate again (don't retry a second time)
            const validationResult = await this.validateWithRustAnalyzer(cleaned, code, moduleName);
            
            if (!validationResult.isValid) {
                console.warn('Retry failed validation, using original code');
                return null;
            }
            
            return cleaned;
            
        } catch (err) {
            console.error('Error in retry:', err);
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