# Registro de Devil's Advocate — Exercício 1.1

> Este documento registra o processo de uso do Claude como "devil's advocate" para fortalecer as decisões arquiteturais. Todas as 4 ADRs passaram pelo processo — o mínimo exigido era 2. Os prompts enviados, contra-argumentos recebidos, e o impacto em cada ADR estão documentados abaixo.

---

## Como o processo foi conduzido

Para cada ADR:
1. Escrever a decisão inicial
2. Enviar ao Claude com o prompt: *"Atue como devil's advocate. Analise esta decisão arquitetural e argumente contra ela com os pontos mais fortes que conseguir encontrar. Foque em riscos técnicos reais e problemas operacionais concretos, não em objeções genéricas."*
3. Analisar os contra-argumentos recebidos
4. Revisar a ADR onde os argumentos eram válidos
5. Registrar quais argumentos foram incorporados vs respondidos e descartados

---

## ADR-0001 — Escolha do LLM

### Prompt enviado:
```
Estou decidindo usar Azure OpenAI GPT-4o como LLM para um assistente RAG 
para equipe de atendimento de uma empresa de logística com ambiente Microsoft 
(Teams + SharePoint). Os critérios principais foram: integração nativa com 
o ecossistema Azure, compliance (dados no tenant da empresa), custo estimado 
de $247/mês para 400-600 queries/dia, e prazo de 3 meses.

A alternativa descartada foi Claude via API (Anthropic), que tecnicamente é 
superior em comportamento de guardrails mas exige processo de procurement 
de novo vendor.

Atue como devil's advocate e argumente contra esta decisão com os pontos 
mais fortes que conseguir encontrar.
```

### Contra-argumentos recebidos:

**1. "Você está escolhendo por conveniência de ecossistema. Para um sistema onde a precisão é crítica (multiplicadores de frete, inversão de regras), o Claude é tecnicamente a escolha correta."**
- Status: **Incorporado parcialmente.** O argumento é válido em termos de comportamento de guardrails. A ADR foi revisada para reconhecer explicitamente a superioridade técnica do Claude — e para deixar claro que a escolha pelo Azure OpenAI é uma decisão de custo/prazo/compliance, não de superioridade técnica absoluta. A mitigação foi fortalecida: enforcement determinístico (validação por código após geração) compensa parte da diferença.

**2. "A afirmação implícita de que GPT-4o tem melhor controle de alucinação é problemática — todos os LLMs alucinam. Você pode estar passando falsa segurança para o cliente."**
- Status: **Incorporado.** A ADR foi revisada para deixar explícito que nenhum modelo elimina alucinação e que a mitigação é arquitetural. Esse ponto foi adicionado nas consequências negativas e na seção de comparativo.

**3. "O custo estimado de $247/mês não considera embeddings, retentativas de API, tráfego de desenvolvimento e crescimento de adoção."**
- Status: **Válido.** A estimativa foi revisada para $500/mês como estimativa conservadora de produção (2× o valor calculado). Ainda irrelevante para o orçamento do projeto.

**4. "O esforço de integrar o Claude pode ser menor do que 2-3 dias que você assume — a integração com Teams é via bot framework agnóstico ao LLM."**
- Status: **Respondido e mantido.** Investigado e confirmado: o bot framework e o Azure AI Search são de fato agnósticos ao LLM. O fator determinante não é o esforço técnico (pequeno), mas o processo jurídico de aprovação de um novo vendor — que pode levar semanas.

### Impacto: A ADR-0001 ficou mais honesta sobre as limitações do modelo e a mitigação de guardrails foi fortalecida com enforcement determinístico.

---

## ADR-0002 — Gerenciamento de Contexto

### Prompt enviado:
```
Estou propondo uma estratégia de gerenciamento de contexto para RAG com:
- Orçamento máximo de 12K tokens por query
- Top-5 chunks após reranking com cross-encoder
- Janela deslizante de histórico de 3.500 tokens (últimas ~4 trocas)
- Posicionamento: maior score no início, segundo maior no fim (contra lost in the middle)
- Threshold de similaridade de 0,70 — sem chunks abaixo do threshold

Para uma empresa de logística com documentação contraditória (PROC-042 v1 vs v2)
e sessões longas no Teams. Atue como devil's advocate.
```

### Contra-argumentos recebidos:

