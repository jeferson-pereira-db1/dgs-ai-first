# Exercício 1.3 — Revisão Crítica de Proposta de RAG

---

## Proposta original do desenvolvedor júnior

> *"Vamos usar Azure AI Search com embeddings do ada-002. Todos os documentos serão indexados num único índice. Chunking fixo de 512 tokens sem overlap. O LLM recebe os 3 chunks mais similares. Usaremos GPT-4o para geração. O pipeline de ingestão roda manualmente quando alguém lembra de atualizar."*

---

## Parte 1 — Revisão do Tech Lead (feita antes de consultar IA)

### Problema 1: Chunking fixo de 512 tokens sem overlap perde contexto crítico nas fronteiras

Chunks de tamanho fixo cortam o conteúdo em posições arbitrárias, sem respeitar a estrutura semântica do documento. Para a documentação da NovaTech, isso é especialmente perigoso em dois tipos de conteúdo:

**Tabelas:** A tabela de multiplicadores regionais do PROC-042-v2 pode ser cortada no meio. Um chunk com o cabeçalho ("Região | Multiplicador") e outro com as linhas de dados ("Sul | 1.3 | Sudeste | 1.1...") são fragmentos inúteis individualmente. O atendente que pergunta "qual o multiplicador para o Norte" precisa da linha "Norte | 1.8" — que pode estar cortada entre chunks.

**Seções com contexto dependente:** O chunk POL-001-B (exceção de carga perigosa) começa com "As seguintes categorias de carga NÃO são elegíveis para devolução". Se o chunking fixo colocar o "NÃO" no final de um chunk e o restante da frase no início do próximo, o significado é perdido.

A ausência de overlap agrava o problema: quando uma informação relevante cai exatamente na fronteira entre dois chunks, ela pode estar incompleta em ambos. Não há recuperação possível — a informação está inacessível para o retriever.

**Alternativa proposta:** Chunking por seção semântica, respeitando cabeçalhos (H1-H3 em Markdown, títulos de seção em DOCX). Overlap de 10-15% entre chunks adjacentes. Tabelas e listas: manter inteiras em um único chunk, mesmo que ultrapassem 512 tokens. Adicionar metadado `tipo_conteudo` (texto | tabela | lista) para estratégias de retrieval diferenciadas.

---

### Problema 2: Apenas 3 chunks é insuficiente para perguntas multi-domínio

O caso de uso real da NovaTech inclui perguntas que cruzam múltiplos domínios em um único chamado. Exemplo concreto: *"Cliente Gold quer devolver 600kg de carga para o Norte — qual o prazo, o custo do frete reverso e o SLA do chamado?"* Essa pergunta ativa POL-001 (devolução), PROC-042-v2 (frete especial, multiplicador Norte), e SLA-2024 (Gold) — são necessários pelo menos 5-6 chunks para responder corretamente.

Com limite de 3 chunks, o modelo recebe contexto parcial e produz respostas incompletas. Pior: o modelo pode tentar completar o que falta com conhecimento próprio (alucinação), gerando uma resposta que parece completa mas usa valores inventados.

**Alternativa proposta:** Recuperar top-10 por hybrid search (vetorial + keyword), aplicar reranking com cross-encoder para selecionar top-5. Os top-5 garantem cobertura para perguntas multi-domínio sem inflar o contexto desnecessariamente.

---

### Problema 3: Índice único sem metadados de vigência mistura versões contraditórias

Com todos os documentos num único índice sem metadados, o Azure AI Search pode retornar chunks do PROC-042 v1 e do PROC-042-v2 para a mesma pergunta. O modelo recebe multiplicadores contraditórios no mesmo contexto (Norte: 1.6 vs 1.8) e tenta sintetizá-los — produzindo uma resposta que parece correta mas usa valor errado.

O resultado é silenciosamente incorreto: o atendente confia na resposta, repassa ao cliente, e o valor cobrado está errado. Esse erro pode não ser descoberto até uma reclamação formal — ou uma auditoria.

