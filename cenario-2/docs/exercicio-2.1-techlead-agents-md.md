# Exercício 2.1 — Construção e Teste do AGENTS.md (Tech Lead)

## Contexto

Esta fase exigiu escrever o AGENTS.md completo do repositório, testá-lo com GitHub Copilot (geração real de código) e iterar as seções que não produziram aderência.

---

## AGENTS.md v1 — Primeira versão

Escrita com base nas ADRs da fase anterior e na estrutura do Anexo C. Seções escritas pelo Tech Lead: Project Overview, Tech Stack & Architecture, Coding Standards, Build & Deploy.

**Omissões intencionais na v1** (aguardando outros papéis):
- Product Rules & Guardrails → Product Specialist
- Testing Standards → QA
- Project Management Rules → Delivery Manager

**Decisões incorporadas da ADR-0002 (obrigatórias):**
- Context budget explícito: ~4K system + ~8K chunks (top-5) + 1.5K histórico
- Regras de overflow em ordem de prioridade
- Proibição de cortar system prompt ou pergunta atual

---

## Teste com GitHub Copilot — Rodada 1 (AGENTS.md v1)

Com o AGENTS.md v1 presente no repositório, foram submetidos ao Copilot os prompts:

**Prompt A:** *"Gere um Azure Function endpoint para receber e processar queries do assistente NovaTech seguindo o AGENTS.md."*

**Prompt B:** *"Gere os testes para esse endpoint usando Vitest."*

### Output real do Copilot — handler.ts (Rodada 1)

```typescript
import { buildAssistantResponse } from "./response-builder";
import { validateQueryPayload } from "./validator";
import { generateCompletion } from "../../services/completion";
import { buildPrompt } from "../../services/prompt-builder";
import { searchRelevantChunks } from "../../services/search";
import { CompletionError, SearchError, ValidationError } from "../../shared/errors";
import { logger } from "../../shared/logger";

export async function queryHandler(request: HttpRequestLike): Promise<HttpResponseLike> {
  try {
    const payload = await request.json();
    const validatedPayload = validateQueryPayload(payload);

    const chunks = await searchRelevantChunks(validatedPayload.query);
    const prompt = buildPrompt(validatedPayload.query, chunks);
    const completion = await generateCompletion(validatedPayload.query, chunks);
    const response = buildAssistantResponse(completion.answer, chunks);

    logger.info({ query: validatedPayload.query, chunkCount: chunks.length }, "query processed");

    return {
      status: 200,
      jsonBody: {
        ...response,
        debug_prompt: prompt,  // ← campo não está em AssistantResponse
      },
    };
  } catch (error) {
    if (error instanceof ValidationError) {
      logger.warn({ err: error }, "validation failed");
      return { status: 400, jsonBody: { error: error.message, details: error.details } };
    }
    if (error instanceof SearchError || error instanceof CompletionError) {
      logger.error({ err: error }, "dependency failed");
      return { status: 502, jsonBody: { error: "Upstream dependency failed" } };
    }
    logger.error({ err: error }, "unexpected error");
    return { status: 500, jsonBody: { error: "Internal server error" } };
  }
}
```

### Output real do Copilot — validator.ts (Rodada 1)

```typescript
import { z } from "zod";
import { QUERY_CONFIG } from "../../shared/config";
import { ValidationError } from "../../shared/errors";

const queryRequestSchema = z.object({
  query: z.string({ required_error: "query is required" })
    .trim().min(3).max(QUERY_CONFIG.maxQueryLength),
  conversationId: z.string().trim().min(1).optional(),
  userId: z.string().trim().min(1).optional(),
});

export function validateQueryPayload(payload: unknown): QueryRequest {
  const result = queryRequestSchema.safeParse(payload);
  if (!result.success) {
    throw new ValidationError("Invalid request payload", {
      issues: result.error.issues.map(i => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return result.data;
}
```

### Output real do Copilot — search.ts — fixture relevante (Rodada 1)

