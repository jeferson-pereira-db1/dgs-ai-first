# SKILL: azure-functions-endpoint

**Nível:** Domain
**Frase de ativação:** "crie um endpoint" / "gere uma Azure Function" / "implemente o handler de"
**Quem cria:** Tech Lead
**Quem consome:** Dev Pleno, Dev Sênior, GitHub Copilot
**Frequência de uso:** Alta — todo endpoint do projeto usa este padrão
**Dependências:** `skills/foundation/typescript-conventions.md`, `skills/foundation/error-handling.md`

---

## Contexto

Todo endpoint deste projeto é uma Azure Function v4 com HTTP trigger. O padrão abaixo garante:
- Validação de input antes de qualquer processamento
- Logging estruturado rastreável por `queryId`
- Error handling tipado com HTTP codes corretos
- Schema de resposta consistente com o que o bot do Teams e o painel web esperam

Antes de gerar código com este padrão, leia:
- `AGENTS.md` — seção Tech Stack & Architecture (orçamento de contexto obrigatório)
- `skills/foundation/error-handling.md` — retry, custom errors, HTTP codes

---

## Estrutura obrigatória de um endpoint

Todo handler DEVE ter estas 5 seções na ordem abaixo:

```
1. Geração de queryId único
2. Log de entrada (info)
3. Validação de input (Zod) → lança ValidationError se inválido
4. Lógica de negócio (em bloco try/catch) → lança erros tipados
5. Retorno com schema AssistantResponse
```

---

## DO — Exemplos corretos

### Endpoint completo (template)

```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { z } from "zod";
import { logger } from "@/shared/logger";
import { ValidationError, SearchError } from "@/shared/errors";
import type { AssistantResponse } from "@/shared/types";
import { config } from "@/shared/config";

// Schema de input — declare fora do handler para reaproveitar em testes
const QueryInputSchema = z.object({
  question: z.string().min(1).max(1000),
  session_id: z.string().uuid().optional(),
});

export type QueryInput = z.infer<typeof QueryInputSchema>;

export async function queryHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const queryId = crypto.randomUUID();

  // 1. Log de entrada — sempre com queryId para rastreabilidade
  logger.info({ queryId, method: request.method }, "query request received");

  // 2. Validação de input
  let input: QueryInput;
  try {
    input = QueryInputSchema.parse(await request.json());
  } catch (err) {
    logger.warn({ err, queryId }, "input validation failed");
    throw new ValidationError("Invalid request body", { queryId, cause: err });
  }

  // 3. Lógica de negócio — em try/catch separado do de validação
  try {
    // Chamadas externas ficam aqui (ver skills/foundation/error-handling.md para retry)
    const response: AssistantResponse = await processQuery(input, queryId);

    logger.info({ queryId, confidence: response.confidence }, "query processed");
    return { status: 200, jsonBody: response };
  } catch (err) {
    // Erros de serviço Azure → 502, nunca 500
    logger.error({ err, queryId }, "upstream service failed");
    throw new SearchError("Upstream service unavailable", { queryId, cause: err });
  }
}

// Registrar o endpoint — authLevel "function" é o padrão; use "anonymous" só em dev local
app.http("query", {
  methods: ["POST"],
  authLevel: "function",
  route: "query",
  handler: queryHandler,
});
```

### Schema de resposta (AssistantResponse)

```typescript
// src/shared/types.ts — nunca inventar campos além destes

export interface AssistantResponse {
  answer: string;
  source_document: string;           // "PROC-042-v2, seção 4.1" ou "not_found" — NUNCA string vazia
  confidence: "high" | "medium" | "low";
  low_confidence_warning?: string;   // presente apenas quando confidence !== "high"
  escalation_recommended: boolean;
}
```

### Validação de output com Zod

```typescript
// Validar a resposta antes de retornar ao cliente
const AssistantResponseSchema = z.object({
  answer: z.string().min(1),
  source_document: z.string().min(1),  // proíbe string vazia em runtime
  confidence: z.enum(["high", "medium", "low"]),
  low_confidence_warning: z.string().optional(),
  escalation_recommended: z.boolean(),
});

const validated = AssistantResponseSchema.parse(rawResponse);
```

---

## DON'T — Anti-padrões comuns gerados por IA

### ✗ Usando `any` para o body da request

```typescript
// ERRADO — any perde a garantia de tipo em todo o fluxo
const body = await request.json() as any;
const question = body.question; // undefined silencioso se campo mudar
```

