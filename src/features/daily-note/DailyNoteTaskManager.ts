import { type App, MarkdownView } from "obsidian";
import type PluginClass from "../../main";
import {
	type ActiveTrackingTask,
	createBanner,
	getActiveTrackingTasks,
	getDailyNoteFile,
	updateBannerContent,
} from "./dailyNote";

export class DailyNoteTaskManager {
	private updateTimer: number | null = null;
	private bannerEl: HTMLElement | null = null;
	private lastActiveTasks: ActiveTrackingTask[] | null = null;
	private currentView: MarkdownView | null = null;

	constructor(
		private app: App,
		private plugin: PluginClass,
	) {}

	init() {
		this.plugin.registerEvent(
			this.app.workspace.on("active-leaf-change", async () => {
				await this.handleActiveLeafChange();
			}),
		);

		this.plugin.registerEvent(
			this.app.metadataCache.on("changed", async (file) => {
				const dailyNoteFile = getDailyNoteFile();
				if (dailyNoteFile && file.path === dailyNoteFile.path) {
					await this.updateBanner();
				}
			}),
		);

		this.setEnabled(this.plugin.settings.enableDailyNoteBanner);
	}

	unload() {
		this.stopTimer();
		this.removeBanner();
	}

	/**
	 * Turn the banner feature on or off at runtime.
	 * Disabling removes the current banner and stops the refresh timer, so the
	 * registered events stay harmless no-ops until it is re-enabled.
	 */
	setEnabled(enabled: boolean) {
		if (enabled) {
			this.startTimer();
			this.handleActiveLeafChange();
		} else {
			this.stopTimer();
			this.removeBanner();
		}
	}

	private async handleActiveLeafChange() {
		if (!this.plugin.settings.enableDailyNoteBanner) return;

		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);

		if (activeView === this.currentView) {
			await this.updateBanner();
			return;
		}

		this.removeBanner();

		if (activeView) {
			this.currentView = activeView;
			const warningThreshold = this.plugin.settings.noRangeTaskWarningThreshold;
			const upcomingThreshold = this.plugin.settings.upcomingTaskThreshold;
			this.bannerEl = createBanner(
				this.app,
				activeView,
				warningThreshold,
				upcomingThreshold,
			);
			await this.updateBanner();
		}
	}

	private removeBanner() {
		if (this.bannerEl) {
			this.bannerEl.remove();
			this.bannerEl = null;
		}
		this.lastActiveTasks = null;
		this.currentView = null;
	}

	private async updateBanner() {
		if (!this.bannerEl) return;
		const warningThreshold = this.plugin.settings.noRangeTaskWarningThreshold;
		const upcomingThreshold = this.plugin.settings.upcomingTaskThreshold;
		const activeTasks = await getActiveTrackingTasks(
			this.app,
			warningThreshold,
			upcomingThreshold,
		);
		this.lastActiveTasks = updateBannerContent(
			this.app,
			this.bannerEl,
			activeTasks,
			this.lastActiveTasks,
		);
	}

	private startTimer() {
		this.stopTimer();
		this.updateTimer = window.setInterval(async () => {
			await this.updateBanner();
		}, 10000);
	}

	private stopTimer() {
		if (this.updateTimer !== null) {
			window.clearInterval(this.updateTimer);
			this.updateTimer = null;
		}
	}
}
