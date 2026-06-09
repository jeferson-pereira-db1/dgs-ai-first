# ADR-0004: Build vs Buy para o Pipeline de RAG

## Status: Aceito (revisado — arquitetura híbrida em vez de buy puro)

---

## Contexto

O projeto precisa de um pipeline de RAG que ingira documentos das três fontes da NovaTech (SharePoint, Confluence, planilhas XLSX), crie embeddings, armazene num vector store, e recupere chunks relevantes a cada query.

**Forças que atuam nesta decisão:**

**Prazo:** 3 meses para discovery + desenvolvimento + go-live. Tempo restrito favorece soluções que reduzem código a escrever e infraestrutura a operar. Cada semana gasta configurando infraestrutura open-source é uma semana a menos de desenvolvimento.

**Stack existente:** A NovaTech tem Microsoft 365 E3 e está disposta a provisionar Azure AI Services. O SharePoint — maior fonte (~800 documentos, 64% da base) — já está no ecossistema Microsoft com conectores nativos disponíveis.

**Volume e complexidade do conteúdo:**
- ~1.250 fontes no total (800 PDFs/DOCX + 400 páginas wiki + 50 planilhas)
- PDFs com tabelas complexas (15+ colunas) — extração não trivial
- ~15% dos PDFs são documentos escaneados (OCR necessário)
- Wiki do Confluence com links internos e macros customizadas
- Planilhas XLSX com fórmulas interdependentes

**Requisito de reranking:** A ADR-0002 define reranking com cross-encoder como requisito para mitigar o efeito *lost in the middle*. Esse requisito criou conflito com a opção de buy puro, que foi identificado e resolvido no processo de devil's advocate.

**Atualização contínua:** A documentação é atualizada mensalmente por 3 áreas diferentes. O pipeline de ingestão precisa ser reexecutado periodicamente — idealmente de forma automatizada, sem intervenção manual.

**Opções consideradas:**
1. Build puro: LangChain/LlamaIndex + ChromaDB ou FAISS (open-source, self-hosted)
2. Buy puro: Azure AI Search + Azure OpenAI + Azure Document Intelligence (managed)
3. Híbrido: Azure AI Search para ingestão/indexação + LangChain para orquestração de retrieval

---

## Decisão

Adotaremos a **Opção 3 — Arquitetura híbrida**: Azure AI Search + Azure Document Intelligence para a camada de dados (ingestão, extração, indexação), e **LangChain para orquestração de retrieval, reranking e montagem de contexto**.

Esta decisão foi revisada em relação à proposta inicial (buy puro). O processo de devil's advocate identificou um conflito direto: a ADR-0002 define reranking com cross-encoder como requisito, e o reranker nativo do Azure AI Search não oferece flexibilidade suficiente para implementar um cross-encoder personalizado. A arquitetura híbrida resolve o conflito: o managed service cuida do que faz bem (ingestão, OCR, indexação, connector SharePoint), e o LangChain cuida da camada de inteligência do pipeline.

**Componentes e responsabilidades:**

| Etapa do pipeline | Componente | Natureza | Justificativa |
|-------------------|------------|----------|---------------|
| Extração de texto (PDFs, DOCX, OCR) | Azure Document Intelligence | Gerenciado | OCR de tabelas complexas superior ao Tesseract sem fine-tuning |
| Chunking e indexação | Azure AI Search (indexer nativo) | Gerenciado | Sem código customizado para SharePoint |
| Embeddings | Azure OpenAI (text-embedding-3-large) | Gerenciado | Melhor que ada-002 para documentação técnica em português |
| Vector store | Azure AI Search (índice vetorial) | Gerenciado | Hybrid search (vetorial + keyword) nativo |
| Retrieval inicial (top-10) | Azure AI Search (hybrid search) | Gerenciado | Alta qualidade de recall sem código |
| Reranking (top-10 → top-5) | LangChain + cross-encoder (ex: Cohere Rerank) | Código próprio | Flexibilidade exigida pela ADR-0002 |
| Montagem de contexto e posicionamento | LangChain | Código próprio | Controle preciso sobre orçamento e ordenação |
| Threshold de similaridade | LangChain | Código próprio | Determina se há resposta ou escalação |
| Geração | Azure OpenAI GPT-4o | Gerenciado | Conforme ADR-0001 |

**Sobre o connector SharePoint:** O Azure AI Search tem indexer nativo para SharePoint Online — documentos novos são reindexados automaticamente em até 24h sem código adicional. Cobre ~64% da base documental.

**Sobre Confluence e planilhas:** Não há indexer nativo Azure para Confluence. Para essas fontes (~36% da base), será necessário um script de extração periódica (Python + API do Confluence) que deposita o conteúdo em blob storage Azure, de onde o AI Search indexa. Planilhas XLSX seguem o mesmo fluxo via Document Intelligence.

**Nota honesta sobre o "buy":** O buy puro não elimina 100% do código customizado — os 36% de fontes sem connector nativo exigem scripts de extração. A economia de tempo do managed service é real, mas menor do que parecia antes da análise detalhada.

---

