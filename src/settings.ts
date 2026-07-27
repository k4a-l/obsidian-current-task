import { type App, PluginSettingTab, Setting } from "obsidian";
import type PluginClass from "./main";

export interface TasksPluginSettings {
	enableDailyNoteBanner: boolean;
	enableActiveNoteTasks: boolean;
	filterStatuses: string[];
	noRangeTaskWarningThreshold: number; // in minutes
	upcomingTaskThreshold: number; // in minutes
}

export const DEFAULT_SETTINGS: TasksPluginSettings = {
	enableDailyNoteBanner: true, // Default: banner enabled
	enableActiveNoteTasks: true, // Default: active note task summary enabled
	filterStatuses: [" "], // Default: incomplete tasks
	noRangeTaskWarningThreshold: 60, // Default: 60 minutes
	upcomingTaskThreshold: 30, // Default: 30 minutes
};

export class TasksPluginSettingTab extends PluginSettingTab {
	plugin: PluginClass;

	constructor(app: App, plugin: PluginClass) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Focus Tasks Settings" });

		new Setting(containerEl)
			.setName("Enable daily note task banner")
			.setDesc(
				"Show the banner with the tasks currently being tracked in the daily note.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableDailyNoteBanner)
					.onChange(async (value) => {
						this.plugin.settings.enableDailyNoteBanner = value;
						await this.plugin.saveSettings();
						this.plugin.applyFeatureToggles();
					}),
			);

		new Setting(containerEl)
			.setName("Enable active note task summary")
			.setDesc(
				"Count the tasks in the currently open note and show them in the status bar and side panel.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableActiveNoteTasks)
					.onChange(async (value) => {
						this.plugin.settings.enableActiveNoteTasks = value;
						await this.plugin.saveSettings();
						this.plugin.applyFeatureToggles();
					}),
			);

		new Setting(containerEl)
			.setName("Warning threshold for tasks without range (minutes)")
			.setDesc(
				"The number of minutes after which a running task without a specific end time is marked as warning.",
			)
			.addText((text) =>
				text
					.setPlaceholder("60")
					.setValue(String(this.plugin.settings.noRangeTaskWarningThreshold))
					.onChange(async (value) => {
						const num = parseInt(value, 10);
						if (!Number.isNaN(num) && num >= 0) {
							this.plugin.settings.noRangeTaskWarningThreshold = num;
							await this.plugin.saveSettings();
						}
					}),
			);

		new Setting(containerEl)
			.setName("Upcoming task lead time (minutes)")
			.setDesc(
				"The number of minutes before a task's start time to display it on the banner.",
			)
			.addText((text) =>
				text
					.setPlaceholder("30")
					.setValue(String(this.plugin.settings.upcomingTaskThreshold))
					.onChange(async (value) => {
						const num = parseInt(value, 10);
						if (!Number.isNaN(num) && num >= 0) {
							this.plugin.settings.upcomingTaskThreshold = num;
							await this.plugin.saveSettings();
						}
					}),
			);
	}
}
