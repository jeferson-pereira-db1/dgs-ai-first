# AGENTS.md — NovaTech Assistant

> Constitution do projeto. Todo agente de IA (Copilot, Claude Code) lê este arquivo antes de gerar qualquer artefato.
> Seções escritas pelos respectivos papéis — ver comentário em cada seção.
> **Versão:** 2.0 (iterado após simulação Copilot — ver exercício 2.1)

---

## Project Overview

**Projeto:** Assistente de atendimento da NovaTech, empresa de logística com 1.200 funcionários.

**Problema:** A equipe de atendimento (45 pessoas, ~320 chamados/dia) gasta em média 12 minutos por chamado buscando informações em documentação interna. O objetivo é reduzir para menos de 2 minutos via assistente de IA com RAG.

**Arquitetura:** 4 componentes:
1. **Pipeline de ingestão** — extrai, chunka, embeda e indexa documentos da NovaTech
2. **API do assistente** — Azure Functions + Azure AI Search + Azure OpenAI; recebe pergunta, recupera chunks, gera resposta com citação de fonte
3. **Bot do Teams** — interface conversacional via Bot Framework integrado ao Microsoft Teams
4. **Painel web** — dashboard React de métricas, histórico de queries e feedback dos atendentes

**Base documental:** 847 documentos válidos (após discovery). 12 com contradições pendentes de resolução pelo Compliance. Documentos contraditórios gerenciados via metadado de vigência (ADR-0003).

**Repositório:** `novatech-assistant` — repositório local. Branch strategy: feature branches locais com "PRs" como arquivos `docs/pull-requests/PR-NNNN.md`.

**Fonte de verdade:** Para comportamento de qualquer componente, consulte `/specs/` e `/docs/adr/`. ADRs são definitivas para decisões técnicas.

---

## Tech Stack & Architecture

### Stack

| Camada | Tecnologia | Versão |
|--------|------------|--------|
| Runtime | Node.js | 20 LTS |
| Linguagem | TypeScript | 5.x (strict: true) |
| Backend | Azure Functions | v4 |
| Validação | Zod | ^3 |
| Logging | pino | ^8 |
| Testes | Vitest | ^1 |
| Mock HTTP | msw | ^2 |
| Frontend | React | ^18 |
| LLM | Azure OpenAI GPT-4o | temperature: 0 |
| Vector store | Azure AI Search | — |
| Embeddings | text-embedding-3-large | — |

### Orçamento de contexto (ADR-0002 — obrigatória)

Todo código do pipeline RAG DEVE respeitar estes limites. Sem exceção.

```
System prompt (estático):    ~4.000 tokens  — NUNCA exceder
Chunks recuperados (top-5):  ~8.000 tokens  — 5 chunks × ~1.600 tokens
Histórico de conversa:       ~1.500 tokens  — máximo 3 turnos (sliding window)
Pergunta atual:              ~200 tokens
─────────────────────────────────────────
Total máximo por query:      ~13.700 tokens

Regras de overflow (em ordem de prioridade):
  1. Cortar histórico: reduzir de 3 para 1 turno
  2. Reduzir chunks: de top-5 para top-3
  3. System prompt e pergunta NUNCA são cortados
```

### Documentos contraditórios (ADR-0003 — obrigatória)

Todo código que indexa ou busca DEVE:
- Incluir `documento_id`, `versao`, `data_vigencia`, `status` em cada chunk
- Filtrar `status = "vigente"` antes de qualquer busca
- Nunca retornar chunk com `status = "obsoleto"` ao LLM

### Schema de resposta da API (obrigatório)

```typescript
interface AssistantResponse {
  answer: string;
  source_document: string;           // Ex: "PROC-042-v2, seção 4.1" — NUNCA undefined
  confidence: "high" | "medium" | "low";
  low_confidence_warning?: string;   // Presente apenas quando confidence !== "high"
  escalation_recommended: boolean;   // true quando confidence === "low"
}
```

`source_document` é obrigatório em toda resposta. Quando não há fonte: `"not_found"`.

---

## Coding Standards

### TypeScript

- `strict: true` — sem exceção. Código que não compila em strict é rejeitado no PR.
- Sem `any` explícito. Usar `unknown` + type narrowing.
- `!` non-null assertion exige comentário explicando por que é seguro.
- Path alias `@/` aponta para `./src/` — usar em todos os imports.

```typescript
// CORRETO
import { queryHandler } from "@/functions/query/handler";
import { logger } from "@/shared/logger";

// ERRADO
import { queryHandler } from "../../../functions/query/handler";
```

### Logging

`console.log` é **proibido** em qualquer arquivo de `/src/`. Use pino.

```typescript
// CORRETO
import { logger } from "@/shared/logger";
logger.info({ queryId, chunkCount }, "chunks retrieved");
logger.error({ err, queryId }, "azure search failed");

// ERRADO — bloqueado no code review
console.log("chunks:", chunks);
```