**Alternativa proposta:** Metadados obrigatórios em cada documento na ingestão: `documento_id`, `versao`, `data_vigencia`, `status` (vigente | obsoleto). Apenas documentos `status = vigente` são indexados no índice ativo. Processo acordado com as 3 áreas da NovaTech antes do go-live (ver ADR-0003).

---

### Problema 4: Ingestão manual "quando alguém lembra" é garantia de desastre em produção

"Quando alguém lembra de atualizar" não é um processo — é a ausência de processo. A documentação da NovaTech é atualizada mensalmente por 3 áreas diferentes (Operações, Compliance, Comercial) sem processo unificado. Em produção, isso significa:
- Novos documentos publicados ficam dias ou semanas fora do índice
- O assistente responde com informações desatualizadas com total confiança — sem indicação ao atendente de que a fonte pode estar desatualizada
- Nenhum mecanismo de alerta quando a ingestão falha ou está atrasada

O risco é crítico para documentos como SLA-2024 (prazos contratuais) e PROC-042 (multiplicadores de frete): respostas com valores antigos podem gerar cobranças incorretas e violações de SLA.

**Alternativa proposta:** Indexer automático do Azure AI Search para SharePoint Online (reindexação em até 24h após publicação). Para Confluence e planilhas: pipeline agendado via Azure Functions (execução diária, alertas de falha no Azure Monitor). Alerta quando a última ingestão bem-sucedida for há mais de 48h.

---

## Parte 2 — Revisão conduzida com o Claude

### Prompt enviado ao Claude:

```
Revise criticamente esta proposta de arquitetura de RAG para um assistente 
de atendimento de uma empresa de logística com ~1.250 documentos:

"Azure AI Search com embeddings do ada-002. Todos os documentos indexados 
num único índice. Chunking fixo de 512 tokens sem overlap. LLM recebe os 
3 chunks mais similares. GPT-4o para geração. Pipeline de ingestão roda 
manualmente quando alguém lembra de atualizar."

Contexto adicional:
- A base tem documentos contraditórios (PROC-042 v1 e v2 com multiplicadores 
  regionais diferentes — ex: Norte 1.6 vs 1.8)
- Um dos documentos é um FAQ informal escrito por atendentes, não validado 
  por Compliance
- Cerca de 15% dos PDFs são documentos escaneados (precisam de OCR)
- O requisito é que o assistente nunca invente prazos ou valores
- O sistema será integrado ao Microsoft Teams

Identifique problemas técnicos concretos e proponha alternativas.
```

### Problemas identificados pelo Claude:

**Problema A (Claude): ada-002 pode ser subótimo para documentação técnica em português**

O `text-embedding-ada-002` é um modelo de embedding genérico treinado majoritariamente em inglês. Para documentação técnica de logística brasileira com terminologia específica (CT-e, ANTT, multiplicadores regionais, fator de peso), um modelo com melhor suporte multilingual pode capturar melhor a similaridade semântica.

Exemplo concreto: a pergunta "quanto custa o frete para Manaus acima de 500 quilos" tem baixa similaridade lexical com o chunk "Multiplicadores regionais (novembro/2023): Norte 1.8". Um modelo com melhor representação de português pode aproximar "Manaus" de "Norte" com mais confiança que o ada-002.

**Alternativa proposta pelo Claude:** Avaliar `text-embedding-3-large` (mais recente, melhor performance multilingual que ada-002) ou modelos com fine-tuning para português. Usar o conjunto de perguntas do Anexo B como benchmark para comparação antes de decidir.

---

**Problema B (Claude): FAQ informal indexado com mesma autoridade que documentos normativos**

O FAQ-Atendimento é explicitamente marcado como "não validado por Compliance ou Operações" e pode conter informações que contradizem documentos formais. Se indexado sem diferenciação, o modelo pode citar o FAQ como fonte autoritativa para informações críticas.

