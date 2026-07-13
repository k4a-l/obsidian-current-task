import moment from "moment";
import { type App, type Editor, MarkdownView, type TFile } from "obsidian";
import {
	getAllDailyNotes,
	getDailyNote,
	getDailyNoteSettings,
} from "obsidian-daily-notes-interface";
import { absoluteFlag, buildCheckboxPrefix, parseTaskLine } from "./taskLine";

export interface ActiveTrackingTask {
	taskText: string;
	startTime: string; // "HH:mm"
	endTime?: string; // "HH:mm"
	lineNumber: number;
	isRangeActive: boolean;
	isCompleted: boolean;
	isUpcoming?: boolean;
	isStartAbsolute: boolean; // !14:00
	isEndAbsolute?: boolean; // 15:00!
}

export function getDailyNoteConfig(): {
	folder?: string;
	format?: string;
} | null {
	try {
		const settings = getDailyNoteSettings();
		return {
			folder: settings.folder,
			format: settings.format,
		};
	} catch (e) {
		console.error("Failed to get daily note settings", e);
		return null;
	}
}

export function getDailyNoteFile(): TFile | null {
	try {
		const dailyNotes = getAllDailyNotes();
		const note = getDailyNote(moment(), dailyNotes);
		return note || null;
	} catch (e) {
		console.error("Failed to get daily note file", e);
		return null;
	}
}

export async function getActiveTrackingTasks(
	app: App,
	warningThreshold: number,
	upcomingThreshold: number,
): Promise<ActiveTrackingTask[]> {
	const file = getDailyNoteFile();
	if (!file) return [];

	const content = await app.vault.cachedRead(file);
	return extractActiveTrackingTasks(
		content,
		warningThreshold,
		upcomingThreshold,
	);
}

// Only blank / x / X checkboxes are treated as trackable tasks; any other
// custom status (e.g. "[-]", "[/]") is ignored, matching the legacy behavior.
function isTrackableCheckbox(check: string | undefined): boolean {
	return check === undefined || /^[xX\s]$/.test(check);
}

/**
 * Pure core of {@link getActiveTrackingTasks}: given daily-note text, return the
 * currently active/upcoming tracking tasks. Only range and start-only timed
 * tasks are tracked; completed ("[x]") lines are skipped. Time comparisons use
 * the current wall-clock (`moment()`), so callers control it via the system clock.
 */
export function extractActiveTrackingTasks(
	content: string,
	warningThreshold: number,
	upcomingThreshold: number,
): ActiveTrackingTask[] {
	const lines = content.split("\n");
	const now = moment();
	const todayStr = now.format("YYYY-MM-DD");

	const activeTasks: ActiveTrackingTask[] = [];
	let isInCodeBlock = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined) continue;

		// Skip code blocks
		if (line.trim().startsWith("```")) {
			isInCodeBlock = !isInCodeBlock;
			continue;
		}
		if (isInCodeBlock) continue;

		const parsed = parseTaskLine(line);
		if (!parsed) continue;
		// Only timed start-bearing tasks show in the banner.
		if (parsed.kind !== "range" && parsed.kind !== "startOnly") continue;
		if (!isTrackableCheckbox(parsed.check)) continue;
		if (parsed.check === "x" || parsed.check === "X") continue; // completed
		if (parsed.start === undefined) continue;

		const startTimeStr = parsed.start;
		const taskText = parsed.content.trim();
		const start = moment(`${todayStr} ${startTimeStr}`, "YYYY-MM-DD HH:mm");
		const isStarted = now.isSameOrAfter(start);
		const isUpcoming =
			!isStarted &&
			now.isSameOrAfter(start.clone().subtract(upcomingThreshold, "minutes"));

		if (parsed.kind === "range" && parsed.end !== undefined) {
			const endTimeStr = parsed.end;
			const end = moment(`${todayStr} ${endTimeStr}`, "YYYY-MM-DD HH:mm");
			const isWithinRange = now.isBetween(start, end, null, "[]");

			if (isStarted) {
				activeTasks.push({
					taskText,
					startTime: startTimeStr,
					endTime: endTimeStr,
					lineNumber: i,
					isRangeActive: isWithinRange,
					isCompleted: false,
					isStartAbsolute: !!parsed.startAbsolute,
					isEndAbsolute: !!parsed.endAbsolute,
				});
			} else if (isUpcoming) {
				activeTasks.push({
					taskText,
					startTime: startTimeStr,
					endTime: endTimeStr,
					lineNumber: i,
					isRangeActive: false,
					isCompleted: false,
					isUpcoming: true,
					isStartAbsolute: !!parsed.startAbsolute,
					isEndAbsolute: !!parsed.endAbsolute,
				});
			}
		} else if (parsed.kind === "startOnly") {
			if (isStarted) {
				const diffMinutes = now.diff(start, "minutes");
				const isWithinThreshold = diffMinutes < warningThreshold;

				activeTasks.push({
					taskText,
					startTime: startTimeStr,
					lineNumber: i,
					isRangeActive: isWithinThreshold,
					isCompleted: false,
					isStartAbsolute: !!parsed.startAbsolute,
				});
			} else if (isUpcoming) {
				activeTasks.push({
					taskText,
					startTime: startTimeStr,
					lineNumber: i,
					isRangeActive: false,
					isCompleted: false,
					isUpcoming: true,
					isStartAbsolute: !!parsed.startAbsolute,
				});
			}
		}
	}

	activeTasks.sort((a, b) => a.startTime.localeCompare(b.startTime));
	return activeTasks;
}

