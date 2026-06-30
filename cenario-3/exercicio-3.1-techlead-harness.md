# Exercício 3.1 — Design do Harness do Projeto (Tech Lead)

## Contexto

O assistente NovaTech está funcional em staging mas precisa de governança para go-live. O harness é o conjunto de camadas que transforma um protótipo em sistema de produção confiável. Esta análise cobre as 5 camadas do framework, indicando para cada uma o que existe, o que falta, e como fechar o gap.

---

## Harness — 5 Camadas

---

### Camada 1 — Tool Orchestration

**O que é:** Coordenação entre as ferramentas que compõem o pipeline: ingestão de documentos, busca (Azure AI Search), geração (Azure OpenAI).

**O que já está implementado:**
- `query endpoint` recebe a pergunta via POST, chama Azure AI Search para recuperar chunks, monta o prompt e chama Azure OpenAI para gerar a resposta.
- Pipeline de ingestão processa e indexa os 847 documentos.
- `buildPrompt` e `generateCompletion` são serviços separados com responsabilidades claras.

**O que falta:**
- **Retry com exponential backoff** nas chamadas ao Azure AI Search e Azure OpenAI — se a chamada falhar, o endpoint retorna 502 sem tentar novamente.
- **Circuit breaker:** se o Azure AI Search ficar indisponível por mais de N tentativas, parar de tentar e degradar com aviso — em vez de acumular timeouts que penalizam o atendente.
- **Timeout explícito por operação:** sem timeout, uma chamada lenta ao Azure OpenAI pode bloquear o handler indefinidamente.

**Como fechar:**
```typescript
// Retry com exponential backoff — em src/shared/retry.ts
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts = { maxAttempts: 3, baseDelayMs: 300 }
): Promise<T> {
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === opts.maxAttempts) throw err;
      await new Promise(r => setTimeout(r, opts.baseDelayMs * 2 ** (attempt - 1)));
    }
  }
  throw new Error("unreachable");
}
```

**Prioridade:** Alta — afeta disponibilidade diretamente.

---

### Camada 2 — Verification Loops

**O que é:** Verificações automáticas sobre os outputs do modelo — o modelo disse algo verificável e válido?

**O que já está implementado:**
- Schema Zod valida o **input** do endpoint (query do atendente).
- `response-builder.ts` garante `source_document: ?? "not_found"` (nunca string vazia).

**O que falta:**
- **Verificação de fonte válida:** o `source_document` retornado existe na lista de documentos reais da NovaTech? O modelo pode citar "PROC-043" (inexistente) com alta confiança.
- **Schema de structured output na resposta do modelo:** hoje a resposta é texto livre parseado. Se o modelo "esquecer" um campo, nada bloqueia.
- **Confidence threshold check:** respostas com `confidence: "low"` deveriam seguir um fluxo diferente (HITL), não retornar diretamente ao atendente.

**Como fechar:**
- Implementar `verifySourceDocument()` — ver código em `src/services/source-verifier.ts` neste entregável.
- Adicionar schema Zod na saída do `generateCompletion` para forçar structured output.
- Rotear respostas `confidence: "low"` para fila de revisão humana.

**Prioridade:** Alta — 12% de respostas incorretas em staging; a verificação de fonte reduz esse número.

---

### Camada 3 — Context & Memory

**O que é:** Manutenção do contexto entre turnos da conversa, respeitando o orçamento definido arquiteturalmente.

**O que já está implementado:**
- `buildPrompt` monta system prompt + chunks + pergunta.
- `config.ts` define `topK: 5` (aderente ao ADR-0002).

**O que falta — conexão com ADR-0002 (Cenário 1):**

A ADR-0002 definiu o seguinte orçamento de contexto que **ainda não está enforçado no código**:

```
System prompt:    ~4.000 tokens  — nunca exceder
Chunks (top-5):   ~8.000 tokens  — 5 × ~1.600 tokens
Histórico:        ~1.500 tokens  — máximo 3 turnos (sliding window)
Pergunta atual:     ~200 tokens
─────────────────────────────
Total:           ~13.700 tokens
```

O `buildPrompt` atual não implementa a **sliding window** de 3 turnos nem verifica se o orçamento foi respeitado. O histórico da conversa cresce indefinidamente se não houver corte.

**Regras de overflow da ADR-0002 (a implementar):**
1. Primeiro cortar histórico (reduzir de 3 para 1 turno)
2. Depois reduzir chunks de top-5 para top-3
3. System prompt e pergunta nunca são cortados

**Como fechar:**
```typescript
// src/services/context-manager.ts
export function enforceContextBudget(parts: ContextParts): ContextParts {
  const estimated = estimateTokens(parts);
  if (estimated <= MAX_CONTEXT_TOKENS) return parts;

  // 1. Reduzir histórico
  const withReducedHistory = { ...parts, history: parts.history.slice(-1) };
  if (estimateTokens(withReducedHistory) <= MAX_CONTEXT_TOKENS) return withReducedHistory;

  // 2. Reduzir chunks
  return { ...withReducedHistory, chunks: parts.chunks.slice(0, 3) };
}
```

