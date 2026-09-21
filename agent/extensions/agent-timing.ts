import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

interface TimingData {
	startedAt: number;
	endedAt: number;
	elapsedMs: number;
}

function formatTimestamp(timestamp: number): string {
	const date = new Date(timestamp);
	const pad = (value: number) => String(value).padStart(2, "0");

	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatDuration(milliseconds: number): string {
	const totalSeconds = Math.floor(milliseconds / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	const pad = (value: number) => String(value).padStart(2, "0");

	return `${hours}hr ${pad(minutes)}min ${pad(seconds)}sec`;
}

function formatWorkingDuration(milliseconds: number): string {
	const totalSeconds = Math.floor(milliseconds / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	const pad = (value: number) => String(value).padStart(2, "0");

	if (hours > 0) return `${hours}hr ${pad(minutes)}min ${pad(seconds)}sec`;
	if (minutes > 0) return `${minutes}min ${pad(seconds)}sec`;
	return `${seconds}sec`;
}

export default function (pi: ExtensionAPI) {
	let startedAt: number | undefined;
	let monotonicStart: number | undefined;
	let workingTimer: ReturnType<typeof setInterval> | undefined;

	pi.registerEntryRenderer<TimingData>("agent-timing", (entry, _options, theme) => {
		if (!entry.data) return new Text("", 0, 0);

		const { startedAt, endedAt, elapsedMs } = entry.data;
		const line = `⏱ ${formatTimestamp(startedAt)} → ${formatTimestamp(endedAt)} · elapsed ${formatDuration(elapsedMs)}`;
		return new Text(theme.fg("dim", line), 0, 0);
	});

	pi.on("agent_start", (_event, ctx) => {
		if (startedAt !== undefined) return;
		startedAt = Date.now();
		monotonicStart = performance.now();

		const updateWorkingMessage = () => {
			if (monotonicStart === undefined) return;
			ctx.ui.setWorkingMessage(`Working for ${formatWorkingDuration(performance.now() - monotonicStart)}...`);
		};

		updateWorkingMessage();
		workingTimer = setInterval(updateWorkingMessage, 1000);
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (workingTimer) clearInterval(workingTimer);
		workingTimer = undefined;
		ctx.ui.setWorkingMessage();

		if (startedAt === undefined || monotonicStart === undefined) return;

		pi.appendEntry<TimingData>("agent-timing", {
			startedAt,
			endedAt: Date.now(),
			elapsedMs: performance.now() - monotonicStart,
		});

		startedAt = undefined;
		monotonicStart = undefined;
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (workingTimer) clearInterval(workingTimer);
		workingTimer = undefined;
		ctx.ui.setWorkingMessage();
	});
}
