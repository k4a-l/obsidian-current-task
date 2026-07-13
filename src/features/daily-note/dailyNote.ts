import moment from "moment";
import { type App, type Editor, MarkdownView, type TFile } from "obsidian";
import {
	getAllDailyNotes,
	getDailyNote,
	getDailyNoteSettings,
} from "obsidian-daily-notes-interface";

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
	const lines = content.split("\n");
	const now = moment();
	const todayStr = now.format("YYYY-MM-DD");

	// Pattern definitions for parsing tasks in daily note
	// 1. Range format: - [ ] (!)14:00 - 15:00(!) Task description (checkbox optional)
	const rangeRegex =
		/^\s*-\s*(?:\[\s*(?<checkbox>[xX\s])\s*\])?\s+(?<absStart>!)?(?<start>\d{2}:\d{2})\s*-\s*(?<end>\d{2}:\d{2})(?<absEnd>!)?(?<text>.*)$/;
	// 2. Start only format: - [ ] (!)14:00 Task description (checkbox optional, avoiding range pattern matching)
	const startOnlyRegex =
		/^\s*-\s*(?:\[\s*(?<checkbox>[xX\s])\s*\])?\s+(?<absStart>!)?(?<start>\d{2}:\d{2})(?!\s*-\s*\d{2}:\d{2})(?<text>.*)$/;

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

		const rangeMatch = line.match(rangeRegex);
		const startMatch = line.match(startOnlyRegex);

		if (
			rangeMatch?.groups &&
			rangeMatch.groups.start !== undefined &&
			rangeMatch.groups.end !== undefined &&
			rangeMatch.groups.text !== undefined
		) {
			const checkbox = rangeMatch.groups.checkbox
				? rangeMatch.groups.checkbox.trim()
				: "";
			const isCompleted = checkbox === "x" || checkbox === "X";
			if (isCompleted) continue;

			const startTimeStr = rangeMatch.groups.start;
			const endTimeStr = rangeMatch.groups.end;
			const taskText = rangeMatch.groups.text.trim();

			const start = moment(`${todayStr} ${startTimeStr}`, "YYYY-MM-DD HH:mm");
			const end = moment(`${todayStr} ${endTimeStr}`, "YYYY-MM-DD HH:mm");

			const isStarted = now.isSameOrAfter(start);
			const isWithinRange = now.isBetween(start, end, null, "[]");
			const isUpcoming =
				!isStarted &&
				now.isSameOrAfter(start.clone().subtract(upcomingThreshold, "minutes"));

			if (isStarted) {
				activeTasks.push({
					taskText,
					startTime: startTimeStr,
					endTime: endTimeStr,
					lineNumber: i,
					isRangeActive: isWithinRange,
					isCompleted: false,
					isStartAbsolute: !!rangeMatch.groups.absStart,
					isEndAbsolute: !!rangeMatch.groups.absEnd,
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
					isStartAbsolute: !!rangeMatch.groups.absStart,
					isEndAbsolute: !!rangeMatch.groups.absEnd,
				});
			}
		} else if (
			startMatch?.groups &&
			startMatch.groups.start !== undefined &&
			startMatch.groups.text !== undefined
		) {
			const checkbox = startMatch.groups.checkbox
				? startMatch.groups.checkbox.trim()
				: "";
			const isCompleted = checkbox === "x" || checkbox === "X";
			if (isCompleted) continue;

			const startTimeStr = startMatch.groups.start;
			const taskText = startMatch.groups.text.trim();

			const start = moment(`${todayStr} ${startTimeStr}`, "YYYY-MM-DD HH:mm");
			const isStarted = now.isSameOrAfter(start);

			const isUpcoming =
				!isStarted &&
				now.isSameOrAfter(start.clone().subtract(upcomingThreshold, "minutes"));

			if (isStarted) {
				const diffMinutes = now.diff(start, "minutes");
				const isWithinThreshold = diffMinutes < warningThreshold;

				activeTasks.push({
					taskText,
					startTime: startTimeStr,
					lineNumber: i,
					isRangeActive: isWithinThreshold,
					isCompleted: false,
					isStartAbsolute: !!startMatch.groups.absStart,
				});
			} else if (isUpcoming) {
				activeTasks.push({
					taskText,
					startTime: startTimeStr,
					lineNumber: i,
					isRangeActive: false,
					isCompleted: false,
					isUpcoming: true,
					isStartAbsolute: !!startMatch.groups.absStart,
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

export function completeThisTaskNow(editor: Editor) {
	const cursor = editor.getCursor();
	const lineIndex = cursor.line;
	const lineText = editor.getLine(lineIndex);

	const currentTime = moment().format("HH:mm");

	// Pattern definitions for line parsing
	const rangeRegex =
		/^(?<indent>\s*)-\s*(?:\[\s*.\s*\])?\s*(?<absStart>!)?(?<start>\d{2}:\d{2})\s*-\s*(?<end>\d{2}:\d{2})(?<absEnd>!)?\s*(?<content>.*)$/;
	const startOnlyRegex =
		/^(?<indent>\s*)-\s*(?:\[\s*.\s*\])?\s*(?<absStart>!)?(?<start>\d{2}:\d{2})\s*(?<content>.*)$/;
	const taskRegex = /^(?<indent>\s*)-\s*\[\s*.\s*\]\s*(?<content>.*)$/;
	const bulletRegex = /^(?<indent>\s*)-\s*(?<content>.*)$/;

	let newLineText = "";

	const rangeMatch = lineText.match(rangeRegex);
	const startMatch = lineText.match(startOnlyRegex);
	const taskMatch = lineText.match(taskRegex);
	const bulletMatch = lineText.match(bulletRegex);

	if (
		rangeMatch?.groups &&
		rangeMatch.groups.indent !== undefined &&
		rangeMatch.groups.start !== undefined &&
		rangeMatch.groups.content !== undefined
	) {
		const indent = rangeMatch.groups.indent;
		const startTime = rangeMatch.groups.start;
		const content = rangeMatch.groups.content;
		const absStart = rangeMatch.groups.absStart ?? "";
		const absEnd = rangeMatch.groups.absEnd ?? "";
		newLineText = `${indent}- [x] ${absStart}${startTime} - ${currentTime}${absEnd} ${content}`;
	} else if (
		startMatch?.groups &&
		startMatch.groups.indent !== undefined &&
		startMatch.groups.start !== undefined &&
		startMatch.groups.content !== undefined
	) {
		const indent = startMatch.groups.indent;
		const startTime = startMatch.groups.start;
		const content = startMatch.groups.content;
		const absStart = startMatch.groups.absStart ?? "";
		newLineText = `${indent}- [x] ${absStart}${startTime} - ${currentTime} ${content}`;
	} else if (
		taskMatch?.groups &&
		taskMatch.groups.indent !== undefined &&
		taskMatch.groups.content !== undefined
	) {
		const indent = taskMatch.groups.indent;
		const content = taskMatch.groups.content;
		// No start time exists, so record an end-only range: "- [x] - hh:mm"
		newLineText = `${indent}- [x] - ${currentTime} ${content}`;
	} else if (
		bulletMatch?.groups &&
		bulletMatch.groups.indent !== undefined &&
		bulletMatch.groups.content !== undefined
	) {
		const indent = bulletMatch.groups.indent;
		const content = bulletMatch.groups.content;
		newLineText = `${indent}- [x] - ${currentTime} ${content}`;
	} else {
		const content = lineText.trim();
		const indentMatch = lineText.match(/^(\s*)/);
		const indent = indentMatch?.[1] || "";
		if (content) {
			newLineText = `${indent}- [x] - ${currentTime} ${content}`;
		} else {
			newLineText = `${indent}- [x] - ${currentTime} `;
		}
	}

	editor.setLine(lineIndex, newLineText);
}

// Rebuild the checkbox prefix (e.g. "[x] ") from a captured checkbox char,
// preserving the original state. Returns "" when the task has no checkbox.
function buildCheckboxPrefix(check: string | undefined): string {
	return check !== undefined ? `[${check}] ` : "";
}

// Parse a relative duration token (e.g. "10m", "2h", "1h30m", "90m") into minutes.
function parseRelativeDurationToMinutes(dur: string): number {
	let total = 0;
	const h = dur.match(/(\d+)h/);
	const m = dur.match(/(\d+)m/);
	if (h?.[1]) total += parseInt(h[1], 10) * 60;
	if (m?.[1]) total += parseInt(m[1], 10);
	return total;
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

	// Ordered from most specific to least; range must precede start-only, and
	// time/duration patterns must precede the bare task/bullet fallbacks.
	const rangeRegex =
		/^(?<indent>\s*)-\s*(?:\[\s*(?<check>.)\s*\])?\s*(?<absStart>!)?(?<start>\d{2}:\d{2})\s*-\s*(?<end>\d{2}:\d{2})(?<absEnd>!)?\s*(?<content>.*)$/;
	const relativeRegex =
		/^(?<indent>\s*)-\s*(?:\[\s*(?<check>.)\s*\])?\s*(?<absStart>!)?(?<dur>\d+h\d+m|\d+h|\d+m)(?=\s|$)\s*(?<content>.*)$/;
	const startOnlyRegex =
		/^(?<indent>\s*)-\s*(?:\[\s*(?<check>.)\s*\])?\s*(?<absStart>!)?(?<start>\d{2}:\d{2})\s*(?<content>.*)$/;
	const taskRegex =
		/^(?<indent>\s*)-\s*\[\s*(?<check>.)\s*\]\s*(?<content>.*)$/;
	const bulletRegex = /^(?<indent>\s*)-\s*(?<content>.*)$/;

	const rangeMatch = lineText.match(rangeRegex);
	const relativeMatch = lineText.match(relativeRegex);
	const startMatch = lineText.match(startOnlyRegex);
	const taskMatch = lineText.match(taskRegex);
	const bulletMatch = lineText.match(bulletRegex);

	let newLineText = "";

	if (
		rangeMatch?.groups &&
		rangeMatch.groups.indent !== undefined &&
		rangeMatch.groups.start !== undefined &&
		rangeMatch.groups.end !== undefined &&
		rangeMatch.groups.content !== undefined
	) {
		const g = rangeMatch.groups;
		const start = moment(g.start, "HH:mm");
		const end = moment(g.end, "HH:mm");
		let durationMin = end.diff(start, "minutes");
		if (durationMin < 0) durationMin += 24 * 60; // treat as overnight range

		const newEnd = moment().add(durationMin, "minutes").format("HH:mm");
		const cb = buildCheckboxPrefix(g.check);
		const absStart = g.absStart ?? "";
		const absEnd = g.absEnd ?? "";
		newLineText = `${g.indent}- ${cb}${absStart}${currentTime} - ${newEnd}${absEnd} ${g.content}`;
	} else if (
		relativeMatch?.groups &&
		relativeMatch.groups.indent !== undefined &&
		relativeMatch.groups.dur !== undefined &&
		relativeMatch.groups.content !== undefined
	) {
		const g = relativeMatch.groups;
		const durationMin = parseRelativeDurationToMinutes(g.dur ?? "");
		const endStr = moment().add(durationMin, "minutes").format("HH:mm");
		const cb = buildCheckboxPrefix(g.check);
		const absStart = g.absStart ?? "";
		newLineText = `${g.indent}- ${cb}${absStart}${currentTime} - ${endStr} ${g.content}`;
	} else if (
		startMatch?.groups &&
		startMatch.groups.indent !== undefined &&
		startMatch.groups.start !== undefined &&
		startMatch.groups.content !== undefined
	) {
		const g = startMatch.groups;
		const cb = buildCheckboxPrefix(g.check);
		const absStart = g.absStart ?? "";
		newLineText = `${g.indent}- ${cb}${absStart}${currentTime} ${g.content}`;
	} else if (
		taskMatch?.groups &&
		taskMatch.groups.indent !== undefined &&
		taskMatch.groups.content !== undefined
	) {
		const g = taskMatch.groups;
		const cb = buildCheckboxPrefix(g.check);
		newLineText = `${g.indent}- ${cb}${currentTime} ${g.content}`;
	} else if (
		bulletMatch?.groups &&
		bulletMatch.groups.indent !== undefined &&
		bulletMatch.groups.content !== undefined
	) {
		const g = bulletMatch.groups;
		newLineText = `${g.indent}- [ ] ${currentTime} ${g.content}`;
	} else {
		const content = lineText.trim();
		const indentMatch = lineText.match(/^(\s*)/);
		const indent = indentMatch?.[1] ?? "";
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