export function createBanner(
	app: App,
	view: MarkdownView,
	warningThreshold: number,
	upcomingThreshold: number,
): HTMLElement {
	const banner = view.contentEl.createDiv({
		cls: "k4a-tasks-timer-banner cm-s-obsidian",
	});

	// タスクが空のときにバナー全体をクリックするとデイリーノートを開く
	banner.addEventListener("click", async () => {
		const activeTasks = await getActiveTrackingTasks(
			app,
			warningThreshold,
			upcomingThreshold,
		);
		if (activeTasks.length === 0) {
			const file = getDailyNoteFile();
			if (file) {
				await jumpToDailyNoteLine(app, file);
			}
		}
	});

	view.contentEl.prepend(banner);
	return banner;
}

export function isTasksEqual(
	a: ActiveTrackingTask[],
	b: ActiveTrackingTask[],
): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		const ta = a[i];
		const tb = b[i];
		if (!ta || !tb) return false;
		if (
			ta.taskText !== tb.taskText ||
			ta.startTime !== tb.startTime ||
			ta.endTime !== tb.endTime ||
			ta.lineNumber !== tb.lineNumber ||
			ta.isRangeActive !== tb.isRangeActive ||
			ta.isCompleted !== tb.isCompleted ||
			ta.isUpcoming !== tb.isUpcoming ||
			ta.isStartAbsolute !== tb.isStartAbsolute ||
			ta.isEndAbsolute !== tb.isEndAbsolute
		) {
			return false;
		}
	}
	return true;
}

export function calculateElapsedTime(
	startTimeStr: string,
	endTimeStr?: string,
	isCompleted: boolean = false,
): string {
	const now = moment();
	const start = moment(startTimeStr, "HH:mm");

	if (start.isAfter(now)) {
		const diffMs = start.diff(now);
		const diffDuration = moment.duration(diffMs);
		const hours = Math.floor(diffDuration.asHours());
		const minutes = diffDuration.minutes();
		if (hours > 0) {
			return `-${hours}h ${minutes}m`;
		}
		return `-${minutes}m`;
	}

	let diffMs = 0;
	if (isCompleted && endTimeStr) {
		const end = moment(endTimeStr, "HH:mm");
		diffMs = end.diff(start);
	} else {
		diffMs = now.diff(start);
	}

	const diffDuration = moment.duration(diffMs);
	const hours = Math.floor(diffDuration.asHours());
	const minutes = diffDuration.minutes();

	if (hours > 0) {
		return `${hours}h ${minutes}m`;
	}
	return `${minutes}m`;
}