**1. "Truncar o histórico em 4 trocas vai frustrar atendentes. Em um chamado real, o número do CT-e ou o tier do cliente pode ter sido mencionado 10 mensagens atrás e o atendente vai esperar que o assistente 'lembre'."**
- Status: **Incorporado.** Este argumento identificou um problema real que não estava na versão inicial. A solução foi separar explicitamente: informação estruturada crítica (CT-e, tier, produto) persiste como metadados no contexto; histórico conversacional livre é gerenciado pela janela deslizante. A ADR foi revisada para incluir essa distinção.

**2. "12K tokens é arbitrário. Qual a evidência de que 12K é melhor que 8K ou 16K?"**
- Status: **Respondido.** Não é arbitrário — a tabela de orçamento mostra a origem de cada componente. A decisão de ~9,4% da janela do GPT-4o é baseada em evidências de degradação de qualidade em contextos longos, não em número redondo.

**3. "Com apenas 5 chunks, perguntas que cruzam 3 domínios (SLA + frete + devolução) podem não ter representação adequada de todos os domínios."**
- Status: **Incorporado parcialmente.** A confiança no reranker para selecionar chunks diversificados foi mantida. A mudança foi tornar o padrão conservador: top-5 (em vez de top-3) garante que perguntas multi-domínio tenham espaço para chunks de domínios diferentes. A política de corte em situação de orçamento apertado foi ordenada para preservar chunks (cortar histórico antes dos chunks).

**4. "O threshold de 0,70 é arbitrário. Pode ser muito conservador e fazer o assistente escalar perguntas que poderia responder corretamente."**
- Status: **Respondido.** O threshold deve ser calibrado empiricamente com as perguntas reais do Anexo B durante os testes de integração. O valor de 0,70 é ponto de partida — melhor errar para conservador (escalar desnecessariamente) do que errar para liberal (gerar alucinação com aparência de resposta fundamentada).

### Impacto: A ADR-0002 ganhou nuance importante sobre persistência de metadados estruturados vs histórico livre — não estava na versão inicial.

---

## ADR-0003 — Documentos Contraditórios

### Prompt enviado:
```
Estou propondo manter apenas a versão vigente de documentos no índice de RAG.
Na ingestão, cada documento recebe metadados obrigatórios (documento_id, versao, 
data_vigencia, status: vigente|obsoleto). Apenas status=vigente entra no índice 
ativo. Documentos obsoletos vão para índice de arquivo.

O problema concreto: PROC-042 v1 (mar/2023) e PROC-042-v2 (nov/2023) têm 
multiplicadores regionais diferentes (Norte: 1.6 vs 1.8). Nenhum está marcado 
como obsoleto no SharePoint hoje.

Atue como devil's advocate.
```

### Contra-argumentos recebidos:

**1. "Quem decide qual versão é 'vigente'? Você está assumindo que a NovaTech vai manter os metadados atualizados, mas o problema que motivou o projeto é exatamente a falta de governança documental."**
- Status: **Incorporado como risco crítico.** Este foi o contra-argumento mais relevante da sessão inteira. A dependência de governança da NovaTech foi adicionada como pré-condição explícita e como risco nas consequências negativas. A mitigação foi adicionada: alerta automático quando dois documentos com mesmo `documento_id` tiverem `status = vigente` — tornando o assistente um sinalizador ativo de gaps de governança.

**2. "Colocar a instrução de 'use a versão mais recente' no system prompt é frágil — em conversas longas, o modelo pode ignorar a instrução."**
- Status: **Incorporado e fortaleceu a decisão.** Este argumento foi usado para reforçar a escolha pela Opção 1 (sem instrução probabilística) em vez da Opção 2. A fragilidade do prompt é exatamente o motivo pelo qual a solução deve ser determinística na camada de dados.

**3. "E se o processo de publicação falhar? O pipeline pode indexar duas versões sem detectar o problema."**
- Status: **Incorporado.** A consequência negativa foi escrita de forma explícita: "se o processo de publicação falhar, o problema reaparece silenciosamente". A mitigação do alerta automático por conflito de `documento_id` + `status = vigente` foi adicionada precisamente para detectar esse cenário.

**4. "Atendentes que precisarem consultar o histórico de versões perderão o acesso — isso pode ser um requisito escondido."**
- Status: **Respondido e mantido.** O requisito de "consultar versões históricas" não foi identificado no discovery. Se aparecer, a solução é expor o índice de arquivo via interface separada, sem misturar com o índice ativo.

