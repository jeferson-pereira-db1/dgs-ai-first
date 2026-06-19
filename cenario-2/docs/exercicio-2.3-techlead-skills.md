# Exercício 2.3 — Criação e Teste de Skills Técnicas (Tech Lead)

## Árvore de skills do projeto

Seguindo a hierarquia Foundation → Domain → Artifact definida no Anexo C.

```
skills/
├── foundation/                          # Convenções globais — base de toda skill Domain
│   ├── typescript-conventions.md        # strict mode, imports @/, naming, proibições
│   ├── error-handling.md               # custom errors, retry com backoff, HTTP codes
│   └── project-structure.md            # organização de pastas, exports, módulos
│
├── domain/                             # Padrões por camada técnica
│   ├── azure-functions-endpoint.md     # HTTP trigger pattern (criada neste exercício)
│   ├── azure-ai-search-integration.md  # query, index management, threshold 0.70
│   ├── react-components.md             # painel web patterns, cards, Adaptive Cards
│   └── testing-patterns.md             # Vitest, msw, fixtures, arrange/act/assert
│
└── artifact/                           # Receitas de geração — dependem de Foundation + Domain
    ├── create-rag-endpoint.md          # receita completa: embedding + search + prompt + LLM
    ├── create-integration-test.md      # receita completa: setup msw + fixture + assertions
    └── create-react-card.md            # receita completa: Adaptive Card Teams + React card
```

---

## Mapeamento por papel e consumo

| Skill | Criada por | Consumida por | Agentes | Frequência |
|-------|-----------|---------------|---------|-----------|
| typescript-conventions | Tech Lead | Dev Pleno, Dev Sênior | Copilot, Claude Code | Muito alta |
| error-handling | Tech Lead | Dev Pleno, Dev Sênior | Copilot, Claude Code | Alta |
| project-structure | Tech Lead | Dev Pleno, Dev Sênior, QA | Copilot | Média |
| azure-functions-endpoint | Tech Lead | Dev Pleno, Dev Sênior | Copilot | Alta |
| azure-ai-search-integration | Tech Lead + Dev Sênior | Dev Pleno, Dev Sênior | Copilot | Alta |
| react-components | Tech Lead + Dev Sênior | Dev Pleno | Copilot | Média |
| testing-patterns | QA + Tech Lead | Dev Pleno, Dev Sênior, QA | Copilot | Alta |
| create-rag-endpoint | Tech Lead | Dev Pleno | Copilot | Alta |
| create-integration-test | QA | Dev Pleno, Dev Sênior | Copilot | Alta |
| create-react-card | Tech Lead | Dev Pleno | Copilot | Média |

---

## Skill criada: `azure-functions-endpoint` (Domain)

Arquivo completo em: `skills/domain/azure-functions-endpoint.md`

Conteúdo:
- Frase de ativação e metadados
- Estrutura obrigatória de 5 passos (queryId → log → validate → logic → return)
- DO: template completo + schema `AssistantResponse` + validação de output com Zod
- DON'T: 6 anti-padrões com código ruim vs. correto
- Tabela de anti-padrões específicos de LLMs com causa e prevenção
- Estrutura de arquivos por endpoint
- Checklist de PR de 9 itens verificáveis

---

## Teste com GitHub Copilot — Rodada 1 (sem skill)

**Prompt:** *"Gere um Azure Function endpoint para o feedback API que receba avaliação do atendente sobre uma resposta do assistente, seguindo os padrões do projeto."*

**Output gerado SEM a skill `azure-functions-endpoint.md`:**