export async function jumpToDailyNoteLine(
	app: App,
	file: TFile,
	line?: number,
) {
	const leaves = app.workspace.getLeavesOfType("markdown");
	let targetLeaf = null;

	for (const leaf of leaves) {
		const view = leaf.view;
		if (
			view instanceof MarkdownView &&
			view.file &&
			view.file.path === file.path
		) {
			targetLeaf = leaf;
			break;
		}
	}

	if (targetLeaf) {
		app.workspace.setActiveLeaf(targetLeaf, { focus: true });
		if (line !== undefined) {
			const view = targetLeaf.view;
			if (view instanceof MarkdownView && view.editor) {
				const lineLength = view.editor.getLine(line).length;
				view.editor.setSelection({ line, ch: 0 }, { line, ch: lineLength });
				view.editor.scrollIntoView(
					{ from: { line, ch: 0 }, to: { line, ch: lineLength } },
					true,
				);
			}
		}
	} else {
		const leaf = app.workspace.getLeaf("tab");
		await leaf.openFile(file);
		app.workspace.setActiveLeaf(leaf, { focus: true });
		if (line !== undefined) {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.editor) {
				const lineLength = view.editor.getLine(line).length;
				view.editor.setSelection({ line, ch: 0 }, { line, ch: lineLength });
				view.editor.scrollIntoView(
					{ from: { line, ch: 0 }, to: { line, ch: lineLength } },
					true,
				);
			}
		}
	}
}

export function updateBannerContent(
	app: App,
	bannerEl: HTMLElement,
	activeTasks: ActiveTrackingTask[],
	lastActiveTasks: ActiveTrackingTask[] | null,
): ActiveTrackingTask[] {
	const isStructureSame =
		lastActiveTasks !== null && isTasksEqual(lastActiveTasks, activeTasks);

	if (!isStructureSame) {
		bannerEl.empty();

		if (activeTasks.length > 0) {
			bannerEl.className = "k4a-tasks-timer-banner cm-s-obsidian is-active";

			for (let i = 0; i < activeTasks.length; i++) {
				const task = activeTasks[i];
				if (!task) continue;

				const isWarning =
					!task.isRangeActive && !task.isCompleted && !task.isUpcoming;
				const rowCls = task.isCompleted
					? "k4a-banner-row is-completed"
					: task.isUpcoming
						? "k4a-banner-row is-upcoming"
						: isWarning
							? "k4a-banner-row is-warning"
							: "k4a-banner-row";
				const row = bannerEl.createDiv({ cls: rowCls });
				row.addEventListener("click", async (e) => {
					e.stopPropagation(); // Prevent trigger bannerEl click
					const file = getDailyNoteFile();
					if (file) {
						await jumpToDailyNoteLine(app, file, task.lineNumber);
					}
				});

				const leftContainer = row.createDiv({ cls: "k4a-banner-left" });

				const iconEl = leftContainer.createSpan({ cls: "k4a-banner-icon" });
				iconEl.textContent = task.isCompleted
					? "✅"
					: task.isUpcoming
						? "🔔"
						: task.isRangeActive
							? "⏱️"
							: "⏳";

				const timerEl = leftContainer.createSpan({
					cls: "k4a-banner-timer",
				});
				const timerTextEl = timerEl.createSpan({
					cls: "k4a-banner-timer-text",
				});
				timerTextEl.setAttribute("data-task-index", String(i));

				const elapsedStr = calculateElapsedTime(
					task.startTime,
					task.endTime,
					task.isCompleted,
				);
				timerTextEl.textContent = elapsedStr;

				// 経過時間とタスク名の間の垂直区切り線
				leftContainer.createSpan({
					cls: "k4a-banner-divider",
				});

				const taskNameEl = leftContainer.createSpan({
					cls: "k4a-banner-task-name",
				});
				const currentFile = getDailyNoteFile();
				parseMarkdownAndWikiLinks(
					task.taskText,
					taskNameEl,
					app,
					currentFile?.path || "",
				);

				const timeRangeStr = task.endTime
					? `(${task.startTime} - ${task.endTime})`
					: `(${task.startTime} - )`;
				const timeInfoEl = leftContainer.createSpan({
					cls: "k4a-banner-time-info",
				});
				timeInfoEl.textContent = timeRangeStr;
			}
		} else {
			bannerEl.className = "k4a-tasks-timer-banner cm-s-obsidian is-empty";

			const leftContainer = bannerEl.createDiv({
				cls: "k4a-banner-warning-text",
			});
			leftContainer.textContent = "📅 取り組んでいるタスクはありません";
		}
		return activeTasks;
	} else {
		if (activeTasks.length > 0) {
			const timerEls = bannerEl.querySelectorAll(".k4a-banner-timer-text");
			timerEls.forEach((el) => {
				if (el instanceof HTMLElement) {
					const indexAttr = el.getAttribute("data-task-index");
					if (indexAttr && indexAttr !== "none") {
						const idx = parseInt(indexAttr, 10);
						const task = activeTasks[idx];
						if (task) {
							const elapsedStr = calculateElapsedTime(
								task.startTime,
								task.endTime,
								task.isCompleted,
							);
							if (el.textContent !== elapsedStr) {
								el.textContent = elapsedStr;
							}
						}
					}
				}
			});
		}
		return lastActiveTasks;
	}
}

