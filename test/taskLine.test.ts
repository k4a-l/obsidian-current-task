import { describe, expect, it } from "vitest";
import {
	absoluteFlag,
	buildCheckboxPrefix,
	parseRelativeDurationToMinutes,
	parseTaskLine,
} from "../src/features/daily-note/taskLine";

describe("parseTaskLine", () => {
	describe("range", () => {
		it("parses a plain range", () => {
			expect(parseTaskLine("- 11:00 - 12:00 Task")).toMatchObject({
				kind: "range",
				indent: "",
				content: "Task",
				start: "11:00",
				end: "12:00",
			});
		});

		it("captures checkbox and both ! flags", () => {
			expect(parseTaskLine("- [x] !11:00 - 12:00! Task")).toMatchObject({
				kind: "range",
				check: "x",
				start: "11:00",
				end: "12:00",
				startAbsolute: true,
				endAbsolute: true,
			});
		});

		it("preserves indentation", () => {
			expect(parseTaskLine("\t\t- 09:00 - 10:00 X")).toMatchObject({
				kind: "range",
				indent: "\t\t",
			});
		});
	});

	describe("relative duration", () => {
		it("parses minutes", () => {
			expect(parseTaskLine("- 10m Task")).toMatchObject({
				kind: "relative",
				durationRaw: "10m",
				durationMinutes: 10,
				content: "Task",
			});
		});

		it("parses combined h/m", () => {
			expect(parseTaskLine("- 1h30m Task")).toMatchObject({
				kind: "relative",
				durationMinutes: 90,
			});
		});

		it("parses minutes >= 60", () => {
			expect(parseTaskLine("- 90m Task")).toMatchObject({
				kind: "relative",
				durationMinutes: 90,
			});
		});

		it("does not treat a word starting with digits as a duration", () => {
			expect(parseTaskLine("- 100meters run")).toMatchObject({
				kind: "bullet",
				content: "100meters run",
			});
		});
	});

	describe("end-only", () => {
		it("parses '- - HH:MM' as an end-only range", () => {
			const parsed = parseTaskLine("- - 12:00 Task");
			expect(parsed).toMatchObject({
				kind: "endOnly",
				end: "12:00",
				content: "Task",
			});
			expect(parsed?.start).toBeUndefined();
		});

		it("parses a completed end-only line", () => {
			expect(parseTaskLine("- [x] - 10:45 Done")).toMatchObject({
				kind: "endOnly",
				check: "x",
				end: "10:45",
				content: "Done",
			});
		});
	});

	describe("start-only", () => {
		it("parses a plain start time", () => {
			expect(parseTaskLine("- 09:00 Task")).toMatchObject({
				kind: "startOnly",
				start: "09:00",
				content: "Task",
			});
		});

		it("captures checkbox and start ! flag", () => {
			expect(parseTaskLine("- [ ] !09:00 Task")).toMatchObject({
				kind: "startOnly",
				check: " ",
				start: "09:00",
				startAbsolute: true,
			});
		});
	});

	describe("task / bullet / plain", () => {
		it("parses a checkbox task without a time", () => {
			expect(parseTaskLine("- [ ] Buy milk")).toMatchObject({
				kind: "task",
				check: " ",
				content: "Buy milk",
			});
		});

		it("parses a plain bullet", () => {
			expect(parseTaskLine("- note")).toMatchObject({
				kind: "bullet",
				content: "note",
			});
		});

		it("returns null for plain text without a list marker", () => {
			expect(parseTaskLine("Hello world")).toBeNull();
		});
	});
});

describe("helpers", () => {
	it("buildCheckboxPrefix", () => {
		expect(buildCheckboxPrefix(undefined)).toBe("");
		expect(buildCheckboxPrefix(" ")).toBe("[ ] ");
		expect(buildCheckboxPrefix("x")).toBe("[x] ");
	});

	it("absoluteFlag", () => {
		expect(absoluteFlag(true)).toBe("!");
		expect(absoluteFlag(false)).toBe("");
		expect(absoluteFlag(undefined)).toBe("");
	});

	it("parseRelativeDurationToMinutes", () => {
		expect(parseRelativeDurationToMinutes("10m")).toBe(10);
		expect(parseRelativeDurationToMinutes("2h")).toBe(120);
		expect(parseRelativeDurationToMinutes("1h30m")).toBe(90);
		expect(parseRelativeDurationToMinutes("90m")).toBe(90);
	});
});