O Copilot assimilou o domínio NovaTech e gerou dados de corpus com documentos reais:

```typescript
const retrievalCorpus: RetrievedChunk[] = [
  {
    documentId: "PROC-042-v2",
    sourceDocument: "PROC-042-v2, seção 4.1",
    section: "4.1",
    status: "vigente",   // ← ADR-0003 materializada
    content: "Para frete especial, o atendente deve coletar peso, dimensões e categoria...",
    score: 0,
  },
  {
    documentId: "POL-001",
    sourceDocument: "POL-001, seção 2.3",
    section: "2.3",
    status: "vigente",
    content: "Devolução padrão não se aplica a cargas perigosas classes 1-6 da ANTT...", // ← domínio
    score: 0,
  },
  {
    documentId: "PROC-042-v1",
    sourceDocument: "PROC-042-v1, seção 4.1",
    section: "4.1",
    status: "obsoleto",  // ← marcado como obsoleto, filtrado antes da busca
    content: "Versão antiga do processo de frete especial, mantida apenas para histórico.",
    score: 0,
  },
];
// Busca filtra status === "vigente" antes de ranquear — ADR-0003 seguida
```

### Output real do Copilot — testes (Rodada 1)

```typescript
describe("queryHandler", () => {
  it("should return 405 when method is not POST", async () => { ... });
  it("should return 200 with response payload when processing succeeds", async () => {
    // fixture com dados reais NovaTech:
    vi.mocked(searchRelevantChunks).mockResolvedValue([{
      documentId: "SLA-2024",
      sourceDocument: "SLA-2024, tabela 1",
      status: "vigente",
      content: "Clientes Gold possuem atendimento prioritário em até 2 horas úteis...",
      score: 0.8,
    }]);
    ...
  });
  it("should return 400 when payload validation fails", async () => { ... });
  it("should return 502 when search dependency fails", async () => { ... });
  it("should return 502 when completion dependency fails", async () => { ... });
  it("should return 500 when an unexpected error happens", async () => { ... });
});
```

**Resultado: 12 testes passando, build TypeScript limpo.**

---

## Análise: Seguiu vs. Ignorou — Rodada 1

| Instrução no AGENTS.md v1 | Seguiu? | Evidência |
|---------------------------|---------|-----------|
| pino para logging (nunca console.log) | ✓ | `logger.ts` com pino; handler usa `logger.info/warn/error` |
| Zod para validação de input | ✓ | `validator.ts` com `safeParse` e mensagens customizadas |
| Erros customizados tipados | ✓ | `errors.ts`: `AppError`, `ValidationError`, `SearchError`, `CompletionError` |
| HTTP 400 para erros de validação Zod | ✓ | `handler.ts:40` retorna 400 para `ValidationError` |
| HTTP 502 para erros de serviço Azure | ✓ | `handler.ts:47` retorna 502 para `SearchError`/`CompletionError` |
| `source_document` nunca undefined/vazio | ✓ | `response-builder.ts`: `?? "not_found"` em todos os caminhos |
| `AssistantResponse` com todos os campos | ✓ | `types.ts` bate exatamente com a interface do AGENTS.md |
| Metadado de vigência ADR-0003 | ✓ | `types.ts`: `status: "vigente" \| "obsoleto"`; `search.ts` filtra vigentes |
| topK: 5 por query (ADR-0002) | ✓ | `config.ts`: `topK: 5` |
| Vitest + `describe/it` com nomes descritivos | ✓ | Testes com frases completas, não "works" |
| **Path alias `@/` em todos os imports** | **✗** | `handler.ts` usa `../../services/...` — imports relativos |
| **`queryId = crypto.randomUUID()` na 1ª linha** | **✗** | Nenhum `queryId` gerado; logging sem rastreabilidade por requisição |
| **Try/catch separados: validação vs negócio** | **✗** | Um bloco `try/catch` único para validação e chamadas externas |
| **`debug_prompt` não pertence ao schema** | **✗** | `handler.ts` expõe `debug_prompt: prompt` ao cliente — campo interno |
| **Threshold 0.70 (ADR-0002)** | **✗** | `config.ts`: `minScoreThreshold: 0.2` — abaixo do mínimo da ADR |

