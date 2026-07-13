// Minimal mock of the "obsidian" module for vitest.
// Only the named exports that the plugin (and obsidian-daily-notes-interface)
// import at module load need to exist here; the test-exercised code paths
// (e.g. setTaskStartTime) do not actually use any of them at runtime.

export class App {}
export class Editor {}
export class MarkdownView {}
export class TFile {}
export class TFolder {}
export class Vault {}
export class Notice {}

export function normalizePath(path: string): string {
	return path;
}
