import { beforeEach, describe, expect, it, vi } from "vitest";

import { CompletionError, SearchError, ValidationError } from "../../../../src/shared/errors";

vi.mock("../../../../src/functions/query/validator", () => ({
	validateQueryPayload: vi.fn(),
}));

vi.mock("../../../../src/services/search", () => ({
	searchRelevantChunks: vi.fn(),
}));

vi.mock("../../../../src/services/prompt-builder", () => ({
	buildPrompt: vi.fn(),
}));

vi.mock("../../../../src/services/completion", () => ({
	generateCompletion: vi.fn(),
}));

vi.mock("../../../../src/functions/query/response-builder", () => ({
	buildAssistantResponse: vi.fn(),
}));

vi.mock("../../../../src/shared/logger", () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

import { queryHandler } from "../../../../src/functions/query/handler";
import { buildAssistantResponse } from "../../../../src/functions/query/response-builder";
import { validateQueryPayload } from "../../../../src/functions/query/validator";
import { generateCompletion } from "../../../../src/services/completion";
import { buildPrompt } from "../../../../src/services/prompt-builder";
import { searchRelevantChunks } from "../../../../src/services/search";
import { logger } from "../../../../src/shared/logger";

function createRequest(body: unknown, method = "POST") {
	return {
		method,
		json: async () => body,
	};
}

describe("queryHandler", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should return 405 when method is not POST", async () => {
		const response = await queryHandler(createRequest({}, "GET"));

		expect(response.status).toBe(405);
		expect(response.jsonBody).toEqual({ error: "Method not allowed" });
		expect(validateQueryPayload).not.toHaveBeenCalled();
	});

	it("should return 200 with response payload when processing succeeds", async () => {
		vi.mocked(validateQueryPayload).mockReturnValue({ query: "prazo gold" });
		vi.mocked(searchRelevantChunks).mockResolvedValue([
			{
				documentId: "SLA-2024",
				sourceDocument: "SLA-2024, tabela 1",
				section: "tabela-1",
				status: "vigente",
				content: "Clientes Gold possuem atendimento prioritário.",
				score: 0.8,
			},
		]);
		vi.mocked(buildPrompt).mockReturnValue({
			systemPrompt: "system",
			userPrompt: "user",
		});
		vi.mocked(generateCompletion).mockResolvedValue({
			answer: "Clientes Gold são priorizados em até 2h.",
		});
		vi.mocked(buildAssistantResponse).mockReturnValue({
			answer: "Clientes Gold são priorizados em até 2h.",
			source_document: "SLA-2024, tabela 1",
			confidence: "high",
			escalation_recommended: false,
		});

		const response = await queryHandler(createRequest({ query: "prazo gold" }));

		expect(response.status).toBe(200);
		expect(response.jsonBody).toEqual({
			answer: "Clientes Gold são priorizados em até 2h.",
			source_document: "SLA-2024, tabela 1",
			confidence: "high",
			escalation_recommended: false,
			debug_prompt: {
				systemPrompt: "system",
				userPrompt: "user",
			},
		});
		expect(logger.info).toHaveBeenCalled();
	});

	it("should return 400 when payload validation fails", async () => {
		vi.mocked(validateQueryPayload).mockImplementation(() => {
			throw new ValidationError("Invalid request payload", {
				issues: [{ path: "query", message: "required" }],
			});
		});

		const response = await queryHandler(createRequest({}));

		expect(response.status).toBe(400);
		expect(response.jsonBody).toEqual({
			error: "Invalid request payload",
			details: {
				issues: [{ path: "query", message: "required" }],
			},
		});
		expect(logger.warn).toHaveBeenCalled();
	});

	it("should return 502 when search dependency fails", async () => {
		vi.mocked(validateQueryPayload).mockReturnValue({ query: "frete especial" });
		vi.mocked(searchRelevantChunks).mockRejectedValue(new SearchError("search failed"));

		const response = await queryHandler(createRequest({ query: "frete especial" }));

		expect(response.status).toBe(502);
		expect(response.jsonBody).toEqual({ error: "Upstream dependency failed" });
		expect(logger.error).toHaveBeenCalled();
	});

	it("should return 502 when completion dependency fails", async () => {
		vi.mocked(validateQueryPayload).mockReturnValue({ query: "frete especial" });
		vi.mocked(searchRelevantChunks).mockResolvedValue([]);
		vi.mocked(buildPrompt).mockReturnValue({
			systemPrompt: "system",
			userPrompt: "user",
		});
		vi.mocked(generateCompletion).mockRejectedValue(new CompletionError("completion failed"));

		const response = await queryHandler(createRequest({ query: "frete especial" }));

		expect(response.status).toBe(502);
		expect(response.jsonBody).toEqual({ error: "Upstream dependency failed" });
	});

	it("should return 500 when an unexpected error happens", async () => {
		vi.mocked(validateQueryPayload).mockImplementation(() => {
			throw new Error("boom");
		});

		const response = await queryHandler(createRequest({ query: "qualquer" }));

		expect(response.status).toBe(500);
		expect(response.jsonBody).toEqual({ error: "Internal server error" });
		expect(logger.error).toHaveBeenCalled();
	});
});