### ✗ Usando `console.log` ou `context.log`

```typescript
// ERRADO — context.log é da Azure mas não tem estrutura; console.log é proibido
context.log("Request received");
console.log("question:", question);

// CORRETO
logger.info({ queryId }, "query received");
```

### ✗ `source_document` como string vazia

```typescript
// ERRADO — viola o contrato do schema; quebra o bot do Teams
return {
  status: 200,
  jsonBody: {
    answer: "Não encontrei informação.",
    source_document: "",  // ← proibido
  }
};

// CORRETO — quando não há fonte, valor é "not_found"
source_document: "not_found"
```

### ✗ HTTP 500 para erros de serviço externo

```typescript
// ERRADO — 500 implica bug no nosso código; Azure Search falhou, não nós
return { status: 500, body: "Internal server error" };

// CORRETO — 502 para falha de upstream
throw new SearchError("Azure AI Search unavailable", { queryId });
// O error handler do framework converte para { status: 502, ... }
```

### ✗ Validação manual sem Zod

```typescript
// ERRADO — validação manual é frágil e inconsistente
if (!body.question || typeof body.question !== "string") {
  return { status: 400, body: "Question required" };
}

// CORRETO — Zod com schema declarativo
const input = QueryInputSchema.parse(await request.json());
// Parse lança ZodError que o error handler converte para 400 automaticamente
```

### ✗ `authLevel: "anonymous"` em código de produção

```typescript
// ERRADO — expõe o endpoint sem autenticação
app.http("query", { authLevel: "anonymous", ... });

// CORRETO — "function" exige API key gerenciada pelo Azure
app.http("query", { authLevel: "function", ... });
// Para dev local, configure local.settings.json — não mude o authLevel
```

### ✗ Lógica de negócio dentro do handler

```typescript
// ERRADO — handler com > 40 linhas; difícil testar a lógica isolada
export async function queryHandler(request, context) {
  const body = await request.json();
  // ... 80 linhas de embedding + search + prompt building + LLM call
}

// CORRETO — handler é orquestrador; lógica vai em services
export async function queryHandler(request, context) {
  const input = QueryInputSchema.parse(await request.json());
  const response = await queryService.process(input, queryId);
  return { status: 200, jsonBody: response };
}
```

---

## Anti-padrões específicos de IA (o que LLMs geram sem guidance)

| Anti-padrão | Por que LLMs fazem isso | Como prevenir |
|-------------|------------------------|---------------|
| `any` no body da request | `request.json()` retorna `unknown` — LLM faz cast por "conveniência" | AGENTS.md proíbe explicitamente + Zod mostra o caminho |
| `console.log` em vez de pino | `console.log` é o default de JS — LLM não sabe que há alternativa | Mostrar import do logger no exemplo |
| try/catch único para validação e negócio | LLM "otimiza" em um bloco só | Explicar que HTTP 400 e 502 exigem catch separados |
| `source_document: ""` em placeholder | LLM não lê o schema completo quando está "preenchendo" | Colocar `AssistantResponse` como interface explícita na seção Architecture do AGENTS.md |
| `authLevel: "anonymous"` | LLM tende a facilitar o teste local | Explicar que local.settings.json resolve sem mudar authLevel |
| Handler com 100+ linhas | LLM coloca tudo em um lugar quando não há skill de serviços | Mostrar padrão de delegação para `queryService` |

---

## Estrutura de arquivos para um novo endpoint

```
src/functions/[nome-do-endpoint]/
├── handler.ts          # HTTP trigger (este padrão)
├── validator.ts        # Schemas Zod de input/output
└── response-builder.ts # Montagem da AssistantResponse
```

O handler importa `validator.ts` e `response-builder.ts`. Nunca coloca schemas Zod inline no handler.

---

## Checklist antes de submeter PR

- [ ] `queryId` gerado com `crypto.randomUUID()` na primeira linha
- [ ] `logger.info` no início e no fim do handler (entrada e resultado)
- [ ] Validação de input com Zod em try/catch separado
- [ ] `source_document` nunca undefined, null, ou string vazia
- [ ] Erros de validação relançados como `ValidationError` (→ 400)
- [ ] Erros de Azure relançados como `SearchError` ou `CompletionError` (→ 502)
- [ ] `authLevel: "function"` (não "anonymous")
- [ ] Handler com menos de 40 linhas — lógica em serviços
- [ ] Schema Zod declarado fora do handler (para reuso em testes)
