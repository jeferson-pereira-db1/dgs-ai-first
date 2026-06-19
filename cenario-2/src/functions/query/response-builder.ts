import type { AssistantResponse, ConfidenceLevel, RetrievedChunk } from "../../shared/types";

function computeConfidence(chunks: RetrievedChunk[]): ConfidenceLevel {
	const topScore = chunks[0]?.score ?? 0;

	if (topScore >= 0.75) {
		return "high";
	}

	if (topScore >= 0.4) {
		return "medium";
	}

	return "low";
}

export function buildAssistantResponse(answer: string, chunks: RetrievedChunk[]): AssistantResponse {
	const confidence = computeConfidence(chunks);

	if (confidence === "high") {
		return {
			answer,
			source_document: chunks[0]?.sourceDocument ?? "not_found",
			confidence,
			escalation_recommended: false,
		};
	}

	return {
		answer,
		source_document: chunks[0]?.sourceDocument ?? "not_found",
		confidence,
		low_confidence_warning:
			"A resposta tem baixa confiança. Verifique o documento fonte ou escale para especialista.",
		escalation_recommended: confidence === "low",
	};
}

