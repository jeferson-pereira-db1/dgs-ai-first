# ADR-0002: Estratégia de Gerenciamento de Contexto

## Status: Aceito (revisado após devil's advocate)

---

## Contexto

O assistente opera sobre uma base de ~12M tokens de documentação. A cada query, o LLM não recebe a base inteira — recebe um contexto montado dinamicamente. A qualidade da resposta depende diretamente de como esse contexto é composto, não apenas de qual modelo é usado.

**Forças que atuam nesta decisão:**

**Orçamento de contexto limitado:** O GPT-4o tem janela de 128K tokens, mas usar toda a janela não é desejável. Contextos grandes aumentam latência, custo e o risco de *context rot* — fenômeno em que o modelo, sobrecarregado com informação, começa a ignorar partes do contexto e gera respostas baseadas em inferência própria em vez dos documentos fornecidos.

**Efeito *lost in the middle*:** LLMs processam melhor informação no início e no fim do contexto. Chunks posicionados no meio de um contexto longo têm menor probabilidade de influenciar a resposta — o chunk mais relevante pode ser ignorado simplesmente por sua posição. Para um sistema onde a precisão factual é crítica (multiplicadores de frete, prazos contratuais), esse efeito é inaceitável sem mitigação.

**Perguntas multi-domínio:** Atendentes frequentemente cruzam domínios em uma única pergunta. Exemplo concreto do cenário NovaTech: *"Cliente Gold quer devolver 600kg de carga para o Norte — qual o prazo da devolução, o custo do frete reverso e o SLA do chamado?"* Essa única pergunta ativa POL-001 (devolução), PROC-042-v2 (frete especial, Norte = 1.8), e SLA-2024 (Gold = 2h/24h) — pelo menos 5-6 chunks relevantes.

**Conversas longas no Teams:** O assistente será integrado ao Teams, onde o atendente pode fazer múltiplas perguntas na mesma sessão. O histórico da conversa cresce a cada turno e compete com os chunks por espaço no contexto. Em sessões longas, o histórico pode dominar o orçamento, empurrando os chunks relevantes para fora — isso é *context rot* em modo de uso real.

**Documentos contraditórios:** A base tem versões conflitantes do mesmo documento (PROC-042 v1 vs v2). Se ambas forem recuperadas para a mesma query, o modelo recebe multiplicadores contraditórios (Norte: 1.6 vs 1.8) e tenta sintetizá-los — produzindo uma resposta que parece fundamentada mas usa valores incorretos.

**Questões que esta ADR responde:**
1. Qual o tamanho máximo de contexto por query?
2. Quantos chunks são recuperados e como são posicionados no prompt?
3. Como tratar perguntas que cruzam múltiplos domínios?
4. Como gerenciar o histórico de conversa no Teams sem degradar a qualidade?

---

## Decisão

Adotaremos uma estratégia de **contexto orçamentado com janela deslizante de histórico e posicionamento estratégico de chunks**.

### 1. Orçamento de contexto por query

O contexto total por query será limitado a **12K tokens**, distribuídos assim:

| Parte | Tipo | Orçamento | Justificativa |
|-------|------|-----------|---------------|
| System prompt | Estático | ~1.800 tokens | Identidade, guardrails, formato de resposta |
| Metadados do cliente | Dinâmico | ~300 tokens | Tier, ID chamado, atendente, timestamp |
| Chunks recuperados (top-5) | Dinâmico | ~5.000 tokens | 5 chunks × ~1.000 tokens (com margem para tabelas) |
| Histórico de conversa | Dinâmico, crescente | ~3.500 tokens | Últimas 4 trocas (janela deslizante) |
| Pergunta atual | Dinâmico | ~150 tokens | Pergunta típica de atendimento |
| Buffer de segurança | — | ~1.250 tokens | Variação de tamanho de chunks |
| **Total** | | **~12.000 tokens** | **~9,4% da janela do GPT-4o** |