/**
 * Complete the current task "now": mark it "[x]" and record the current time as
 * its end. Branches on the line shape:
 *  - Range / start-only  -> keep the start, set the end to now.
 *  - End-only            -> set the actual end to now.
 *  - Anything else       -> record an end-only range ("- [x] - hh:mm content"),
 *                           since there is no known start time.
 */
export function completeThisTaskNow(editor: Editor) {
	const cursor = editor.getCursor();
	const lineIndex = cursor.line;
	const lineText = editor.getLine(lineIndex);

	const currentTime = moment().format("HH:mm");
	const parsed = parseTaskLine(lineText);

	let newLineText: string;

	if (parsed?.kind === "range" && parsed.start !== undefined) {
		const sAbs = absoluteFlag(parsed.startAbsolute);
		const eAbs = absoluteFlag(parsed.endAbsolute);
		newLineText = `${parsed.indent}- [x] ${sAbs}${parsed.start} - ${currentTime}${eAbs} ${parsed.content}`;
	} else if (parsed?.kind === "startOnly" && parsed.start !== undefined) {
		const sAbs = absoluteFlag(parsed.startAbsolute);
		newLineText = `${parsed.indent}- [x] ${sAbs}${parsed.start} - ${currentTime} ${parsed.content}`;
	} else if (parsed) {
		// endOnly / relative / task / bullet: no usable start time, so record an
		// end-only range: "- [x] - hh:mm".
		newLineText = `${parsed.indent}- [x] - ${currentTime} ${parsed.content}`;
	} else {
		// Plain text (no list marker).
		const content = lineText.trim();
		const indent = lineText.match(/^(\s*)/)?.[1] ?? "";
		newLineText = content
			? `${indent}- [x] - ${currentTime} ${content}`
			: `${indent}- [x] - ${currentTime} `;
	}

	editor.setLine(lineIndex, newLineText);
}

/**
 * Start a task "now": set the current time as its start time, branching on the
 * shape of the current line.
 *  - Range task ("- 11:00 - 12:00")     -> shift both ends, keeping the duration.
 *  - Relative duration ("- 10m Task")   -> now .. now+duration absolute range.
 *  - Start-only task ("- 11:00 Task")   -> replace the start time with now.
 *  - Task with checkbox but no time     -> add the start time, keep the checkbox.
 *  - Plain bullet / plain text          -> turn it into a task with the start time.
 * Existing checkbox state and "!" absolute flags are preserved.
 */