**Diagnóstico:** O Copilot assimilou bem as regras de módulo (tipos, errors, logger, Zod) que estavam com exemplos de código inline no AGENTS.md. As regras de detalhe de comportamento do handler (queryId, try/catch separado, `@/` aliases, threshold) escaparam porque o AGENTS.md v1 as descrevia em prosa, sem exemplo DO/DON'T inline.

---

## AGENTS.md v2 — Mudanças após análise da Rodada 1

### 1. Logging: adicionado bloco DO/DON'T com código

v1 (prosa): `Use pino para logging. Nunca use console.log.`

v2 (imperativo + exemplo inline):
```
`console.log` é proibido em qualquer arquivo de `/src/`. Use pino.

// CORRETO
import { logger } from "@/shared/logger";
logger.info({ queryId, chunkCount }, "chunks retrieved");

// ERRADO — bloqueado no code review
console.log("chunks:", chunks);
```

### 2. Path aliases: regra explicitada com DON'T

v1: `Path alias @/ aponta para ./src/.`

v2: adicionado exemplo DON'T com imports relativos:
```
// CORRETO
import { queryHandler } from "@/functions/query/handler";

// ERRADO
import { queryHandler } from "../../../functions/query/handler";
```

### 3. Error handling: try/catch separados e HTTP codes explícitos

v1: `Toda função async que chama Azure usa retry com exponential backoff.`

v2: adicionado padrão explícito:
```typescript
// Validação em try/catch próprio → 400
// Negócio em try/catch próprio → 502
```

### 4. Schema AssistantResponse: adicionado como interface TypeScript

v2 inclui a interface completa com comentários nos campos — `source_document` marcado como `NUNCA undefined`, `"not_found"` como valor obrigatório quando ausente.

### 5. Seção "Proibições" adicionada como lista explícita

v2 adicionou lista dedicada de itens que bloqueiam PR:
- `console.log/error/warn` em `/src/`
- `any` sem comentário
- `TODO` em código que vai para PR
- Strings de configuração hardcoded
- Secrets em qualquer arquivo

---

## Rodada 2 — pós v2 (pendente)

As correções do handler que persistem após a rodada 1 (`@/` aliases, `queryId`, `debug_prompt`, threshold 0.70) precisam ser endereçadas diretamente no código. A skill `azure-functions-endpoint.md` (Ex. 2.3) cobre esses pontos com exemplos DO/DON'T específicos — a dependência entre AGENTS.md e skills é confirmada: o AGENTS.md estabelece as regras, as skills ensinam a aplicá-las no código.

---

## Conclusão

| Item | v1 | v2 |
|------|----|----|
| Zod para validação | ✓ | ✓ |
| Logging com pino | ✓ | ✓ |
| HTTP 400/502 corretos | ✓ | ✓ |
| `source_document` nunca vazio | ✓ | ✓ |
| Path alias `@/` | ✗ | Prescrito com DON'T inline |
| `queryId` de rastreabilidade | ✗ | Prescrito na skill (dependência) |
| Try/catch separados | ✗ | Prescrito com padrão explícito |
| `debug_prompt` proibido | ✗ | Coberto pela proibição de campos fora do schema |
| Threshold 0.70 | ✗ | Prescrito com valor explícito |

**Lição principal:** AGENTS.md eficaz precisa de exemplos de código inline para regras de detalhe. Regras em prosa são ignoradas sistematicamente pelo Copilot. A iteração v1→v2 endereçou os gaps de forma prescritiva; os itens que dependem de padrão de código (queryId, try/catch) precisam das skills Foundation para serem captados de forma confiável.
