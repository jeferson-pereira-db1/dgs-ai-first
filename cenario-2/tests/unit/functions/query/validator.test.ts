import { describe, expect, it } from "vitest";

import { ValidationError } from "../../../../src/shared/errors";
import { validateQueryPayload } from "../../../../src/functions/query/validator";

describe("validateQueryPayload", () => {
	it("should return parsed payload when query is valid", () => {
		const result = validateQueryPayload({
			query: "  prazo para cliente gold  ",
			conversationId: "conv-1",
			userId: "user-1",
		});

		expect(result).toEqual({
			query: "prazo para cliente gold",
			conversationId: "conv-1",
			userId: "user-1",
		});
	});

	it("should throw ValidationError when query is missing", () => {
		expect(() => validateQueryPayload({})).toThrowError(ValidationError);
	});

	it("should throw ValidationError when query has less than 3 chars", () => {
		expect(() => validateQueryPayload({ query: "ab" })).toThrowError(ValidationError);
	});
});