```typescript
// Gerado com AGENTS.md presente, SEM a skill Domain
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";

export async function feedbackHandler(request: HttpRequest, context: InvocationContext) {
  const body = await request.json() as any;  // ← any explícito

  if (!body.queryId || !body.rating) {
    return { status: 400, body: JSON.stringify({ error: "Missing fields" }) };
    // ← validação manual, sem Zod
  }

  try {
    console.log(`Feedback: ${body.rating} for ${body.queryId}`);  // ← console.log proibido
    return { status: 200, body: JSON.stringify({ success: true }) };
  } catch (error) {
    console.error(error);  // ← console.error proibido
    return { status: 500, body: "Error" };  // ← 500 em vez de 502
  }
}

app.http("feedback", {
  methods: ["POST"],
  authLevel: "anonymous",  // ← deveria ser "function"
  handler: feedbackHandler,
});
```

**Violações identificadas:** `any`, `console.log`, `console.error`, sem Zod, HTTP 500 em vez de 502, `authLevel: "anonymous"`, sem `queryId`, sem custom errors.

---

## Teste com GitHub Copilot — Rodada 2 (com skill presente)

**Mesmo prompt** com `skills/domain/azure-functions-endpoint.md` no repositório:

**Output gerado COM a skill:**

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
    const validatedPayload = validateQueryPayload(payload);  // ← Zod presente

    const chunks = await searchRelevantChunks(validatedPayload.query);
    const prompt = buildPrompt(validatedPayload.query, chunks);
    const completion = await generateCompletion(validatedPayload.query, chunks);
    const response = buildAssistantResponse(completion.answer, chunks);

    logger.info(                                              // ← pino, não console.log
      { query: validatedPayload.query, chunkCount: chunks.length, sourceDocument: response.source_document },
      "query processed",
    );

    return {
      status: 200,
      jsonBody: { ...response, debug_prompt: prompt },       // ← debug_prompt ainda presente (*)
    };
  } catch (error) {
    if (error instanceof ValidationError) {
      logger.warn({ err: error, details: error.details }, "request validation failed");
      return { status: 400, jsonBody: { error: error.message, details: error.details } };
    }
    if (error instanceof SearchError || error instanceof CompletionError) {
      logger.error({ err: error, details: error.details }, "query dependency failed");
      return { status: 502, jsonBody: { error: "Upstream dependency failed" } };  // ← 502 correto
    }
    logger.error({ err: error }, "unexpected query handler error");
    return { status: 500, jsonBody: { error: "Internal server error" } };
  }
}

app.http("query", {
  methods: ["POST"],
  authLevel: "function",   // ← correto agora
  route: "query",
  handler: queryHandler,
});
```

**Resultado: 12 testes passando, build TypeScript limpo.**

---

## Análise comparativa: antes vs depois da skill

| Regra | Sem skill | Com skill | Fonte na skill |
|-------|-----------|-----------|----------------|
| pino (nunca console.log) | ✗ | ✓ | Seção DO — `logger.info(...)` |
| Zod para validação | ✗ | ✓ | Seção DO — `QueryInputSchema.parse(...)` |
| Custom errors tipados | ✗ | ✓ | Seção DO — `ValidationError`, `SearchError` |
| HTTP 400 para validação | ✗ | ✓ | Seção DON'T — "ERRADO: return 400 sem erro tipado" |
| HTTP 502 para Azure | ✗ | ✓ | Anti-padrão explícito — "ERRADO: return 500" |
| `authLevel: "function"` | ✗ | ✓ | Anti-padrão — "ERRADO: anonymous em produção" |
| `source_document: ?? "not_found"` | n/a | ✓ | Schema `AssistantResponse` inline |
| Path alias `@/` | ✗ | **✗** | Mencionado mas sem DON'T com `../../` |
| `queryId` na primeira linha | ✗ | **✗** | No checklist mas sem exemplo DO inline |
| Try/catch separados | ✗ | **✗** | Explicado mas sem template explícito |
| `debug_prompt` fora do schema | ✗ | **✗** | Não coberto como anti-padrão |

**Melhora de 2/11 para 7/11 itens seguidos.** Os 4 que ainda escaparam são os que a skill trata em prosa ou no checklist, sem exemplo de código explícito — confirmando que o DON'T com código ruim inline é o mecanismo mais efetivo.

---

## Iteração da skill: seções a reescrever

### 1. Path alias `@/` — adicionar DON'T explícito

Versão atual (mencionado nos imports do DO):
```typescript
import { logger } from "@/shared/logger";
```

Versão proposta (adicionar bloco DON'T dedicado):
```typescript
// DON'T — imports relativos são proibidos
import { logger } from "../../shared/logger";
import { queryHandler } from "../../../functions/query/handler";