Usar apenas ~9,4% da janela disponível é intencional. Pesquisas sobre performance de LLMs em janelas longas mostram degradação progressiva a partir de ~16K tokens — manter contextos enxutos é uma decisão de qualidade, não de economia.

### 2. Número de chunks, reranking e posicionamento

**Recuperação:** O pipeline buscará os **top-10 chunks** por hybrid search (vetorial + keyword) no Azure AI Search.

**Reranking:** Após recuperação, um reranker (cross-encoder, ex: Cohere Rerank ou BGE-reranker-v2) seleciona os **top-5 chunks** mais relevantes para a pergunta específica. O reranking resolve o problema que a busca vetorial não consegue: diferenciar o chunk que "fala sobre o mesmo tema" do chunk que "responde a pergunta".

Exemplo: para "qual o prazo de devolução para carga perigosa?", a busca vetorial pode trazer chunks sobre devolução em geral (alta similaridade semântica) e perder o chunk POL-001-B que contém a exceção específica. O reranker resolve isso.

**Posicionamento (mitigação de *lost in the middle*):**

```
[SYSTEM PROMPT]
[METADADOS DO CLIENTE]
[CHUNK #1 — maior score de reranking]
[CHUNK #2 — score médio]
[CHUNK #3 — score médio]
[CHUNK #4 — score médio]
[CHUNK #5 — segundo maior score de reranking]
[HISTÓRICO DE CONVERSA]
[PERGUNTA ATUAL]
```

O chunk de maior relevância fica na posição 1 (início do contexto de documentação); o segundo mais relevante, na posição 5 (fim do contexto de documentação). As duas posições com maior atenção do modelo recebem os chunks mais críticos.

### 3. Perguntas multi-domínio

Quando a pergunta ativa múltiplos domínios, o reranker naturalmente seleciona chunks de fontes diferentes. Para a pergunta de exemplo (devolução + frete + SLA), o reranker selecionará chunks de POL-001, PROC-042-v2 e SLA-2024 nos top-5 — sem necessidade de lógica especial de "detecção de domínio".

O system prompt instrui o modelo a integrar informações de múltiplas fontes e citar cada fonte separadamente: *"Resposta baseada em: POL-001 seção 3.2 (prazo de devolução), PROC-042-v2 seção 2.1 (multiplicador Norte = 1.8), SLA-2024 seção 2 (SLA Gold = 24h de resolução)."*

### 4. Gerenciamento de histórico no Teams

O histórico de conversa é gerenciado com **janela deslizante de 3.500 tokens**: apenas as últimas N trocas que caibam nesse orçamento são incluídas no contexto. Mensagens mais antigas são descartadas do contexto (mas armazenadas em log para auditoria).