Caso real do Anexo A: FAQ item 32 diz que "carga perigosa pode ser enviada com frete expresso com autorização do Compliance". Não existe documento formal que defina esse processo. Se o modelo citar o FAQ como fonte para uma pergunta crítica sobre carga perigosa, o atendente pode agir com base em informação informal não validada.

**Alternativa proposta pelo Claude:** Adicionar metadado `tipo_documento` (normativo | procedimento | informal). No retrieval, aplicar penalidade de score para documentos informais — eles só aparecem no top-5 se não houver documento normativo com score suficiente. No system prompt, instrução explícita: "quando a única fonte disponível for um documento informal (FAQ), sinalize que a informação é baseada em prática não validada e recomende confirmação com o supervisor."

---

**Problema C (Claude): Ausência de threshold de similaridade — perguntas sem cobertura geram alucinação**

Com busca por similaridade, o sistema sempre retorna os N chunks "mais similares" — mesmo que a similaridade seja baixa e os chunks sejam irrelevantes para a pergunta. O modelo recebe contexto irrelevante e tenta gerar uma resposta, produzindo alucinação com aparência de resposta fundamentada.

Exemplo crítico: perguntas sobre frete padrão (< 500kg) não têm cobertura na base. O retriever vai retornar chunks de PROC-042 (frete especial, > 500kg) como "mais similares" — o modelo pode interpretar erroneamente e gerar valores calculados pela fórmula de frete especial para uma carga que não se enquadra nela.

**Alternativa proposta pelo Claude:** Definir threshold mínimo de cosine similarity (ex: 0.70). Se nenhum chunk superar o threshold, o pipeline não envia chunks ao LLM — envia diretamente a instrução de escalação. Isso transforma um possível caso de alucinação em uma resposta conservadora e correta.

---

**Problema D (Claude): Sem estratégia de monitoramento de qualidade em produção**

A proposta não menciona como será detectado quando o assistente está respondendo mal. Sem logging de queries + chunks + respostas, não há como identificar padrões de falha, chunks que causam confusão consistente, ou degradação após atualização de documentos.

**Alternativa proposta pelo Claude:** Logging de todas as queries com: pergunta, chunks recuperados com scores, resposta gerada, e flag de feedback do atendente ("útil / não útil"). Dashboard de qualidade com revisão semanal nas primeiras 4 semanas.

---

## Parte 3 — Comparação entre revisões

| Problema | Fonte | Avaliação |
|----------|-------|-----------|
| Chunking fixo sem overlap perde contexto em tabelas e fronteiras semânticas | Tech Lead | Crítico — especialmente para tabelas de frete com 15+ colunas |
| Apenas 3 chunks insuficiente para perguntas multi-domínio | Tech Lead | Crítico — perguntas reais cruzam SLA + frete + devolução simultaneamente |
| Índice único mistura versões contraditórias | Tech Lead | O mais urgente — causa alucinação silenciosa com aparência de resposta correta |
| Ingestão manual é risco operacional garantido | Tech Lead | Problema de processo, não técnico — igualmente crítico para qualidade em produção |
| ada-002 pode ser subótimo para português técnico de logística | Claude | Válido, mas de menor prioridade para v1 — diferença de qualidade menor que os problemas acima |
| FAQ informal com mesma autoridade que documentos normativos | Claude | Excelente ponto — não havia pensado no risco específico do FAQ ser citado como fonte autoritativa |
| Ausência de threshold de similaridade gera alucinação em perguntas sem cobertura | Claude | Crítico — sem threshold, frete padrão (< 500kg) gera alucinação em vez de escalação |
| Sem monitoramento de qualidade em produção | Claude | Importante, mas mais relevante para fase pós go-live |

**O que o Claude identificou que o Tech Lead não viu:**
- O risco específico do FAQ informal ser tratado como fonte de mesma autoridade que documentos normativos (e a solução elegante de metadado de confiabilidade + penalidade de score)
- A necessidade de threshold de similaridade — sem isso, perguntas sem cobertura geram alucinação silenciosa

