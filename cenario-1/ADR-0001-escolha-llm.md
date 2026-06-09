# ADR-0001: Escolha do Modelo de LLM para o Assistente de Atendimento NovaTech

## Status: Aceito (revisado após devil's advocate)

---

## Contexto

A NovaTech precisa de um LLM para gerar respostas fundamentadas em documentação interna. O assistente será integrado ao ambiente Microsoft (Teams + SharePoint) e precisa estar em produção em 3 meses.

**Volume estimado de uso:**
- 320 chamados/dia × 60% com consulta documental = **192 queries/dia**
- Estimando 2-3 perguntas por chamado: **~400-600 queries/dia ao LLM**
- Orçamento de contexto por query (conforme ADR-0002): ~5K tokens entrada, ~400 tokens saída
- **Tokens mensais estimados:** ~75M entrada + ~6M saída (30 dias × 500 queries × 5K input + 400 output)

**Requisitos que impactam a escolha:**
- Raciocínio sobre negação e exceções: "cargas perigosas NÃO podem ser devolvidas" — inversão de regra deve ser preservada com precisão
- Tratamento de contradições entre chunks de versões diferentes (PROC-042 v1 vs v2)
- Citação obrigatória de fonte em toda resposta factual
- Resposta em português formal sem erros gramaticais
- Nunca inventar prazos, valores ou procedimentos não presentes nos chunks

**Restrições do projeto:**
- NovaTech tem Microsoft 365 E3 e Azure provisionado com aprovação de compliance já obtida
- Prazo de 3 meses: discovery + desenvolvimento + go-live
- Time de TI da NovaTech com expertise Azure assumirá manutenção pós-projeto
- Adição de novo fornecedor externo exige processo de procurement e DPA — semanas adicionais

**Opções avaliadas:**
1. Azure OpenAI Service — GPT-4o
2. Claude via API (Anthropic)
3. Modelos open-source self-hosted (Ollama + Llama 3 / Mistral)

---

## Decisão

Adotaremos o **Azure OpenAI Service com GPT-4o** como LLM de geração, com **avaliação formal de downgrade para GPT-4o mini após 30 dias de produção**.

O GPT-4o será acessado via Azure OpenAI dentro do tenant da NovaTech. O pipeline de retrieval (Azure AI Search) passará chunks como contexto a cada query. Temperature = 0 para máximo determinismo nas respostas de atendimento.

**Avaliação de downgrade (30 dias pós go-live):**
Amostrar 200 pares pergunta/resposta e comparar GPT-4o vs GPT-4o mini nas dimensões: precisão factual em inversões de regra (carga perigosa, tiers inexistentes), aderência aos guardrails (citação de fonte, recusa adequada), e qualidade do português formal. Se GPT-4o mini atingir ≥ 90% de paridade, migrar para redução de ~70% no custo de tokens.

---

## Análise comparativa

### Opção 1 — Azure OpenAI (GPT-4o)

**Janela de contexto:** 128K tokens. Suficiente com ampla margem para o orçamento de 5K tokens/query definido na ADR-0002.

**Estimativa de custo mensal:**

| Item | Volume mensal | Preço referência | Custo estimado |
|------|---------------|------------------|----------------|
| Tokens entrada (GPT-4o) | ~75M tokens | $2,50/1M | ~$187 |
| Tokens saída (GPT-4o) | ~6M tokens | $10/1M | ~$60 |
| **Total** | | | **~$247/mês** |

Com pico de 2× o volume estimado: ~$494/mês — ainda irrelevante para o orçamento do projeto.

**Prós:**
- Integração nativa com Azure AI Search, Teams e SharePoint via ecossistema Microsoft
- Dados permanecem no tenant Azure da NovaTech — sem negociação contratual adicional com vendors externos
- Microsoft Customer Agreement provavelmente já aprovado pelo compliance da NovaTech
- SLA de disponibilidade Azure OpenAI (99,9%) adequado para uso interno em horário comercial
- Time de TI da NovaTech já opera Azure — sustentação pós-projeto facilitada