**Distinção importante (revisada após devil's advocate):** Há dois tipos de informação no histórico:
- **Informação estruturada** (número do CT-e, tier do cliente, produto discutido): persiste como metadados estruturados nos campos do contexto, não no histórico livre
- **Histórico conversacional** (formulação da pergunta anterior, confirmações, contexto implícito): esse é gerenciado pela janela deslizante

Isso garante que informações críticas (o CT-e informado 5 mensagens atrás) não se percam quando o histórico é truncado.

**Política de corte quando o orçamento estiver em risco:**
1. Reduzir histórico conversacional para as 2 trocas mais recentes (~1.500 tokens)
2. Reduzir chunks de top-5 para top-3 (~3.000 tokens em vez de 5.000)
3. Se ainda acima do limite: descartar histórico completamente (os metadados estruturados permanecem)

O system prompt e a pergunta atual nunca são cortados.

### 5. Threshold de similaridade (adicionado após revisão)

Se nenhum chunk recuperado superar o threshold mínimo de cosine similarity de 0,70 após reranking, o pipeline não envia chunks ao LLM — envia diretamente a instrução de escalação. Isso previne que perguntas sem cobertura (ex: frete padrão < 500kg, que não tem documento na base) gerem alucinação confiante em vez de escalação correta.

---

## Consequências

**Positivas:**
- Contexto enxuto (12K tokens) mantém latência baixa (~1-2s) e custo previsível
- O reranking reduz o risco de chunks irrelevantes ou de versões erradas de documentos (PROC-042 v1 vs v2) entrarem no contexto
- A janela deslizante de histórico previne *context rot* em sessões longas no Teams
- A separação entre metadados estruturados e histórico livre preserva informações críticas sem inflar o orçamento
- O posicionamento estratégico de chunks mitiga *lost in the middle* de forma determinística

**Negativas:**
- O reranker adiciona latência extra (~100-300ms dependendo do modelo) e complexidade operacional ao pipeline
- Limitar a top-5 chunks pode ser insuficiente para perguntas extremamente complexas que cruzam 4+ domínios simultaneamente
- O atendente precisa ser informado que em sessões longas o assistente pode "não lembrar" de perguntas anteriores — essa limitação precisa estar documentada no treinamento de uso
- Perguntas sobre tabelas muito grandes (tabela de frete com 15+ colunas) podem não ser bem atendidas com chunks de ~1.000 tokens — o chunk pode precisar de estratégia de chunking especial para tabelas

---

## Processo de devil's advocate

**Contra-argumento 1: "Truncar o histórico vai frustrar atendentes — em um chamado real, informação de 5 mensagens atrás pode ser relevante (número do CT-e, dados do cliente informados no início da sessão)."**

Status: **Incorporado.** Este argumento identificou um problema real. A solução foi separar explicitamente informação estruturada (persistida como metadados) de histórico livre (gerenciado pela janela deslizante). A ADR foi revisada para incluir essa distinção — que não estava na versão inicial.

**Contra-argumento 2: "12K tokens é arbitrário. Por que não 8K? Por que não 20K?"**

Status: **Respondido e mantido.** Não é arbitrário — é a soma dos orçamentos por parte com buffer de segurança. A tabela foi adicionada para mostrar a origem de cada componente. A decisão de usar ~9,4% da janela do GPT-4o é baseada em evidências de degradação de qualidade em contextos longos, não em uma preferência de número redondo.

**Contra-argumento 3: "Sem detecção explícita de multi-domínio, você vai ter perguntas complexas que recebem apenas chunks de um único domínio."**

Status: **Incorporado parcialmente.** A confiança no reranker para selecionar chunks de múltiplos domínios foi mantida como abordagem principal — ela é mais robusta que heurísticas de palavras-chave. A mudança foi tornar o padrão mais conservador: top-5 chunks (em vez de top-3) garante que, mesmo em perguntas multi-domínio, haja espaço para pelo menos 1-2 chunks de cada domínio relevante.

---

## Alternativas descartadas

### Usar a janela inteira do GPT-4o (128K tokens)
A base tem 12M tokens — a janela inteira não cobriria nem 1% da documentação. Além disso, o GPT-4o não processa 128K tokens com atenção uniforme — a qualidade degrada em contextos longos (*context rot*). Um contexto enxuto e bem curado produz respostas melhores que um contexto grande e ruidoso. Descartada.

### Sem reranking — usar diretamente os top-N chunks por similaridade vetorial
Busca vetorial é boa para encontrar chunks "sobre o mesmo tema", mas não para identificar qual chunk responde especificamente a pergunta. O reranker resolve isso com custo operacional pequeno (~100-300ms). A diferença de qualidade justifica o custo. Descartada.

### Histórico completo da sessão no contexto
O histórico cresce indefinidamente e eventualmente domina o orçamento de contexto — deixando menos espaço para os chunks da pergunta atual. É exatamente o *context rot* que esta ADR visa prevenir. A janela deslizante é o trade-off correto: mantém continuidade suficiente para desambiguação sem sacrificar o espaço de chunks. Descartada.