**O que o Tech Lead identificou que o Claude não mencionou:**
- O impacto concreto do chunking fixo em tabelas — o Claude mencionou chunking como problema geral, mas não destacou o caso específico de tabelas cortadas no meio
- O problema de processo da ingestão manual — o Claude focou em aspectos técnicos do pipeline; o risco de processo humano ("quando alguém lembra") é igualmente real e foi o ponto mais específico ao contexto da NovaTech

---

## Parte 4 — Proposta Reescrita

> **Proposta revisada — NovaTech Assistente de Atendimento, Pipeline de RAG v1**

**Stack:**
- Azure Document Intelligence (extração e OCR)
- Azure AI Search (vector store + hybrid search)
- Azure OpenAI `text-embedding-3-large` para embeddings (substituindo ada-002)
- LangChain para orquestração de retrieval, reranking e montagem de contexto
- GPT-4o para geração (via Azure OpenAI, temperature=0)

**Ingestão e indexação:**
- Indexer automático do Azure AI Search para SharePoint Online — reindexação em até 24h após publicação de novo documento, sem código adicional
- Pipeline agendado via Azure Functions para Confluence e planilhas (execução diária, alertas de falha no Azure Monitor quando a última ingestão bem-sucedida for há mais de 48h)
- Metadados obrigatórios em cada documento na ingestão: `documento_id`, `versao`, `data_vigencia`, `status` (vigente | obsoleto), `tipo_documento` (normativo | procedimento | informal)
- Apenas documentos com `status = vigente` são indexados no índice ativo
- Documentos obsoletos são arquivados em índice separado (fora do retrieval, disponível para auditoria)
- Alerta automático quando dois documentos com mesmo `documento_id` tiverem `status = vigente`

**Chunking:**
- Chunking por seção semântica, respeitando estrutura do documento (cabeçalhos H1-H3 em Markdown, títulos de seção em DOCX)
- Overlap de 10-15% entre chunks adjacentes para preservar contexto nas fronteiras
- Tabelas e listas são mantidas inteiras em um único chunk, mesmo que ultrapassem o tamanho-alvo de 800 tokens
- Metadado `tipo_conteudo` (texto | tabela | lista) em cada chunk para estratégias de retrieval diferenciadas no futuro

**Retrieval e reranking:**
- Azure AI Search retorna top-10 chunks por hybrid search (vetorial + keyword)
- Threshold mínimo de cosine similarity: 0.70. Chunks abaixo do threshold são descartados
- Se nenhum chunk superar o threshold: o pipeline não envia chunks ao LLM — envia instrução de escalação diretamente. Isso evita que perguntas sem cobertura (frete padrão < 500kg) gerem alucinação
- LangChain aplica reranking com cross-encoder nos chunks que passaram pelo threshold, selecionando top-5
- Chunks do FAQ-Atendimento (`tipo_documento = informal`) recebem penalidade de score no reranking — só entram no top-5 se não houver chunk normativo com score suficiente

**Montagem de contexto:**
- Orçamento total: ~12K tokens (conforme ADR-0002)
- Posicionamento: maior score no início, segundo maior no fim (mitiga *lost in the middle*)
- Histórico de conversa: janela deslizante de 4 trocas; metadados estruturados (CT-e, tier) persistem separadamente

**Geração:**
- GPT-4o com temperature=0
- System prompt v1.0 com guardrails explícitos (R1-R6)
- Camada de enforcement determinístico pós-geração: verificação de citação de fonte (regex), blocklist de termos proibidos (Platinum, "acredito que"), verificação de tamanho

**Monitoramento:**
- Logging de todas as queries: pergunta, chunks recuperados com scores, resposta gerada, timestamp
- Flag de feedback do atendente ("útil / não útil") integrado ao Teams
- Dashboard de qualidade com revisão semanal nas primeiras 4 semanas de produção
- Alerta automático quando taxa de respostas "não útil" superar 15% em 24h
