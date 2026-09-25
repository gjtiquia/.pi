import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadMattermostEnv, readMattermostConfig } from "../../mattermost/config.js";
import { readMattermostLink, readMattermostAttachment } from "./mattermost-reader.js";

export default function mattermostReadExtension(pi: ExtensionAPI): void {
	const envError = loadMattermostEnv();
	const config = readMattermostConfig();
	const credentials = () => {
		if (envError) throw envError;
		if (!config) throw new Error("Mattermost reader needs MATTERMOST_URL and MATTERMOST_BOT_TOKEN in agent/mattermost/.env");
		return config;
	};

	pi.registerTool({
		name: "read_mattermost_link",
		label: "Read Mattermost thread",
		description: "Read a Mattermost post permalink and its complete thread using the configured bot account. Lists file IDs for attachments; works even when remote mode is off.",
		promptGuidelines: ["Use read_mattermost_link when the user provides a Mattermost post permalink and asks about its contents."],
		parameters: Type.Object({ link: Type.String({ description: "Full Mattermost post permalink" }) }),
		async execute(_toolCallId, params, signal) {
			return readMattermostLink(credentials(), params.link, signal);
		},
	});

	pi.registerTool({
		name: "read_mattermost_attachment",
		label: "Read Mattermost attachment",
		description: "Read a text, PDF, or image attachment on a Mattermost post using the bot account. Use a file ID returned by read_mattermost_link.",
		parameters: Type.Object({
			link: Type.String({ description: "Full permalink to the post containing the attachment" }),
			fileId: Type.String({ description: "Attachment file ID listed by read_mattermost_link" }),
		}),
		async execute(_toolCallId, params, signal) {
			return readMattermostAttachment(credentials(), params.link, params.fileId, signal);
		},
	});
}
