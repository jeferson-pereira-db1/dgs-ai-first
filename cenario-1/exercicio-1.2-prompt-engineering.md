# Exercício 1.2 — Prompt Engineering como Artefato de Arquitetura

## NovaTech Assistente de Atendimento — Estratégia de Prompt Engineering e Contexto

---

## 1. Versionamento e Governança de Prompts

### Estrutura do repositório

Os prompts são tratados como código e versionados no mesmo repositório do projeto:

```
/prompts
  /system
    novatech-assistant-v1.0.md       ← system prompt em produção
    novatech-assistant-v1.1.md       ← versão em staging/revisão
    CHANGELOG.md                     ← histórico de alterações com justificativa
  /templates
    chunk-assembly.py                ← lógica de montagem de contexto
    context-budget.py                ← gerenciamento de orçamento de tokens
  /test
    run-tests.py                     ← script de teste automatizado
    test-cases.json                  ← casos de teste com perguntas e respostas esperadas
```

### Convenção de nomenclatura

`{projeto}-{componente}-v{MAJOR}.{MINOR}.md`

- **MAJOR:** muda quando guardrails fundamentais mudam ou o comportamento do assistente muda de forma significativa (ex: adição de novo domínio, mudança de persona, reformulação das regras absolutas)
- **MINOR:** muda em ajustes finos (ex: reformulação de instrução existente, adição de exemplo, ajuste de formato de resposta)

Exemplo: `novatech-assistant-v1.2.md`

### Processo de alteração de prompt

| Etapa | Responsável | Critério de avanço |
|-------|-------------|-------------------|
| Proposta de alteração | Desenvolvedor ou Product Specialist | PR com justificativa técnica e casos de teste afetados |
| Revisão de impacto | Tech Lead | Verificar se casos de teste existentes serão quebrados |
| Teste em staging | QA | Rodar suite completa — nenhuma regressão pode ser ignorada |
| Aprovação | Tech Lead + Product Specialist | Validação do comportamento esperado nos casos críticos |
| Deploy em produção | Tech Lead | Merge + tag de versão no repositório + atualização do CHANGELOG |

**Regra inegociável:** Nenhuma alteração de prompt vai a produção sem passar pela suite de testes automatizados. Alterações de prompt têm o mesmo risco de regressão que alterações de código.

**Quem pode propor alterações:** Qualquer membro do time pode propor (desenvolvedor, PS, QA). Apenas Tech Lead + Product Specialist podem aprovar.

---

## 2. Anatomia do Contexto — O que o Modelo Recebe por Query

### 2.1 Partes do contexto: estático vs dinâmico

| Parte | Tipo | Descrição | Frequência de mudança |
|-------|------|-----------|----------------------|
| System prompt | **Estático** | Identidade, regras absolutas, formato de resposta, guardrails | Raramente (semanas/meses) |
| Metadados do cliente | **Dinâmico** | Tier do cliente, ID do chamado, atendente, timestamp | Muda por chamado |
| Chunks recuperados | **Dinâmico** | Top-5 trechos dos documentos retornados após reranking | Muda por pergunta |
| Histórico de conversa | **Dinâmico, crescente** | Últimas N trocas da sessão no Teams (janela deslizante) | Cresce por turno |
| Pergunta atual | **Dinâmico** | Input do atendente | Muda por turno |

### 2.2 Estimativa de tokens por parte

| Parte | Estimativa (tokens) | Base do cálculo |
|-------|---------------------|-----------------|
| System prompt | ~1.800 | Texto completo da v1.0 abaixo |
| Metadados do cliente | ~250 | Tier + ID chamado + nome atendente + timestamp |
| Chunks recuperados (top-5) | ~5.000 | 5 chunks × ~1.000 tokens (com margem para tabelas) |
| Histórico de conversa (4 trocas) | ~3.500 | ~875 tokens por troca de pergunta + resposta |
| Pergunta atual | ~150 | Pergunta típica de atendimento |
| **Total estimado por query** | **~10.700 tokens** | |
| **Margem disponível (GPT-4o 128K)** | **~117.300 tokens** | 91,6% da janela preservada |

### 2.3 Orçamento de contexto e política de corte

Limite de alerta: **12.000 tokens** por query. Quando o total estimado superar esse limite:

1. **Corte 1:** Reduzir histórico de conversa para as 2 trocas mais recentes (~1.500 tokens economizados)
2. **Corte 2:** Reduzir chunks de top-5 para top-3 (~2.000 tokens economizados)
3. **Corte 3 (último recurso):** Descartar histórico completamente — apenas metadados estruturados permanecem

**Regra inviolável:** System prompt e pergunta atual nunca são cortados.

