import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type ActiveTrackingTask,
	calculateElapsedTime,
	calculatePlannedTime,
	extractActiveTrackingTasks,
	isTasksEqual,
} from "../src/features/daily-note/dailyNote";

// Pin "now" to 2026-07-13 10:45 (local) for deterministic time math.
beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date(2026, 6, 13, 10, 45, 0));
});

afterEach(() => {
	vi.useRealTimers();
});

const WARNING = 30; // minutes
const UPCOMING = 15; // minutes

function extract(content: string): ActiveTrackingTask[] {
	return extractActiveTrackingTasks(content, WARNING, UPCOMING);
}

describe("extractActiveTrackingTasks", () => {
	describe("start-only tasks", () => {
		it("marks a started task past the warning threshold as not active", () => {
			// started 45m ago (>= 30) -> isRangeActive false
			expect(extract("- 10:00 Task A")).toEqual([
				{
					taskText: "Task A",
					startTime: "10:00",
					lineNumber: 0,
					isRangeActive: false,
					isCompleted: false,
					isStartAbsolute: false,
				},
			]);
		});

		it("marks a recently started task within the threshold as active", () => {
			// started 15m ago (< 30) -> isRangeActive true
			expect(extract("- 10:30 Task")[0]).toMatchObject({
				startTime: "10:30",
				isRangeActive: true,
			});
		});

		it("captures the start ! flag", () => {
			expect(extract("- !10:00 Task")[0]).toMatchObject({
				isStartAbsolute: true,
			});
		});
	});

	describe("range tasks", () => {
		it("marks a range active while now is inside it", () => {
			expect(extract("- 10:30 - 11:00 Meeting")[0]).toMatchObject({
				startTime: "10:30",
				endTime: "11:00",
				isRangeActive: true,
				isCompleted: false,
			});
		});

		it("keeps a started-but-past range, flagged inactive", () => {
			expect(extract("- 10:00 - 10:30 Earlier")[0]).toMatchObject({
				endTime: "10:30",
				isRangeActive: false,
			});
		});

		it("shows an upcoming range within the upcoming threshold", () => {
			// starts at 11:00, upcoming window opens at 10:45 -> upcoming now
			expect(extract("- 11:00 - 12:00 Soon")[0]).toMatchObject({
				isUpcoming: true,
				isRangeActive: false,
			});
		});

		it("hides a range beyond the upcoming threshold", () => {
			// starts 11:30, window opens 11:15 > now -> not shown
			expect(extract("- 11:30 - 12:00 Later")).toEqual([]);
		});

		it("captures both ! flags", () => {
			expect(extract("- !10:30 - 11:00! Fixed")[0]).toMatchObject({
				isStartAbsolute: true,
				isEndAbsolute: true,
			});
		});
	});

	describe("filtering", () => {
		it("skips completed tasks", () => {
			expect(extract("- [x] 10:00 - 11:00 Done")).toEqual([]);
		});

		it("skips relative, end-only, and untimed lines", () => {
			const content = [
				"- 10m Relative",
				"- - 11:00 EndOnly",
				"- [ ] No time",
				"- just a bullet",
			].join("\n");
			expect(extract(content)).toEqual([]);
		});

		it("skips tasks inside fenced code blocks", () => {
			const content = ["```", "- 10:00 In code", "```"].join("\n");
			expect(extract(content)).toEqual([]);
		});

		it("ignores non-standard checkbox statuses", () => {
			expect(extract("- [/] 10:00 In progress custom")).toEqual([]);
		});
	});

	it("sorts results by start time", () => {
		const content = ["- 10:40 Second", "- 10:20 First"].join("\n");
		expect(extract(content).map((t) => t.taskText)).toEqual([
			"First",
			"Second",
		]);
	});
});

describe("calculatePlannedTime", () => {
	it("formats a sub-hour range", () => {
		expect(calculatePlannedTime("10:30", "11:00")).toBe("30m");
	});

	it("formats a multi-hour range", () => {
		expect(calculatePlannedTime("09:00", "10:30")).toBe("1h30m");
	});

	it("handles an overnight range", () => {
		expect(calculatePlannedTime("23:30", "00:30")).toBe("1h0m");
	});
});

describe("calculateElapsedTime", () => {
	it("shows minutes elapsed since a past start", () => {
		expect(calculateElapsedTime("10:00")).toBe("45m");
	});

	it("shows hours and minutes for a longer elapsed time", () => {
		expect(calculateElapsedTime("09:00")).toBe("1h45m");
	});

	it("shows a negative countdown for a future start", () => {
		expect(calculateElapsedTime("11:00")).toBe("-15m");
		expect(calculateElapsedTime("12:30")).toBe("-1h45m");
	});

	it("uses end - start for a completed task", () => {
		expect(calculateElapsedTime("09:00", "10:00", true)).toBe("1h0m");
	});

	it("ignores the end time when not completed", () => {
		expect(calculateElapsedTime("10:00", "10:30", false)).toBe("45m");
	});
});

describe("isTasksEqual", () => {
	const base: ActiveTrackingTask = {
		taskText: "T",
		startTime: "10:00",
		lineNumber: 0,
		isRangeActive: true,
		isCompleted: false,
		isStartAbsolute: false,
	};

	it("returns true for structurally equal arrays", () => {
		expect(isTasksEqual([base], [{ ...base }])).toBe(true);
	});

	it("returns false for different lengths", () => {
		expect(isTasksEqual([base], [])).toBe(false);
	});

	it("returns false when a tracked field differs", () => {
		expect(isTasksEqual([base], [{ ...base, isStartAbsolute: true }])).toBe(
			false,
		);
	});
});