**Prioridade:** Média — context rot já ocorre em conversas longas, mas o sistema de staging não testou sessões longas.

---

### Camada 4 — Guardrails

**O que é:** Limites que o sistema não pode ultrapassar — combinação de enforcement probabilístico (prompt) e determinístico (código), com pontos de human-in-the-loop.

**O que já está implementado (probabilístico — cenário 1):**
- System prompt com 6 regras (citar fonte, nunca inventar, escalar, priorizar vigente, sem tier falso, português formal).
- Filtro de documentos `status = "vigente"` no pipeline de busca.

**O que falta:**

**Structured output (determinístico — a implementar):**
Hoje a resposta do modelo é texto livre. Um campo obrigatório como `source_document` pode ser omitido e nada bloqueia a resposta. A solução é forçar o modelo a responder em JSON fixo e validar com Zod antes de retornar ao atendente:

```typescript
// Schema da resposta estruturada
const AssistantOutputSchema = z.object({
  answer: z.string().min(1),
  source_document: z.string().min(1),   // obrigatório — nunca omitido
  confidence: z.enum(["high", "medium", "low"]),
  escalation_recommended: z.boolean(),
});
// Se parseamento falhar → resposta padrão segura, log de erro
```

**HITL — Human-in-the-Loop (a implementar):**

Ponto obrigatório de revisão humana antes da resposta chegar ao atendente:

| Gatilho | Ação |
|---------|------|
| `confidence: "low"` + consulta sobre carga perigosa (classes 1-6 ANTT) | Reter resposta na fila de revisão; supervisor valida antes de liberar |
| `source_document` inválido (não na lista de docs conhecidos) | Bloquear resposta; substituir por mensagem padrão; notificar TL |
| Resposta afirma que carga perigosa pode ser devolvida | Bloquear determinístico — nunca chega ao atendente |

**Como fechar:**
- Implementar `response-validator.ts` com os guardrails determinísticos.
- Adicionar rota de HITL: respostas com gatilho vão para `POST /api/review-queue`; supervisor aprova ou edita.

**Prioridade:** Bloqueante para go-live — 12% de respostas incorretas em staging incluem casos de carga perigosa.

---

### Camada 5 — Observability

**O que é:** Visibilidade do que acontece em produção — logs, métricas, alertas.

**O que já está implementado:**
- Logging estruturado com pino em todos os serviços.
- Logs incluem `queryId`, `chunkCount`, `confidence`, `sourceDocument`.

**O que falta:**
- **Métricas de qualidade:** % de respostas com `confidence: "low"`, % de escalações, % de feedback negativo dos atendentes.
- **Alertas com threshold:** "se feedback negativo > 15% em 24h, notificar TL via canal Teams".
- **Dashboard:** visibilidade em tempo real do estado do assistente para a equipe de produto.
- **Trace de ponta a ponta:** correlacionar `queryId` desde o recebimento da pergunta até o feedback do atendente.

**Como fechar:**
- Integrar Application Insights (já disponível no ecossistema Azure da NovaTech) para métricas e alertas.
- Adicionar evento de telemetria em cada resposta: `{ queryId, confidence, escalated, feedbackRating }`.
- Criar dashboard no Azure Monitor com os KPIs críticos.

**Prioridade:** Alta para go-live — sem observability, o time voa cego em produção.

---

## Resumo do Harness — Status por Camada

| Camada | Existe | Falta | Bloqueante para go-live? |
|--------|--------|-------|--------------------------|
| Tool Orchestration | Pipeline funcional | Retry, circuit breaker, timeout | Não (degradação aceitável) |
| Verification Loops | Validação de input | Verificação de fonte, structured output | **Sim** |
| Context & Memory | Budget definido | Sliding window, overflow enforcement | Não (sessões curtas OK) |
| Guardrails | Prompt com 6 regras | Structured output, HITL para carga perigosa | **Sim** |
| Observability | Logs estruturados | Métricas, alertas, dashboard | **Sim** (go-live sem visibilidade é inaceitável) |

---

## Função de Verificação — Camada 2 (Verification Loops)

Implementação da verificação de `source_document` contra a lista de documentos válidos da NovaTech.

Ver código completo em: `src/services/source-verifier.ts`

**Prompt enviado ao Copilot:**
> "Implemente uma função TypeScript chamada `verifySourceDocument` que recebe uma string `sourceDocument` (ex: 'POL-001, seção 3.2') e verifica se o identificador do documento está na lista de IDs válidos: POL-001, PROC-042, PROC-042-v2, SLA-2024, FAQ-Atendimento. Deve extrair o ID antes da vírgula, verificar na lista, e retornar um objeto com `isValid: boolean` e `reason?: string`. Usar TypeScript strict, sem any."

**Output do Copilot (após revisão):** ver `src/services/source-verifier.ts`

**O que o Copilot acertou:** estrutura correta, extração do ID antes da vírgula, `as const` no array.

**O que foi corrigido na revisão:**
1. O Copilot incluiu `"not_found"` como caso válido — errado, `not_found` deve ser tratado como ausência de fonte, não como fonte válida.
2. O regex de extração cortava errado quando havia espaço antes da vírgula — ajustado para `.trim()` após o split.
