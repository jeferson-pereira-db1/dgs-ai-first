import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";

import { queryHandler } from "./handler";

export async function queryEndpoint(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const result = await queryHandler({
    method: request.method,
    json: async () => request.json(),
  });

  return {
    status: result.status,
    jsonBody: result.jsonBody,
  };
}

app.http("novatech-query", {
  methods: ["POST"],
  authLevel: "function",
  route: "novatech/query",
  handler: queryEndpoint,
});
