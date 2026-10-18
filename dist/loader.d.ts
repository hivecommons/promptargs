/**
 * Find and load prompt templates from .prompts/ directories.
 */
export interface PromptTemplate {
    name: string;
    content: string;
    path: string;
    source: 'project' | 'user';
    /** Set when the file could not be read; content is then empty. */
    error?: string;
}
export declare function loadTemplates(cwd?: string): PromptTemplate[];
export declare function findTemplate(name: string, cwd?: string): PromptTemplate | undefined;