export function startThisTaskNow(editor: Editor) {
	const cursor = editor.getCursor();
	const lineIndex = cursor.line;
	const lineText = editor.getLine(lineIndex);

	const currentTime = moment().format("HH:mm");
	const parsed = parseTaskLine(lineText);

	let newLineText: string;

	if (
		parsed?.kind === "range" &&
		parsed.start !== undefined &&
		parsed.end !== undefined
	) {
		// Shift both ends to keep the original duration.
		const start = moment(parsed.start, "HH:mm");
		const end = moment(parsed.end, "HH:mm");
		let durationMin = end.diff(start, "minutes");
		if (durationMin < 0) durationMin += 24 * 60; // treat as overnight range

		const newEnd = moment().add(durationMin, "minutes").format("HH:mm");
		const cb = buildCheckboxPrefix(parsed.check);
		const sAbs = absoluteFlag(parsed.startAbsolute);
		const eAbs = absoluteFlag(parsed.endAbsolute);
		newLineText = `${parsed.indent}- ${cb}${sAbs}${currentTime} - ${newEnd}${eAbs} ${parsed.content}`;
	} else if (
		parsed?.kind === "relative" &&
		parsed.durationMinutes !== undefined
	) {
		// Expand "10m" into an absolute range now .. now+duration.
		const endStr = moment()
			.add(parsed.durationMinutes, "minutes")
			.format("HH:mm");
		const cb = buildCheckboxPrefix(parsed.check);
		const sAbs = absoluteFlag(parsed.startAbsolute);
		newLineText = `${parsed.indent}- ${cb}${sAbs}${currentTime} - ${endStr} ${parsed.content}`;
	} else if (parsed?.kind === "endOnly" && parsed.end !== undefined) {
		// Give the "…until HH:MM" task a real start (now), keeping the planned end.
		const cb = buildCheckboxPrefix(parsed.check);
		const eAbs = absoluteFlag(parsed.endAbsolute);
		newLineText = `${parsed.indent}- ${cb}${currentTime} - ${parsed.end}${eAbs} ${parsed.content}`;
	} else if (parsed?.kind === "startOnly") {
		// Replace the start time with now.
		const cb = buildCheckboxPrefix(parsed.check);
		const sAbs = absoluteFlag(parsed.startAbsolute);
		newLineText = `${parsed.indent}- ${cb}${sAbs}${currentTime} ${parsed.content}`;
	} else if (parsed?.kind === "task") {
		// Checkbox but no time: add the start time, keep the checkbox.
		const cb = buildCheckboxPrefix(parsed.check);
		newLineText = `${parsed.indent}- ${cb}${currentTime} ${parsed.content}`;
	} else if (parsed?.kind === "bullet") {
		// Plain bullet: turn it into a timed task.
		newLineText = `${parsed.indent}- [ ] ${currentTime} ${parsed.content}`;
	} else {
		// Plain text (no list marker).
		const content = lineText.trim();
		const indent = lineText.match(/^(\s*)/)?.[1] ?? "";
		newLineText = content
			? `${indent}- [ ] ${currentTime} ${content}`
			: `${indent}- [ ] ${currentTime} `;
	}

	editor.setLine(lineIndex, newLineText);
}

function parseMarkdownAndWikiLinks(
	text: string,
	parentEl: HTMLElement,
	app: App,
	currentFilePath: string,
) {
	const regex =
		/(\[\[[^\]]+\]\]|\*\*[^*]+\*\*|\*[^*]+\*|~~[^~]+~~|`[^`]+`|==[^=]+==)/g;
	const parts = text.split(regex);

	for (const part of parts) {
		if (!part) continue;

		if (part.startsWith("[[") && part.endsWith("]]")) {
			const content = part.slice(2, -2);
			const pipeIndex = content.indexOf("|");
			let linkPath = content;
			let displayText = content;

			if (pipeIndex !== -1) {
				linkPath = content.substring(0, pipeIndex).trim();
				displayText = content.substring(pipeIndex + 1).trim();
			}

			const linkEl = parentEl.createEl("a", {
				cls: "internal-link",
				text: displayText,
			});
			linkEl.addEventListener("click", async (e) => {
				e.stopPropagation();
				await app.workspace.openLinkText(linkPath, currentFilePath);
			});
			continue;
		}

		if (part.startsWith("**") && part.endsWith("**")) {
			parentEl.createEl("strong", { text: part.slice(2, -2) });
			continue;
		}

		if (part.startsWith("*") && part.endsWith("*")) {
			parentEl.createEl("em", { text: part.slice(1, -1) });
			continue;
		}

		if (part.startsWith("~~") && part.endsWith("~~")) {
			parentEl.createEl("del", { text: part.slice(2, -2) });
			continue;
		}

		if (part.startsWith("`") && part.endsWith("`")) {
			parentEl.createEl("code", {
				text: part.slice(1, -1),
				cls: "cm-inline-code",
			});
			continue;
		}

		if (part.startsWith("==") && part.endsWith("==")) {
			parentEl.createEl("span", {
				text: part.slice(2, -2),
				cls: "cm-highlight",
			});
			continue;
		}

		parentEl.createSpan({ text: part });
	}
}