**Contras:**
- Dependência dupla de vendor: Microsoft para a plataforma, OpenAI para o modelo
- Nenhum modelo elimina alucinação — a mitigação é arquitetural (RAG + guardrails), não dependência do modelo
- Preços por token sujeitos a alteração pela Microsoft/OpenAI

---

### Opção 2 — Claude via API (Anthropic)

**Janela de contexto:** 200K tokens (Claude 3.5 Sonnet+). A maior janela comercialmente disponível.

**Estimativa de custo mensal (mesmos volumes):**

| Item | Volume mensal | Preço referência | Custo estimado |
|------|---------------|------------------|----------------|
| Tokens entrada (Claude Sonnet) | ~75M tokens | $3/1M | ~$225 |
| Tokens saída (Claude Sonnet) | ~6M tokens | $15/1M | ~$90 |
| **Total** | | | **~$315/mês** |

**Prós:**
- Janela de 200K tokens — relevante se o design de contexto mudar radicalmente no futuro
- Reconhecidamente forte em seguir instruções e respeitar guardrails complexos
- Performance documentada superior em raciocínio sobre documentos contraditórios — diretamente relevante para PROC-042 v1 vs v2

**Contras:**
- Não tem integração nativa com o ecossistema Azure/Microsoft
- Adicionar a Anthropic como fornecedor exige processo de procurement, DPA e aprovação de segurança — semanas em projeto de 3 meses
- Dados saem do tenant Azure — análise adicional de compliance
- A vantagem de 200K tokens é irrelevante para o caso de uso atual: o orçamento de contexto definido na ADR-0002 é ~5K tokens/query, longe de qualquer limite

---

### Opção 3 — Modelos open-source self-hosted (Ollama)

**Estimativa de custo:**
- VM com GPU no Azure para hospedar Llama 3.1 70B: ~$800-2.000/mês (A10G/A100)
- Custo operacional de MLOps e manutenção do modelo

**Prós:**
- Dados nunca saem da infraestrutura da NovaTech
- Sem custo por token após infraestrutura provisionada

**Contras:**
- Custo de infraestrutura 3-8× maior que o custo de API para o volume projetado
- Performance inferior ao GPT-4o em raciocínio sobre exceções e citação de fontes — crítico dado o requisito do projeto
- Necessidade de expertise MLOps fora do escopo do projeto de 3 meses
- Risco maior de alucinação em modelos menores sem fine-tuning para o domínio logístico

---

## Comparativo direto: Azure OpenAI (GPT-4o) vs Claude

A Opção 3 foi descartada antes desta análise por custo de infraestrutura e falta de expertise MLOps.

| Critério | Azure OpenAI (GPT-4o) | Claude via API | Peso para este projeto |
|----------|----------------------|----------------|------------------------|
| Integração Teams/SharePoint | Nativa | Manual (~2-3 dias extra) | Alto — prazo de 3 meses |
| Comportamento de guardrails | Bom | Melhor | Alto — base com docs contraditórios |
| Janela de contexto | 128K (amplamente suficiente) | 200K (excesso para o cenário) | Baixo |
| Custo mensal estimado | ~$247/mês | ~$315/mês | Baixo |
| Aprovação contratual/compliance | Provavelmente já aprovado | Novo processo jurídico (semanas) | Alto — risco de prazo |
| Suporte enterprise | SLA Microsoft | Menor estrutura | Médio |

**Conclusão:** O Claude apresenta vantagem técnica genuína em guardrails e raciocínio sobre documentos contraditórios. O Azure OpenAI vence em integração nativa e aprovação contratual — dois critérios com peso alto dado o prazo e o perfil da NovaTech. A decisão é pelo Azure OpenAI com a ressalva explícita de que o system prompt precisa compensar a diferença de comportamento de guardrails com regras explícitas e camada de enforcement determinístico.

---

## Consequências

