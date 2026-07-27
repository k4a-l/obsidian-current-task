import { debounce, Plugin, type TFile, type WorkspaceLeaf } from "obsidian";
import {
	ActiveNoteTaskView,
	VIEW_TYPE_ACTIVE_NOTE_TASK,
} from "./features/active-note/ActiveNoteTaskView";
import { TaskExtractor } from "./features/active-note/TaskExtractor";
import { DailyNoteTaskManager } from "./features/daily-note/DailyNoteTaskManager";
import {
	completeThisTaskNow,
	startThisTaskNow,
} from "./features/daily-note/dailyNote";
import {
	DEFAULT_SETTINGS,
	type TasksPluginSettings,
	TasksPluginSettingTab,
} from "./settings";

export default class PluginClass extends Plugin {
	settings: TasksPluginSettings;
	statusBarItemEl: HTMLElement;
	taskExtractor: TaskExtractor;
	dailyNoteTaskManager: DailyNoteTaskManager;
	lastActiveFile: TFile | null = null;

	// Debounced extraction to avoid freezing the editor
	debouncedExtract: () => void;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new TasksPluginSettingTab(this.app, this));

		this.taskExtractor = new TaskExtractor(this.app);
		this.dailyNoteTaskManager = new DailyNoteTaskManager(this.app, this);
		this.dailyNoteTaskManager.init();

		// Add time toggle command
		this.addCommand({
			id: "complete-this-task-now",
			name: "Complete this task now",
			editorCallback: (editor) => {
				completeThisTaskNow(editor);
			},
		});

		// Start the task "now": set the current time as the start time.
		// Branches internally: shifts a range (keeping its duration), expands a
		// relative duration (e.g. "10m") into a range, replaces a start-only time,
		// or turns a plain line into a timed task.
		this.addCommand({
			id: "start-this-task-now",
			name: "Start this task now",
			editorCallback: (editor) => {
				startThisTaskNow(editor);
			},
		});

		this.debouncedExtract = debounce(
			this.extractAndDisplayTasks.bind(this),
			300,
			true,
		);

		this.registerView(
			VIEW_TYPE_ACTIVE_NOTE_TASK,
			(leaf: WorkspaceLeaf) => new ActiveNoteTaskView(leaf, this),
		);

		// Status bar item
		this.statusBarItemEl = this.addStatusBarItem();
		this.statusBarItemEl.addClass("mod-clickable");
		this.statusBarItemEl.onClickEvent(async () => {
			await this.activateView();
		});

		this.updateStatusBar(0);
		if (!this.settings.enableActiveNoteTasks) {
			this.statusBarItemEl.hide();
		}

		// Event listeners for active note task extractor
		this.registerEvent(
			this.app.workspace.on("file-open", () => {
				this.extractAndDisplayTasks();
			}),
		);

		this.registerEvent(
			this.app.metadataCache.on("changed", () => {
				this.debouncedExtract();
			}),
		);

		this.app.workspace.onLayoutReady(() => {
			this.extractAndDisplayTasks();
		});
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_ACTIVE_NOTE_TASK);
		if (this.dailyNoteTaskManager) {
			this.dailyNoteTaskManager.unload();
		}
	}

	/**
	 * Reflect the feature ON/OFF settings without requiring a plugin reload.
	 * Turning the active note feature off closes its panel and hides the status
	 * bar item; turning it back on re-runs the extraction.
	 */
	applyFeatureToggles() {
		this.dailyNoteTaskManager.setEnabled(this.settings.enableDailyNoteBanner);

		if (this.settings.enableActiveNoteTasks) {
			this.statusBarItemEl.show();
			this.extractAndDisplayTasks();
		} else {
			this.statusBarItemEl.hide();
			this.app.workspace.detachLeavesOfType(VIEW_TYPE_ACTIVE_NOTE_TASK);
		}
	}

	// Active note task extractor functions
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async activateView() {
		if (!this.settings.enableActiveNoteTasks) return;

		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null | undefined = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_ACTIVE_NOTE_TASK);

		if (leaves.length > 0) {
			leaf = leaves[0];
		} else {
			leaf = workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.setViewState({
					type: VIEW_TYPE_ACTIVE_NOTE_TASK,
					active: true,
				});
			}
		}

		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	async extractAndDisplayTasks() {
		if (!this.settings.enableActiveNoteTasks) return;

		const currentFile = this.app.workspace.getActiveFile();
		if (currentFile && currentFile.extension === "md") {
			this.lastActiveFile = currentFile;
		}

		if (!this.lastActiveFile) {
			this.updateStatusBar(0);
			return;
		}

		const tasks = await this.taskExtractor.extractTasks(
			this.lastActiveFile,
			this.settings.filterStatuses,
		);

		this.updateStatusBar(tasks.length);

		const leaves = this.app.workspace.getLeavesOfType(
			VIEW_TYPE_ACTIVE_NOTE_TASK,
		);
		if (leaves.length > 0) {
			for (const leaf of leaves) {
				const view = leaf.view;
				if (view instanceof ActiveNoteTaskView) {
					view.updateTasks(tasks);
				}
			}
		}
	}

	updateStatusBar(count: number) {
		this.statusBarItemEl.setText(`Tasks: ${count}`);
	}
}
