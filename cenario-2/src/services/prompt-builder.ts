import type { RetrievedChunk } from "../shared/types";

export interface PromptBuildResult {
	systemPrompt: string;
	userPrompt: string;
}

export function buildPrompt(query: string, chunks: RetrievedChunk[]): PromptBuildResult {
	const context = chunks
		.map((chunk, index) => {
			return `[${index + 1}] ${chunk.sourceDocument}\n${chunk.content}`;
		})
		.join("\n\n");

	return {
		systemPrompt:
			"Você é o assistente NovaTech. Responda em português formal, com base apenas no contexto fornecido.",
		userPrompt: `Pergunta: ${query}\n\nContexto:\n${context}`,
	};
}