**Positivas:**
- Dados de atendimento e documentação interna permanecem dentro do tenant Azure — sem necessidade de negociação contratual adicional
- Integração com Teams e SharePoint via conectores nativos Microsoft, reduzindo esforço de desenvolvimento
- Time de TI da NovaTech pode gerenciar acesso, logs e auditoria pelo Azure Portal com ferramentas que já conhece
- Custo operacional estimado em $247/mês — margem grande antes de custo se tornar problema
- A avaliação de downgrade para GPT-4o mini após 30 dias permite redução de 70% no custo com base em dados reais do domínio

**Negativas:**
- Dependência dupla de vendor: degradação de qualidade do GPT-4o afeta o projeto sem controle sobre o modelo
- Nenhum LLM elimina alucinação — a arquitetura (RAG + guardrails + enforcement determinístico) é a mitigação real, não o modelo escolhido. Esta distinção deve ser comunicada explicitamente ao cliente para evitar expectativas irrealistas
- Preços por token estão sujeitos a alteração pela Microsoft/OpenAI
- Se o projeto evoluir para casos de uso com documentos muito longos ou contextos multi-turno extensos, a janela de 128K pode se tornar limitante antes da de 200K do Claude

---

## Processo de devil's advocate

**Contra-argumento 1: "Você escolheu por conveniência de ecossistema, não por qualidade técnica. O Claude é tecnicamente superior para este caso de uso."**

Status: **Incorporado parcialmente.** O argumento é válido em termos de comportamento de guardrails. A ADR foi revisada para reconhecer explicitamente a superioridade técnica do Claude nesse critério — e para deixar claro que a escolha pelo Azure OpenAI é uma decisão de custo/prazo/compliance, não de superioridade técnica absoluta. A mitigação foi fortalecida: o enforcement determinístico (camada de código que valida a resposta antes de entregar ao atendente) compensa parte da diferença de qualidade de guardrails.

**Contra-argumento 2: "A afirmação de que GPT-4o 'não alucina' é problemática — todos os LLMs alucinam."**

Status: **Incorporado.** O texto foi revisado para deixar explícito que nenhum modelo elimina alucinação e que a mitigação é arquitetural. Esse ponto foi adicionado nas consequências negativas e deve ser comunicado ao cliente para evitar expectativas irrealistas.

**Contra-argumento 3: "O custo estimado de $247/mês está subestimado — não considerou embeddings, retentativas e tráfego de desenvolvimento."**

Status: **Válido.** Revisado para incluir buffer de 2× ($500/mês como estimativa conservadora de produção). Mesmo assim irrelevante para o orçamento do projeto.

**Contra-argumento 4: "O esforço de integrar o Claude pode ser menor do que você assumiu — 2-3 dias extra é pouco para justificar a escolha."**

Status: **Respondido e mantido.** Investigado: a integração com Teams é via bot framework (agnóstico ao LLM) e com SharePoint é via indexer do Azure AI Search (também agnóstico ao LLM). O esforço adicional real é de 2-3 dias de desenvolvimento — menor do que o assumido inicialmente. O fator determinante não é o esforço técnico, mas o processo jurídico de aprovação de um novo vendor, que pode levar semanas.

---

## Alternativas descartadas

### Claude via API — Descartada
Tecnicamente competitiva e honestamente a melhor opção em comportamento de guardrails. Descartada pela combinação de dois fatores de alto peso: (1) necessidade de aprovação contratual com novo vendor em empresa de médio porte — processo que pode levar semanas em um cronograma de 3 meses; (2) sem integração nativa com o ecossistema Microsoft que a NovaTech já opera.

**Condição de revisão:** Se o prazo for estendido, se a NovaTech já tiver contrato com a Anthropic, ou se os guardrails do GPT-4o se mostrarem insuficientes em produção mesmo com enforcement determinístico, esta alternativa deve ser reavaliada prioritariamente.

### Modelos open-source self-hosted — Descartada
Descartada por três razões independentes, qualquer uma já suficiente: custo de infraestrutura ($800-2.000/mês) supera em 3-8× o custo de API para o volume projetado; performance inferior em seguir instruções complexas e citar fontes; necessidade de expertise MLOps fora do escopo.

**Condição de revisão:** Se o volume crescer para dezenas de milhares de queries/dia, o custo de API se tornaria dominante e a equação mudaria.
