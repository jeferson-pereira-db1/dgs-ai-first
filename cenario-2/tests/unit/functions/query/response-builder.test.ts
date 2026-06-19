import { describe, expect, it } from "vitest";

import { buildAssistantResponse } from "../../../../src/functions/query/response-builder";

describe("buildAssistantResponse", () => {
	it("should return high confidence response without warning", () => {
		const result = buildAssistantResponse("Resposta", [
			{
				documentId: "DOC-1",
				sourceDocument: "DOC-1, seção 1",
				section: "1",
				status: "vigente",
				content: "Conteúdo",
				score: 0.9,
			},
		]);

		expect(result).toEqual({
			answer: "Resposta",
			source_document: "DOC-1, seção 1",
			confidence: "high",
			escalation_recommended: false,
		});
	});

	it("should return medium confidence response with warning", () => {
		const result = buildAssistantResponse("Resposta", [
			{
				documentId: "DOC-2",
				sourceDocument: "DOC-2, seção 2",
				section: "2",
				status: "vigente",
				content: "Conteúdo",
				score: 0.5,
			},
		]);

		expect(result.confidence).toBe("medium");
		expect(result.low_confidence_warning).toBeDefined();
		expect(result.escalation_recommended).toBe(false);
	});

	it("should return low confidence and not_found source when chunks are empty", () => {
		const result = buildAssistantResponse("Sem contexto", []);

		expect(result).toEqual({
			answer: "Sem contexto",
			source_document: "not_found",
			confidence: "low",
			low_confidence_warning:
				"A resposta tem baixa confiança. Verifique o documento fonte ou escale para especialista.",
			escalation_recommended: true,
		});
	});
});
