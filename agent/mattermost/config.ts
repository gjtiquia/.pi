import { fileURLToPath } from "node:url";

/** Bot credentials shared by the independent Mattermost extensions. */
export interface MattermostConfig {
	url: string;
	token: string;
	channelId?: string;
}

const envPath = fileURLToPath(new URL("./.env", import.meta.url));

export function loadMattermostEnv(): Error | undefined {
	try {
		process.loadEnvFile(envPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") return error as Error;
	}
}

export function readMattermostConfig(): MattermostConfig | undefined {
	const url = process.env.MATTERMOST_URL?.replace(/\/+$/, "");
	const token = process.env.MATTERMOST_BOT_TOKEN;
	if (!url || !token) return;
	return { url, token, channelId: process.env.MATTERMOST_CHANNEL_ID || undefined };
}