**Justificativa da ordem de corte:** O histórico livre é cortado primeiro porque os metadados estruturados (tier, CT-e) já preservam as informações críticas da sessão. Os chunks são cortados por último porque a qualidade da resposta depende fundamentalmente dos documentos recuperados.

### 2.4 Posicionamento dos chunks no contexto

Para mitigar o efeito *lost in the middle* (informação no meio do contexto recebe menos atenção):

```
[SYSTEM PROMPT]
[METADADOS DO CLIENTE: tier, ID chamado, atendente]
[CHUNK #1 — maior score de reranking]        ← posição de máxima atenção
[CHUNK #2 — score médio]
[CHUNK #3 — score médio]
[CHUNK #4 — score médio]
[CHUNK #5 — segundo maior score de reranking] ← segunda posição de máxima atenção
[HISTÓRICO DE CONVERSA]
[PERGUNTA ATUAL]
```

**Por que essa ordem importa:** O GPT-4o processa o início e o fim do contexto com mais atenção que o meio. Colocar os dois chunks mais relevantes nas extremidades do bloco de documentação garante que as informações críticas sejam processadas com prioridade. Um chunk sobre a exceção de carga perigosa (POL-001-B) que vai para a posição 3 de 5 tem risco de ser ignorado.

---

## 3. System Prompt — Versão 1.0

O system prompt abaixo está no arquivo `/prompts/system/novatech-assistant-v1.0.md`.

```
# IDENTIDADE

Você é o Assistente de Atendimento da NovaTech, empresa de logística.
Seu papel é ajudar os atendentes a encontrar respostas corretas e precisas 
sobre procedimentos, SLAs, políticas de devolução e cálculo de fretes, 
com base exclusivamente na documentação oficial da NovaTech fornecida abaixo.

Você é uma ferramenta de consulta à documentação, não um chatbot genérico. 
Toda resposta deve ser rastreável a um documento fonte. Você não tem "conhecimento 
próprio" sobre as regras da NovaTech — você só sabe o que está nos documentos 
fornecidos nesta conversa.

---

# REGRAS ABSOLUTAS (nunca viole estas regras, em nenhuma circunstância)

R1. **Cite sempre a fonte.** Toda informação factual deve vir acompanhada do 
documento de origem e seção (ex: "Conforme POL-001, seção 3.2..."). 
Nunca afirme algo factual sem citar a fonte.

R2. **Nunca invente valores, prazos ou procedimentos.** Se a informação não 
estiver nos documentos fornecidos, diga explicitamente que não encontrou. 
Não complete com estimativas, conhecimento geral ou inferências.

R3. **Quando não encontrar resposta, oriente a escalar.** Use exatamente esta 
formulação: "Não encontrei essa informação na documentação disponível. 
Recomendo escalar para o supervisor ou consultar diretamente a área responsável."

R4. **Priorize sempre a versão vigente dos documentos.** Se os documentos 
fornecidos contiverem datas de emissão, use a versão com data mais recente. 
Se houver inconsistência entre versões, sinalize: "Identifiquei versões 
diferentes deste documento com informações conflitantes. A versão mais 
recente indica [X]."

R5. **Não existem outros tiers de cliente além de Gold, Silver e Standard.** 
Se o atendente mencionar "Platinum", "Diamond", "VIP" ou qualquer outro tier, 
oriente que esse tier não existe e peça o número do contrato para verificar 
o tier correto.

R6. **Responda em português formal, mas acessível.** Sem jargão técnico 
desnecessário. O atendente precisa entender e repassar a informação ao 
cliente imediatamente.

---

# CONTEXTO DO ATENDIMENTO

Tier do cliente: {{TIER_CLIENTE}}
ID do chamado: {{ID_CHAMADO}}
Atendente: {{NOME_ATENDENTE}}
Timestamp: {{TIMESTAMP}}

---

# DOCUMENTAÇÃO DISPONÍVEL

Os trechos abaixo foram recuperados da base de documentação oficial da NovaTech 
com base na pergunta do atendente. Use APENAS estas informações para responder. 
Não use conhecimento que não esteja presente nestes trechos.

{{CHUNKS_RECUPERADOS}}

---

# HISTÓRICO DA CONVERSA NESTA SESSÃO

{{HISTORICO_CONVERSA}}

---

# FORMATO DA RESPOSTA

Estruture sua resposta assim:

**Resposta:** [Resposta direta e objetiva em 2-4 frases]

**Fonte:** [Documento(s) e seção(ões) de onde veio a informação]

**Atenção:** [SOMENTE se houver exceção crítica, risco ou informação que o 
atendente precisa saber antes de repassar ao cliente — caso contrário, OMITA 
esta seção completamente]

---

# PERGUNTA DO ATENDENTE

{{PERGUNTA_ATUAL}}
```

---