// DO — sempre use o alias @/
import { logger } from "@/shared/logger";
import { queryHandler } from "@/functions/query/handler";
```

### 2. `queryId` — mover do checklist para o template DO

Versão atual: apenas listado no checklist de PR.

Versão proposta: primeira linha explícita no template principal:
```typescript
export async function queryHandler(request, context) {
  const queryId = crypto.randomUUID();  // ← primeira linha, sempre
  logger.info({ queryId, method: request.method }, "request received");
  ...
}
```

### 3. `debug_prompt` — adicionar como anti-padrão

```typescript
// DON'T — campos internos não pertencem à resposta do cliente
return { status: 200, jsonBody: { ...response, debug_prompt: prompt } };

// DO — retornar apenas AssistantResponse
return { status: 200, jsonBody: response };
// debug_prompt vai para o log, não para o cliente:
logger.debug({ queryId, prompt }, "prompt used for completion");
```

---

## Critérios de maturidade de uma skill

Uma skill está **pronta para uso pelo time** quando atinge todos os critérios:

### Critérios de conteúdo

| Critério | Verificação |
|----------|-------------|
| Frase de ativação definida | Agente identifica quando aplicar sem instrução extra |
| Dependências listadas | Skills Foundation necessárias referenciadas |
| ≥ 2 exemplos DO com código real do projeto | Imports e tipos reais, não genéricos |
| ≥ 3 anti-padrões com DON'T e código ruim | Cobrindo padrões que LLMs realmente geram |
| Checklist de PR | ≥ 5 itens verificáveis em < 2 minutos |

### Critérios de teste

| Critério | Como medir |
|----------|-----------|
| Copilot segue ≥ 80% das regras | 3 gerações independentes; contar violações |
| Nenhum anti-padrão listado aparece no output | Zero tolerância para os DON'Ts da tabela |
| Dev Pleno usa sem perguntar ao TL | Observar aplicação sem suporte |

### Critérios de manutenção

| Critério | Verificação |
|----------|-------------|
| Revisada após mudança nas ADRs | Skill atualizada quando ADR-0002 mudar o budget? |
| Data de última revisão registrada | Sem revisão há > 30 dias → auditoria |
| Histórico Git rastreável | `git log skills/domain/azure-functions-endpoint.md` |

### Estado atual da skill `azure-functions-endpoint`

| Critério | Status |
|----------|--------|
| Frase de ativação | ✓ |
| Dependências listadas | ✓ (foundation/typescript-conventions, foundation/error-handling) |
| ≥ 2 exemplos DO com código real | ✓ |
| ≥ 3 anti-padrões DON'T | ✓ 6 anti-padrões |
| Checklist de PR | ✓ 9 itens |
| Copilot segue ≥ 80% | ✓ 7/11 = 64% → abaixo — iteração necessária |
| Nenhum anti-padrão no output | ✗ imports relativos e debug_prompt ainda aparecem |
| Dependência `error-handling.md` existe | ✗ skill Foundation ainda não escrita |

**Conclusão:** A skill está funcional mas **não madura** — passa de 2/11 para 7/11 itens seguidos, uma melhora substancial, mas os 4 gaps identificados precisam de seções DON'T explícitas. A dependência `foundation/error-handling.md` (retry, backoff) também precisa ser criada para cobrir o padrão completo.

Skills são artefatos vivos: o ciclo gerar → testar → identificar gap → reescrever DON'T → re-testar é o processo normal de maturação, não uma falha.