Todo log inclui contexto estruturado (primeiro argumento objeto). Mensagem em inglês.

### Error handling

```typescript
// CORRETO
import { SearchError } from "@/shared/errors";
throw new SearchError("No results above threshold", {
  queryId,
  threshold: SIMILARITY_THRESHOLD,
  topScore: results[0]?.score,
});

// ERRADO
throw new Error("Search failed");
```

- Toda função async que chama Azure usa retry com exponential backoff.
- `catch` vazio é proibido.
- Erros de validação Zod → HTTP 400.
- Erros de serviço Azure → HTTP 502.

### Commits (Conventional Commits)

```
feat(query): add similarity threshold filter before reranking
fix(chunker): preserve table integrity when splitting by section
docs(adr): add ADR-0005 for embedding model selection
test(query): add fixture for dangerous cargo inversion case
refactor(prompt-builder): extract context budget enforcement
```

Tipos: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `perf`.
Scope: slug do módulo em kebab-case.
Mensagem: imperativo, inglês, sem ponto final, máximo 72 chars.

### Nomenclatura

| Contexto | Padrão |
|----------|--------|
| Arquivos | `kebab-case.ts` |
| Interfaces/Types | `PascalCase` |
| Funções/variáveis | `camelCase` |
| Constantes de config | `UPPER_SNAKE_CASE` |

Sem prefixo `I` em interfaces.

### Proibições (PR não aprovado com qualquer item abaixo)

- `console.log/error/warn` em `/src/`
- `any` sem comentário justificando
- `TODO` em código que vai para PR
- Strings de configuração hardcoded — tudo via `config.ts`
- Secrets ou keys em qualquer arquivo

---

## Product Rules & Guardrails

<!-- TODO (Product Specialist — Ex. 2.3) -->

### Regras mínimas de comportamento (aguardando Product Specialist)

O assistente DEVE:
- Citar `source_document` em toda resposta com dado factual
- Responder em português formal
- Recomendar escalação quando `confidence === "low"`

O assistente NÃO DEVE:
- Gerar valores numéricos (prazos, SLAs, multiplicadores) não presentes nos chunks
- Afirmar que carga perigosa (classes 1-6 ANTT) pode ser devolvida pelo processo padrão
- Mencionar tiers inexistentes (só existem Gold, Silver, Standard)

---

## Testing Standards

<!-- TODO (QA — completar em Ex. 2.1) -->

- Framework: Vitest
- Mocks HTTP: msw — nunca chamar Azure real em testes
- Coverage mínimo: 80% de linhas
- Fixtures compartilhadas em `/tests/fixtures/`
- Nomenclatura: `describe('ModuleName') > it('should [behavior] when [condition]')`

---

## Project Management Rules

<!-- TODO (Delivery Manager — Ex. 2.3) -->

---

## Build & Deploy

### Scripts

```bash
npm run build          # Compila TypeScript
npm run test           # Roda Vitest
npm run test:coverage  # Coverage report
npm run lint           # ESLint + TypeScript check
npm run dev            # Azure Functions local (func start)
```

### Branch strategy

1. `git checkout -b feat/TASK-ID-descricao-curta`
2. Desenvolver com Conventional Commits
3. "Abrir PR" = criar `docs/pull-requests/PR-NNNN.md`
4. Tech Lead revisa arquivo de PR + diff
5. `git checkout main && git merge --no-ff feat/...`

### Validation gates

| Gate | Condição de avanço | Aprovador |
|------|-------------------|-----------|
| Spec → Plan | `requirements.md` aprovado, com verification criteria testáveis | Product Specialist |
| Tasks → Implement | `tasks.md` aprovado, critérios de aceite por task | Tech Lead |
| Code → Merge | CI verde + code review | Tech Lead |
| Tests → Deploy | Coverage ≥ 80%, cenários críticos cobertos | QA + Tech Lead |

### CI

Etapas em todo PR (devem passar para merge):
1. `npm run lint`
2. `npm run build`
3. `npm run test:coverage` — falha se coverage < 80%

---

## ADRs de referência

| ADR | Decisão | Impacto |
|-----|---------|---------|
| ADR-0001 | LLM: GPT-4o via Azure OpenAI | `src/services/completion.ts` |
| ADR-0002 | Context budget: 4K system + 8K chunks | `src/services/prompt-builder.ts` |
| ADR-0003 | Contradições: metadado de vigência | `src/services/search.ts`, `src/pipeline/indexer.ts` |
| ADR-0004 | Pipeline: Azure AI Search + LangChain | Toda a arquitetura |

Para nova ADR: copiar `/docs/adr/template.md`, nomear `NNNN-titulo.md`, submeter via PR.
