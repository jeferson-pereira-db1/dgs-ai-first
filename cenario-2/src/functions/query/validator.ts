import { z } from "zod";

import { QUERY_CONFIG } from "../../shared/config";
import { ValidationError } from "../../shared/errors";
import type { QueryRequest } from "../../shared/types";

const queryRequestSchema = z.object({
	query: z
		.string({ required_error: "query is required" })
		.trim()
		.min(3, "query must contain at least 3 characters")
		.max(QUERY_CONFIG.maxQueryLength, "query exceeds allowed length"),
	conversationId: z.string().trim().min(1).optional(),
	userId: z.string().trim().min(1).optional(),
});

export function validateQueryPayload(payload: unknown): QueryRequest {
	const result = queryRequestSchema.safeParse(payload);

	if (!result.success) {
		throw new ValidationError("Invalid request payload", {
			issues: result.error.issues.map((issue) => ({
				path: issue.path.join("."),
				message: issue.message,
			})),
		});
	}

	return result.data;
}

