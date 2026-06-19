import { CompletionError } from "../shared/errors";
import type { RetrievedChunk } from "../shared/types";

export interface CompletionResult {
	answer: string;
}

export async function generateCompletion(
	query: string,
	chunks: RetrievedChunk[],
): Promise<CompletionResult> {
	try {
		if (chunks.length === 0) {
			return {
				answer:
					"Não encontrei evidência suficiente na base vigente para responder com segurança. Recomendo escalar para o time responsável.",
			};
		}

		const bestChunk = chunks[0];

		return {
			answer: `Com base no documento ${bestChunk.sourceDocument}, ${bestChunk.content.toLowerCase()} Em caso de exceção operacional, encaminhe para a equipe especializada.`,
		};
	} catch (error) {
		throw new CompletionError("Failed to generate completion", {
			query,
			error: error instanceof Error ? error.message : "unknown",
		});
	}
}

