import type { Editor } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	completeThisTaskNow,
	startThisTaskNow,
} from "../src/features/daily-note/dailyNote";

// A minimal fake Editor operating on a single line, enough for the
// cursor-line based commands under test.
function makeEditor(line: string) {
	let current = line;
	const editor = {
		getCursor: () => ({ line: 0, ch: 0 }),
		getLine: () => current,
		setLine: (_lineIndex: number, text: string) => {
			current = text;
		},
	} as unknown as Editor;
	return {
		editor,
		result: () => current,
	};
}

// Run a command against `input` and return the resulting line.
function run(command: (editor: Editor) => void, input: string): string {
	const { editor, result } = makeEditor(input);
	command(editor);
	return result();
}

// Pin "now" to 2026-07-13 10:45 (local) so time-derived output is deterministic.
beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date(2026, 6, 13, 10, 45, 0));
});

afterEach(() => {
	vi.useRealTimers();
});

describe("setTaskStartTime", () => {
	describe("range task (shifts both ends, keeping duration)", () => {
		it("shifts a plain range", () => {
			expect(run(startThisTaskNow, "- 11:00 - 12:00 Task")).toBe(
				"- 10:45 - 11:45 Task",
			);
		});

		it("preserves checkbox and both ! flags", () => {
			expect(run(startThisTaskNow, "- [x] !11:00 - 12:00! Task")).toBe(
				"- [x] !10:45 - 11:45! Task",
			);
		});

		it("treats end < start as an overnight range", () => {
			// 23:30 -> 00:30 is a 60 minute span
			expect(run(startThisTaskNow, "- 23:30 - 00:30 Sleep")).toBe(
				"- 10:45 - 11:45 Sleep",
			);
		});
	});

	describe("relative duration (expands to now .. now+duration)", () => {
		it("handles minutes", () => {
			expect(run(startThisTaskNow, "- 10m Task")).toBe("- 10:45 - 10:55 Task");
		});

		it("handles hours", () => {
			expect(run(startThisTaskNow, "- 2h Task")).toBe("- 10:45 - 12:45 Task");
		});

		it("handles combined h/m", () => {
			expect(run(startThisTaskNow, "- 1h30m Task")).toBe(
				"- 10:45 - 12:15 Task",
			);
		});

		it("normalizes minutes >= 60", () => {
			expect(run(startThisTaskNow, "- 90m Task")).toBe("- 10:45 - 12:15 Task");
		});

		it("preserves checkbox and ! flag", () => {
			expect(run(startThisTaskNow, "- [ ] !2h Meeting")).toBe(
				"- [ ] !10:45 - 12:45 Meeting",
			);
		});
	});

	describe("start-only task (replaces the start time)", () => {
		it("replaces a plain start time", () => {
			expect(run(startThisTaskNow, "- 09:00 Task")).toBe("- 10:45 Task");
		});

		it("preserves checkbox and ! flag", () => {
			expect(run(startThisTaskNow, "- [ ] !09:00 Task")).toBe(
				"- [ ] !10:45 Task",
			);
		});
	});

	describe("non-timed lines (become timed tasks)", () => {
		it("adds a start time to a checkbox task, keeping its state", () => {
			expect(run(startThisTaskNow, "- [ ] Buy milk")).toBe(
				"- [ ] 10:45 Buy milk",
			);
		});

		it("keeps a completed checkbox as-is", () => {
			expect(run(startThisTaskNow, "- [x] Done thing")).toBe(
				"- [x] 10:45 Done thing",
			);
		});

		it("turns a plain bullet into a timed task", () => {
			expect(run(startThisTaskNow, "- Just a note")).toBe(
				"- [ ] 10:45 Just a note",
			);
		});

		it("turns plain text into a timed task", () => {
			expect(run(startThisTaskNow, "Hello world")).toBe(
				"- [ ] 10:45 Hello world",
			);
		});

		it("preserves indentation", () => {
			expect(run(startThisTaskNow, "\t- sub item")).toBe(
				"\t- [ ] 10:45 sub item",
			);
		});

		it("does not misread a word starting with digits as a duration", () => {
			expect(run(startThisTaskNow, "- 100meters run")).toBe(
				"- [ ] 10:45 100meters run",
			);
		});
	});
});

describe("toggleTaskTime (sets end time and completes)", () => {
	it("completes a range with the current time as the end", () => {
		expect(run(completeThisTaskNow, "- 09:00 - 12:00 Task")).toBe(
			"- [x] 09:00 - 10:45 Task",
		);
	});

	it("preserves ! flags when completing a range", () => {
		expect(run(completeThisTaskNow, "- [ ] !09:00 - 12:00! Task")).toBe(
			"- [x] !09:00 - 10:45! Task",
		);
	});

	it("completes a start-only task by adding the end time", () => {
		expect(run(completeThisTaskNow, "- 09:00 Task")).toBe(
			"- [x] 09:00 - 10:45 Task",
		);
	});

	it("preserves the ! flag on a start-only task", () => {
		expect(run(completeThisTaskNow, "- !09:00 Task")).toBe(
			"- [x] !09:00 - 10:45 Task",
		);
	});

	it("completes a checkbox task without a time as an end-only range", () => {
		expect(run(completeThisTaskNow, "- [ ] Buy milk")).toBe(
			"- [x] - 10:45 Buy milk",
		);
	});

	it("completes a plain bullet as an end-only range", () => {
		expect(run(completeThisTaskNow, "- note")).toBe("- [x] - 10:45 note");
	});

	it("completes plain text as an end-only range", () => {
		expect(run(completeThisTaskNow, "hello")).toBe("- [x] - 10:45 hello");
	});
});
