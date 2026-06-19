import { QUERY_CONFIG } from "../shared/config";
import { SearchError } from "../shared/errors";
import type { RetrievedChunk } from "../shared/types";

const retrievalCorpus: RetrievedChunk[] = [
	{
		documentId: "PROC-042-v2",
		sourceDocument: "PROC-042-v2, seção 4.1",
		section: "4.1",
		status: "vigente",
		content:
			"Para frete especial, o atendimento deve coletar peso, dimensões e categoria do item antes de abrir a cotação.",
		score: 0,
	},
	{
		documentId: "POL-001",
		sourceDocument: "POL-001, seção 2.3",
		section: "2.3",
		status: "vigente",
		content:
			"Devolução padrão não se aplica a cargas perigosas classes 1-6 da ANTT; nesses casos, escalar para operação especializada.",
		score: 0,
	},
	{
		documentId: "SLA-2024",
		sourceDocument: "SLA-2024, tabela 1",
		section: "tabela-1",
		status: "vigente",
		content:
			"Clientes Gold possuem atendimento prioritário em até 2 horas úteis para triagem inicial.",
		score: 0,
	},
	{
		documentId: "PROC-042-v1",
		sourceDocument: "PROC-042-v1, seção 4.1",
		section: "4.1",
		status: "obsoleto",
		content:
			"Versão antiga do processo de frete especial, mantida apenas para histórico.",
		score: 0,
	},
];

function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.normalize("NFD")
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter((token) => token.length > 2);
}

function scoreChunk(queryTokens: string[], chunkContent: string): number {
	if (queryTokens.length === 0) {
		return 0;
	}

	const chunkTokens = new Set(tokenize(chunkContent));
	const matchCount = queryTokens.reduce((acc, token) => {
		return chunkTokens.has(token) ? acc + 1 : acc;
	}, 0);

	return matchCount / queryTokens.length;
}

export async function searchRelevantChunks(query: string): Promise<RetrievedChunk[]> {
	try {
		const queryTokens = tokenize(query);

		const ranked = retrievalCorpus
			.filter((chunk) => chunk.status === "vigente")
			.map((chunk) => ({
				...chunk,
				score: scoreChunk(queryTokens, chunk.content),
			}))
			.filter((chunk) => chunk.score >= QUERY_CONFIG.minScoreThreshold)
			.sort((a, b) => b.score - a.score)
			.slice(0, QUERY_CONFIG.topK);

		return ranked;
	} catch (error) {
		throw new SearchError("Failed to retrieve relevant chunks", {
			error: error instanceof Error ? error.message : "unknown",
		});
	}
}