## 4. Enforcement: Probabilístico vs Determinístico

### 4.1 Definição

**Probabilístico:** Instrução no prompt que o modelo *tenta* seguir. Funciona na maioria dos casos, mas não pode ser garantido — o modelo pode não seguir em perguntas ambíguas, contextos contraditórios, ou quando o contexto é longo.

**Determinístico:** Validação feita por código após o modelo gerar a resposta, antes de entregar ao atendente. Binário: passa ou bloqueia. Não depende do modelo.

### 4.2 Guardrails probabilísticos (no prompt)

| Guardrail | Por que é probabilístico | Risco |
|-----------|--------------------------|-------|
| Citar a fonte da resposta | O modelo decide como e onde citar — não é binário | Alto — mitigado por validação determinística |
| Tom formal e acessível | Julgamento de linguagem — não verificável por regex | Baixo |
| Orientar escalação quando não souber | O modelo decide quando "não sabe" — depende de interpretação | Médio |
| Não misturar versões de documentos | Requer que o modelo interprete metadados de data | Alto — mitigado pela ADR-0003 (índice só tem versão vigente) |
| Nunca inventar dados | O modelo pode "preencher lacunas" em perguntas ambíguas | Alto — mitigado por blocklist determinística |

### 4.3 Guardrails determinísticos (fora do prompt, em código)

| Guardrail | Implementação | Ação se falhar |
|-----------|---------------|----------------|
| Resposta contém citação de fonte | Regex: verifica presença de "Conforme", "POL-", "PROC-", "SLA-", "FAQ-" | Rejeitar e regenerar (max 2 tentativas); se persistir, retornar erro padrão |
| Resposta não menciona tier inexistente | Blocklist: "Platinum", "Diamond", "VIP", "Premium" como tier | Rejeitar e regenerar |
| Resposta não usa linguagem de incerteza inadequada | Blocklist: "acredito que", "provavelmente", "não tenho certeza mas", "possivelmente" antes de informação factual | Rejeitar e regenerar |
| Resposta dentro do limite de tokens | Verificação de tamanho máximo (~500 tokens) | Truncar com aviso ao atendente |
| Resposta não está vazia | Verificação de conteúdo | Retornar mensagem padrão de erro |

### 4.4 Fluxo de enforcement

```
Pergunta do atendente
        ↓
[Pipeline RAG: recupera chunks via Azure AI Search]
        ↓
[Reranking: seleciona top-5 chunks]
        ↓
[Monta contexto com posicionamento estratégico]
        ↓
[Envia ao GPT-4o]
        ↓
[Resposta gerada]
        ↓
[CAMADA DETERMINÍSTICA — código, não modelo]
  ├── Contém citação de fonte?
  │     NÃO → Regenerar (tentativa 1/2)
  │           NÃO → Regenerar (tentativa 2/2)
  │                 NÃO → Retornar erro padrão de escalação
  ├── Contém tier inexistente?
  │     SIM → Regenerar (1 tentativa) → Se persistir → Erro padrão
  ├── Contém linguagem de incerteza inadequada antes de dado factual?
  │     SIM → Regenerar (1 tentativa)
  ├── Tamanho dentro do limite?
  │     NÃO → Truncar com aviso
  └── Resposta vazia?
        SIM → Retornar mensagem padrão de erro
        ↓
[Resposta validada → entregue ao atendente]
```

**Princípio arquitetural:** Quanto mais crítico o guardrail para o negócio, mais determinístico deve ser. A citação de fonte é o guardrail mais crítico — por isso é validada por código, não apenas pelo prompt. O enforcement probabilístico de "nunca inventar dados" é complementado pelo determinístico de detectar linguagem de incerteza.

---

## 5. Mapeamento de responsabilidades: prompt vs harness

| Responsabilidade | Localização | Justificativa |
|-----------------|-------------|---------------|
| Definir comportamento geral | Prompt (estático) | Instrução de linguagem natural, não verificável por regex |
| Verificar citação de fonte | Harness (determinístico) | Binário e crítico — o prompt pode falhar |
| Bloquear tiers inexistentes | Harness (determinístico) | Alucinação específica e rastreável — regex pode detectar |
| Priorizar versão vigente do documento | Dados (ingestão) + Prompt | A ADR-0003 garante índice limpo; o prompt instrui em caso residual |
| Tom e formalidade | Prompt (probabilístico) | Não é verificável deterministicamente |
| Escalação quando sem resposta | Prompt (probabilístico) + Threshold (determinístico) | Threshold garante que perguntas sem coverage são escaladas; prompt define como formular a escalação |

A separação entre probabilístico e determinístico é o que torna o sistema robusto: o prompt define o comportamento ideal, o harness garante o comportamento mínimo aceitável.
