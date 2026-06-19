export type ConfidenceLevel = "high" | "medium" | "low";

export interface QueryRequest {
	query: string;
	conversationId?: string;
	userId?: string;
}

export interface RetrievedChunk {
	documentId: string;
	sourceDocument: string;
	section: string;
	status: "vigente" | "obsoleto";
	content: string;
	score: number;
}

export interface AssistantResponse {
	answer: string;
	source_document: string;
	confidence: ConfidenceLevel;
	low_confidence_warning?: string;
	escalation_recommended: boolean;
}