### Impacto: A ADR-0003 ganhou o risco de governança como item explícito com mitigação — o ponto mais importante da sessão e não estava na versão inicial.

---

## ADR-0004 — Build vs Buy

### Prompt enviado:
```
Estou propondo comprar: Azure AI Search + Azure Document Intelligence para 
ingestão/indexação, e LangChain para orquestração de retrieval e reranking.

O SharePoint (64% da base) tem connector nativo no Azure AI Search — reindexação 
automática em até 24h. Confluence e planilhas (36%) exigem scripts Python.

Alternativa descartada: build puro com LangChain + ChromaDB. Motivo: prazo de 
3 meses, OCR de tabelas complexas, expertise MLOps.

Atue como devil's advocate.
```

### Contra-argumentos recebidos:

**1. "ADR-0002 e ADR-0004 estão em conflito. Você decidiu usar reranker flexível com cross-encoder na ADR-0002, mas o Azure AI Search tem reranker semântico nativo que não é um cross-encoder configurável."**
- Status: **Determinante — levou à revisão da decisão.** A decisão original era buy puro. Este contra-argumento identificou um conflito direto entre ADRs. O buy puro exigiria ou rever a estratégia de reranking (aceitando qualidade inferior) ou adicionar um serviço externo de qualquer forma. A arquitetura híbrida (Azure para dados, LangChain para orquestração) foi adotada para resolver o conflito sem abrir mão de nenhum dos requisitos.

**2. "36% da base ainda exige código customizado — você superestimou a economia de tempo."**
- Status: **Incorporado.** A decisão foi revisada para reconhecer explicitamente que Confluence e planilhas exigem scripts. A nota honesta sobre o "buy" foi adicionada: o managed service economiza esforço nas etapas de maior complexidade, não em tudo.

**3. "O custo do Azure AI Search (~$245/mês no tier Standard) é maior que o custo do LLM e você mal mencionou."**
- Status: **Incorporado.** O custo recorrente foi adicionado como primeiro item das consequências negativas, com a comparação explícita com o custo do LLM para deixar claro que é o maior item operacional.

**4. "O lock-in no Azure AI Search é mais custoso de reverter do que você reconheceu."**
- Status: **Respondido e mantido.** A NovaTech é Microsoft-first e a probabilidade de migração de cloud é baixa. A arquitetura híbrida mitiga parcialmente o lock-in — a camada de orquestração (LangChain) é substituível sem reindexação completa.

### Impacto: A ADR-0004 foi a única onde o devil's advocate gerou revisão da decisão principal — de buy puro para arquitetura híbrida.

---

## Síntese: O que mudou em cada ADR

| ADR | Versão inicial | Mudança gerada pelo devil's advocate |
|-----|----------------|---------------------------------------|
| ADR-0001 | GPT-4o escolhido sem menção às limitações de guardrails | Reconheceu superioridade técnica do Claude; reforçou enforcement determinístico como mitigação; clarificou que nenhum modelo elimina alucinação |
| ADR-0002 | Janela deslizante de histórico sem distinção entre tipos de informação | Separou metadados estruturados (persistem) de histórico conversacional (janela deslizante) — distinção importante que não estava na versão inicial |
| ADR-0003 | Processo de vigência dependente da NovaTech, mas risco não explicitado | Adicionou risco de governança como item explícito + mitigação de alerta automático por conflito de vigência |
| ADR-0004 | Buy puro (Azure AI Search para tudo) | Mudou para arquitetura híbrida (Azure para dados, LangChain para orquestração) após identificar conflito com ADR-0002 |

---

## Aprendizado sobre uso do Claude como devil's advocate

O Claude identificou bem conflitos entre decisões (ADR-0002 vs ADR-0004) e riscos de processo/governança (dependência do processo de publicação da NovaTech na ADR-0003). Esses foram os contra-argumentos mais valiosos — não eram óbvios na análise inicial.

O Claude foi menos efetivo em: questionar estimativas de custo com dados reais (apenas identificou que estavam subestimadas, sem quantificar); e em avaliar o impacto de prazo dos processos jurídicos de vendor (respondeu tecnicamente, mas subestimou a complexidade burocrática em empresa de médio porte).

O processo é mais útil quando o Tech Lead já tem uma posição clara e usa o Claude para tentar derrubá-la, não para construir a posição do zero.

---

*Documento de evidência de processo — Cenário 1, Exercício 1.1*
