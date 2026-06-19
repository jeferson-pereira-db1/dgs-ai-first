import { buildAssistantResponse } from "./response-builder";
import { validateQueryPayload } from "./validator";
import { generateCompletion } from "../../services/completion";
import { buildPrompt } from "../../services/prompt-builder";
import { searchRelevantChunks } from "../../services/search";
import { CompletionError, SearchError, ValidationError } from "../../shared/errors";
import { logger } from "../../shared/logger";

export interface HttpRequestLike {
  method?: string;
  json: () => Promise<unknown>;
}

export interface HttpResponseLike {
  status: number;
  jsonBody: unknown;
}

export async function queryHandler(request: HttpRequestLike): Promise<HttpResponseLike> {
  try {
    if (request.method && request.method.toUpperCase() !== "POST") {
      return {
        status: 405,
        jsonBody: { error: "Method not allowed" },
      };
    }

    const payload = await request.json();
    const validatedPayload = validateQueryPayload(payload);

    const chunks = await searchRelevantChunks(validatedPayload.query);
    const prompt = buildPrompt(validatedPayload.query, chunks);
    const completion = await generateCompletion(validatedPayload.query, chunks);
    const response = buildAssistantResponse(completion.answer, chunks);

    logger.info(
      {
        query: validatedPayload.query,
        chunkCount: chunks.length,
        sourceDocument: response.source_document,
      },
      "query processed",
    );

    return {
      status: 200,
      jsonBody: {
        ...response,
        debug_prompt: prompt,
      },
    };
  } catch (error) {
    if (error instanceof ValidationError) {
      logger.warn({ err: error, details: error.details }, "request validation failed");
      return {
        status: 400,
        jsonBody: { error: error.message, details: error.details },
      };
    }

    if (error instanceof SearchError || error instanceof CompletionError) {
      logger.error({ err: error, details: error.details }, "query dependency failed");
      return {
        status: 502,
        jsonBody: { error: "Upstream dependency failed" },
      };
    }

    logger.error({ err: error }, "unexpected query handler error");
    return {
      status: 500,
      jsonBody: { error: "Internal server error" },
    };
  }
}