## Consequências

**Positivas:**
- O managed service cuida das etapas de maior complexidade operacional (extração, OCR, indexação, atualização automática do SharePoint) sem necessidade de expertise MLOps
- O indexer nativo do SharePoint resolve o requisito de atualização em 24h para 64% da base sem código adicional
- OCR via Azure Document Intelligence tem qualidade superior ao Tesseract para tabelas complexas — o tipo de conteúdo predominante na base da NovaTech
- LangChain na camada de orquestração mantém flexibilidade total para reranking e montagem de contexto — alinhado com ADR-0002
- A separação de responsabilidades (Azure para dados, LangChain para inteligência) facilita a substituição de componentes individualmente
- Toda a infraestrutura de dados fica dentro do tenant Azure — mesma decisão de compliance da ADR-0001

**Negativas:**
- **Custo recorrente significativo:** Azure AI Search (tier Basic) custa ~$73/mês; tier Standard (necessário para volume > 1.000 docs/índice) custa ~$245/mês. Esse é o maior item de custo operacional do sistema — ~3× maior que o custo do LLM (~$247/mês). Precisa estar explicitamente no orçamento aprovado pela NovaTech
- **Lock-in na camada de dados:** Migrar o índice do Azure AI Search para outra plataforma exige reindexação completa da base. O LangChain mitiga o lock-in na orquestração, mas não na camada de dados
- **Confluence e planilhas exigem código customizado:** 36% da base não tem connector nativo — a economia de tempo do managed service é parcial
- **LangChain como dependência:** Biblioteca com ciclo de releases acelerado e histórico de breaking changes. Precisa de política explícita de versionamento (ex: pinnar versão específica no requirements.txt, sem `>=`)
- **Diagnóstico limitado no Azure AI Search:** O chunking interno do AI Search tem visibilidade parcial — problemas em documentos muito complexos podem ser difíceis de depurar sem acesso ao índice interno

---

## Processo de devil's advocate

**Objeção 1: "36% da base ainda exige código customizado — você superestimou a economia de tempo do buy."**

Status: **Incorporado.** A decisão foi revisada para reconhecer explicitamente que Confluence e planilhas exigem scripts de extração de qualquer forma. A comparação realista com o build puro é que o managed service economiza esforço nas etapas de maior complexidade (OCR de tabelas, connector SharePoint), não em tudo.

**Objeção 2: "O custo do Azure AI Search é de 2-5× o custo do LLM e você mal mencionou."**

Status: **Incorporado.** O custo recorrente (~$245/mês no tier Standard) foi adicionado explicitamente nas consequências negativas com destaque, e a comparação com o custo do LLM foi incluída para deixar claro que é o maior item operacional do sistema.

**Objeção 3: "ADR-0002 e ADR-0004 estão em conflito — você decidiu usar reranker flexível mas escolheu plataforma com reranker rígido."**

Status: **Determinante — levou à revisão da decisão.** Esta objeção foi a mais importante. A decisão original era buy puro. O devil's advocate identificou o conflito direto com ADR-0002: o reranker nativo do Azure AI Search não permite implementar um cross-encoder personalizado. Manter o buy puro exigiria rever a estratégia de reranking (aceitando qualidade inferior) ou adicionar um serviço externo de qualquer forma — perdendo a simplicidade que justificava o buy. A arquitetura híbrida resolve o conflito.

**Objeção 4: "O lock-in é mais sério do que você reconheceu — a NovaTech pode decidir sair do Azure."**

Status: **Respondido e mantido.** A NovaTech é Microsoft-first (Microsoft 365 E3, Azure provisionado) e a probabilidade de migração de cloud nos próximos 3-5 anos é baixa. O lock-in é um trade-off aceitável dado o perfil do cliente. A arquitetura híbrida mitiga parcialmente o lock-in mantendo LangChain na orquestração.

---

## Alternativas descartadas

### Buy puro: Azure AI Search + Azure AI Foundry para toda a orquestração
Foi a decisão inicial, revisada após o processo de devil's advocate. O problema central: o reranker nativo não oferece flexibilidade para o cross-encoder definido na ADR-0002. Manter o buy puro exigiria ou aceitar qualidade inferior de retrieval ou adicionar um serviço externo de reranking de qualquer forma. A arquitetura híbrida resolve com menos compromisso.

### Build puro: LangChain + ChromaDB/FAISS (open-source, self-hosted)
Oferece controle total e custo de infraestrutura potencialmente menor no longo prazo. Descartada por três razões: (1) configurar e operar ChromaDB/FAISS em produção com qualidade consome semanas em um prazo de 3 meses; (2) OCR de tabelas complexas com Tesseract exige tuning que o Azure Document Intelligence entrega sem esforço; (3) o connector nativo do SharePoint — que cobre 64% da base — não tem equivalente open-source de qualidade comparável.

**Condição de revisão para build puro:** Se o volume crescer para centenas de milhares de documentos, se o custo do Azure AI Search se tornar proibitivo, ou se a NovaTech contratar equipe técnica para operar infraestrutura própria, o build puro deve ser reavaliado.
