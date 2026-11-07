//#region src/replay.ts
const ANTIGRAVITY_REPLAY_VERSION = 1;
const MAX_SIGNATURE_LENGTH = 16384;
const MAX_BLOCKS = 128;
/** Keep only provider-issued signatures and bounded response facts. */
function createReplayState(model, family, finish, blocks) {
	const boundedBlocks = blocks.slice(0, MAX_BLOCKS).map((block) => {
		const signature = safeSignature(block.signature);
		return {
			kind: block.kind,
			...signature === void 0 ? {} : { signature }
		};
	});
	const boundedFinish = safeFinish(finish);
	return {
		response: {
			version: 1,
			provider: "google-antigravity",
			model: model.slice(0, 256),
			family,
			...boundedFinish === void 0 ? {} : { finish: boundedFinish }
		},
		blocks: boundedBlocks
	};
}
/** Validate replay metadata before it can affect a later private request. */
function compatibleReplayState(message, provider, model, blockKinds) {
	if (provider !== "google-antigravity" || message.role !== "assistant") return void 0;
	const provenance = isRecord(message.source) ? message.source : void 0;
	if (provenance !== void 0 && provenance.kind === "model" && (provenance.provider !== provider || provenance.model !== model)) return void 0;
	const value = isRecord(provenance?.replayState) ? provenance.replayState : isRecord(message.replayState) ? message.replayState : void 0;
	if (!isRecord(value) || !isRecord(value.response) || !Array.isArray(value.blocks)) return void 0;
	const family = value.response.family;
	if (value.response.version !== 1 || value.response.provider !== provider || value.response.model !== model || !isFamily(family) || value.blocks.length > MAX_BLOCKS) return void 0;
	const blocks = [];
	for (const item of value.blocks) {
		if (!isRecord(item) || typeof item.kind !== "string") continue;
		const kind = item.kind;
		const signature = typeof item.signature === "string" && safeSignature(item.signature) !== void 0 ? item.signature : void 0;
		blocks.push({
			kind,
			...signature === void 0 ? {} : { signature }
		});
	}
	if (blockKinds !== void 0 && (blocks.length !== blockKinds.length || blocks.some((block, index) => block.kind !== blockKinds[index]))) return void 0;
	const finish = value.response.finish === void 0 ? void 0 : safeFinish(value.response.finish);
	if (value.response.finish !== void 0 && finish === void 0) return void 0;
	return {
		response: {
			version: 1,
			provider: "google-antigravity",
			model,
			family,
			...finish === void 0 ? {} : { finish }
		},
		blocks
	};
}
/** Return the block family without allowing a model alias to cross families. */
function antigravityModelFamily(model) {
	const value = model.toLowerCase();
	if (value.includes("gemini")) return "gemini";
	if (value.includes("claude")) return "claude";
	if (value.includes("gpt-oss")) return "gpt-oss";
	return "unknown";
}
const CORE_TOOLS = /* @__PURE__ */ new Set([
	"read",
	"write",
	"edit",
	"pwsh",
	"bash",
	"glob",
	"grep",
	"read_page",
	"web_search",
	"web_fetch",
	"ask_user_question"
]);
/** Convert DSH schemas to the small function-declaration subset accepted privately. */
function sanitizeToolSchemas(tools) {
	if (tools === void 0) return [];
	return [...tools].sort((a, b) => {
		const aCore = CORE_TOOLS.has(a.name) ? 1 : 0;
		return (CORE_TOOLS.has(b.name) ? 1 : 0) - aCore;
	}).slice(0, 384).map((tool) => ({
		name: boundedName(tool.name),
		description: boundedText(tool.description, 4096),
		parameters: sanitizeSchema(tool.parameters)
	}));
}
function buildFunctionDeclarations(tools) {
	return sanitizeToolSchemas(tools).map((tool) => ({
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters
	}));
}
const ALLOWED_SCHEMA_TYPES = /* @__PURE__ */ new Set([
	"object",
	"array",
	"string",
	"number",
	"integer",
	"boolean",
	"null"
]);
function isNullBranch(branch) {
	if (!isRecord(branch)) return false;
	const t = typeof branch.type === "string" ? branch.type.toLowerCase() : void 0;
	return t === "null" || t === void 0 && branch.const === null;
}
function sanitizeSchema(value, depth = 0) {
	if (depth > 8 || !isRecord(value)) return {
		type: "object",
		properties: {}
	};
	let source = value;
	if (Array.isArray(source.allOf) && source.allOf.length > 0) {
		const mergedProps = isRecord(source.properties) ? { ...source.properties } : {};
		const mergedReq = new Set(Array.isArray(source.required) ? source.required.filter((r) => typeof r === "string") : []);
		for (const branch of source.allOf.slice(0, 8)) {
			if (!isRecord(branch)) continue;
			if (isRecord(branch.properties)) Object.assign(mergedProps, branch.properties);
			if (Array.isArray(branch.required)) {
				for (const req of branch.required) if (typeof req === "string") mergedReq.add(req);
			}
		}
		source = {
			...source,
			type: "object",
			properties: mergedProps,
			...mergedReq.size > 0 ? { required: [...mergedReq] } : {}
		};
	}
	const rawUnion = Array.isArray(source.anyOf) ? source.anyOf : Array.isArray(source.oneOf) ? source.oneOf : void 0;
	if (rawUnion !== void 0 && rawUnion.length > 0) {
		const nonNullBranches = rawUnion.filter((branch) => !isNullBranch(branch));
		const hadNullBranch = nonNullBranches.length < rawUnion.length;
		if (nonNullBranches.length === 1 && isRecord(nonNullBranches[0])) {
			const collapsed = sanitizeSchema({
				...typeof source.description === "string" ? { description: source.description } : {},
				...nonNullBranches[0]
			}, depth + 1);
			if (hadNullBranch) collapsed.nullable = true;
			return collapsed;
		}
		const allObjects = nonNullBranches.length > 0 && nonNullBranches.every((b) => isRecord(b) && (b.type === "object" || b.properties !== void 0));
		if (allObjects) {
			const mergedProps = {};
			for (const branch of nonNullBranches) {
				if (isRecord(branch.properties)) Object.assign(mergedProps, branch.properties);
			}
			const collapsed = sanitizeSchema({
				...typeof source.description === "string" ? { description: source.description } : {},
				type: "object",
				properties: mergedProps
			}, depth + 1);
			if (hadNullBranch || source.nullable === true) collapsed.nullable = true;
			return collapsed;
		}
		const firstBranch = nonNullBranches[0] ?? rawUnion[0];
		if (isRecord(firstBranch)) {
			const collapsed = sanitizeSchema({
				...typeof source.description === "string" ? { description: source.description } : {},
				...firstBranch
			}, depth + 1);
			if (hadNullBranch || source.nullable === true) collapsed.nullable = true;
			return collapsed;
		}
	}
	let explicitType;
	let nullable = source.nullable === true;
	if (typeof source.type === "string" && ALLOWED_SCHEMA_TYPES.has(source.type.toLowerCase())) explicitType = source.type.toLowerCase();
	else if (Array.isArray(source.type)) {
		const validTypes = [...new Set(source.type.filter((item) => typeof item === "string").map((item) => item.toLowerCase()).filter((item) => ALLOWED_SCHEMA_TYPES.has(item)))];
		const nonNull = validTypes.filter((item) => item !== "null");
		if (validTypes.includes("null") && nonNull.length > 0) nullable = true;
		explicitType = nonNull[0] ?? validTypes[0];
	}
	let enumValues;
	const hints = [];
	if (typeof source.const === "string" && source.const.length > 0 && !hasControl(source.const)) {
		enumValues = [source.const.slice(0, 256)];
		explicitType ??= "string";
	} else if (typeof source.const === "number" || typeof source.const === "boolean") {
		hints.push(`Must be ${String(source.const)}`);
		explicitType ??= typeof source.const;
	} else if (Array.isArray(source.enum)) {
		const rawEnum = source.enum.slice(0, 128).filter((item) => [
			"string",
			"number",
			"boolean"
		].includes(typeof item) && item !== "");
		if (rawEnum.length > 0) {
			if (rawEnum.every((item) => typeof item === "string" && !hasControl(item))) {
				enumValues = rawEnum.map((item) => item.slice(0, 256));
				explicitType ??= "string";
			} else hints.push(`Allowed values: ${rawEnum.map((item) => JSON.stringify(item)).join(", ")}`);
		}
	}
	const type = explicitType ?? (source.items !== void 0 ? "array" : "object");
	const output = { type };
	const baseDesc = typeof source.description === "string" ? boundedText(source.description, 1024) : "";
	const fullDesc = hints.length > 0 ? baseDesc ? `${baseDesc} (${hints.join("; ")})` : hints.join("; ") : baseDesc;
	if (fullDesc.length > 0) output.description = boundedText(fullDesc, 1024);
	if (nullable && type !== "null") output.nullable = true;
	if (enumValues !== void 0 && enumValues.length > 0) output.enum = enumValues;
	if (type === "object") {
		const properties = {};
		if (isRecord(source.properties)) {
			for (const [key, item] of Object.entries(source.properties).slice(0, 128)) if (!hasControl(key) && key.length > 0) properties[key.slice(0, 128)] = sanitizeSchema(item, depth + 1);
		}
		output.properties = properties;
		if (Array.isArray(source.required)) {
			const validRequired = source.required.filter((item) => typeof item === "string" && Object.prototype.hasOwnProperty.call(properties, item)).slice(0, 128);
			if (validRequired.length > 0) output.required = validRequired;
		}
	} else if (type === "array") output.items = source.items !== void 0 ? sanitizeSchema(source.items, depth + 1) : { type: "string" };
	return output;
}
function safeFinish(value) {
	if (typeof value !== "string" || value.length === 0 || value.length > 128) return void 0;
	const normalized = value.toUpperCase();
	return [
		"STOP",
		"MAX_TOKENS",
		"LENGTH",
		"TOOL_CALLS",
		"FUNCTION_CALL",
		"SAFETY",
		"BLOCKLIST",
		"ERROR"
	].includes(normalized) ? normalized : void 0;
}
function safeSignature(value) {
	if (typeof value !== "string" || value.length === 0 || value.length > MAX_SIGNATURE_LENGTH) return void 0;
	for (const character of value) {
		const code = character.charCodeAt(0);
		if (code < 32 || code === 127) return void 0;
	}
	return value;
}
function boundedName(value) {
	return typeof value === "string" && value.length > 0 && !hasControl(value) ? value.slice(0, 128) : "unnamed_tool";
}
function boundedText(value, limit) {
	return typeof value === "string" && !hasControl(value) ? value.slice(0, limit) : "";
}
function hasControl(value) {
	for (const character of value) {
		const code = character.charCodeAt(0);
		if (code < 32 || code === 127) return true;
	}
	return false;
}
function isFamily(value) {
	return value === "gemini" || value === "claude" || value === "gpt-oss" || value === "unknown";
}
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
//#endregion
export { ANTIGRAVITY_REPLAY_VERSION, antigravityModelFamily, buildFunctionDeclarations, compatibleReplayState, createReplayState, sanitizeSchema, sanitizeToolSchemas };
