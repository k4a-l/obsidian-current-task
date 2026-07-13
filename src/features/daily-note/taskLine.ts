// Central grammar for the plugin's daily-note task lines.
//
// A single `parseTaskLine` recognises every supported line shape so the parser
// (banner) and the editor commands share one source of truth instead of each
// re-declaring near-identical regexes.
//
// Supported time notations (checkbox always optional):
//   - HH:MM - HH:MM   range          ("!14:00" / "15:00!" mark a fixed edge)
//   - Nh / Nm / NhNm  relative dur.   (e.g. "10m", "2h", "1h30m", "90m")
//   - HH:MM           start only
//   - - HH:MM         end only        (no start; "…until HH:MM")

export type TaskLineKind =
	| "range"
	| "relative"
	| "startOnly"
	| "endOnly"
	| "task"
	| "bullet";

export interface ParsedTaskLine {
	kind: TaskLineKind;
	indent: string;
	/** Checkbox character (e.g. " ", "x"); undefined when there is no checkbox. */
	check?: string;
	/** Task text after the time/duration token. */
	content: string;
	/** "HH:mm" start time (range, startOnly). */
	start?: string;
	/** "HH:mm" end time (range, endOnly). */
	end?: string;
	/** true when the start time carries the "!" fixed flag ("!14:00"). */
	startAbsolute?: boolean;
	/** true when the end time carries the "!" fixed flag ("15:00!"). */
	endAbsolute?: boolean;
	/** Duration in minutes for a relative-duration line ("10m" -> 10). */
	durationMinutes?: number;
	/** Raw duration token as written ("1h30m"). */
	durationRaw?: string;
}

// Ordered most-specific first. The first match wins, so range/relative/endOnly
// are tested before the bare start-only, task and bullet fall-throughs.
const PATTERNS: { kind: TaskLineKind; regex: RegExp }[] = [
	{
		kind: "range",
		regex:
			/^(?<indent>\s*)-\s*(?:\[\s*(?<check>.)\s*\])?\s*(?<startAbs>!)?(?<start>\d{2}:\d{2})\s*-\s*(?<end>\d{2}:\d{2})(?<endAbs>!)?\s*(?<content>.*)$/,
	},
	{
		kind: "relative",
		regex:
			/^(?<indent>\s*)-\s*(?:\[\s*(?<check>.)\s*\])?\s*(?<startAbs>!)?(?<dur>\d+h\d+m|\d+h|\d+m)(?=\s|$)\s*(?<content>.*)$/,
	},
	{
		kind: "endOnly",
		regex:
			/^(?<indent>\s*)-\s*(?:\[\s*(?<check>.)\s*\])?\s*-\s*(?<end>\d{2}:\d{2})(?<endAbs>!)?\s*(?<content>.*)$/,
	},
	{
		kind: "startOnly",
		regex:
			/^(?<indent>\s*)-\s*(?:\[\s*(?<check>.)\s*\])?\s*(?<startAbs>!)?(?<start>\d{2}:\d{2})\s*(?<content>.*)$/,
	},
	{
		kind: "task",
		regex: /^(?<indent>\s*)-\s*\[\s*(?<check>.)\s*\]\s*(?<content>.*)$/,
	},
	{
		kind: "bullet",
		regex: /^(?<indent>\s*)-\s*(?<content>.*)$/,
	},
];

/**
 * Parse a single line into its task shape, or null when it is not a list item
 * (e.g. plain text without a leading "-").
 */
export function parseTaskLine(line: string): ParsedTaskLine | null {
	for (const { kind, regex } of PATTERNS) {
		const m = line.match(regex);
		if (!m?.groups) continue;
		const g = m.groups;

		const parsed: ParsedTaskLine = {
			kind,
			indent: g.indent ?? "",
			check: g.check,
			content: g.content ?? "",
		};

		if (g.start !== undefined) parsed.start = g.start;
		if (g.end !== undefined) parsed.end = g.end;
		if (g.startAbs) parsed.startAbsolute = true;
		if (g.endAbs) parsed.endAbsolute = true;
		if (g.dur !== undefined) {
			parsed.durationRaw = g.dur;
			parsed.durationMinutes = parseRelativeDurationToMinutes(g.dur);
		}

		return parsed;
	}
	return null;
}

/**
 * Rebuild the checkbox prefix (e.g. "[x] ") from a captured checkbox char,
 * preserving the original state. Returns "" when the task has no checkbox.
 */
export function buildCheckboxPrefix(check: string | undefined): string {
	return check !== undefined ? `[${check}] ` : "";
}

/** Render the "!" fixed flag, or "" when the edge is not absolute. */
export function absoluteFlag(isAbsolute: boolean | undefined): string {
	return isAbsolute ? "!" : "";
}

/** Parse a relative duration token ("10m", "2h", "1h30m", "90m") into minutes. */
export function parseRelativeDurationToMinutes(dur: string): number {
	let total = 0;
	const h = dur.match(/(\d+)h/);
	const m = dur.match(/(\d+)m/);
	if (h?.[1]) total += parseInt(h[1], 10) * 60;
	if (m?.[1]) total += parseInt(m[1], 10);
	return total;
}
