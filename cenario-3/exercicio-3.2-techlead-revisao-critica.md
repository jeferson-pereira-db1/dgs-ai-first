# Exercício 3.2 — Revisão Crítica da Arquitetura Gerada com IA (Tech Lead)

## Contexto

Vários artefatos do projeto NovaTech foram produzidos com apoio de IA. Esta revisão de riscos acontece **antes do go-live**, com a demo para a diretoria em 2 semanas. O objetivo não é refazer tudo — é identificar o que pode explodir em produção e priorizar o que fazer antes da demo.

Artefatos em revisão:
1. **AGENTS.md** — 15 páginas, gerado pelo Claude, refinado 4 vezes.
2. **3 Skills** — Foundation refinada após testes; as outras 2 não foram refinadas.
3. **Pipeline (ingestão + query endpoint)** — ~60-70% gerado pelo Copilot.
4. **System Prompt** — iterado 6 vezes, sem documentar por que cada mudança foi feita.

---

## Parte 1 — Avaliação de Riscos Própria (ANTES do Claude)

> Esta seção representa a análise independente do Tech Lead, sem auxílio de IA.

### Artefato 1 — AGENTS.md (15 páginas, 4 refinamentos)

**Risco identificado: superfície grande demais para ser lida consistentemente.**

Um AGENTS.md de 15 páginas vai contra a razão de sua existência. O Copilot lê o documento inteiro antes de cada geração, mas o contexto tem limite. Se as regras críticas ficaram no final do documento (ex: proibição de `console.log`, formato de `AssistantResponse`), existe risco real de que o modelo "esqueça" o início quando chegar no fim — o efeito lost-in-the-middle que o ADR-0002 já documentou para os chunks de RAG. A mesma física cognitiva vale para o Copilot lendo o AGENTS.md.

**Segundo risco: refinamentos sem versionamento das mudanças.**
Foram 4 iterações. Se a versão 4 contradiz a versão 2 em algum ponto, não há como auditar o conflito sem ler o documento inteiro linha a linha. O exercício 2.1 já mostrou que o Copilot seguiu 10 itens e violou 5 — o que não sabemos é se as 5 violações eram permitidas em versões anteriores do AGENTS.md e foram esquecidas sem ser removidas.

**O que verificar antes do go-live:**
- Calcular tamanho em tokens do AGENTS.md. Se passar de ~4.000 tokens (limite do ADR-0002 para o system prompt), as regras no final estão no ponto de shadow do contexto.
- Fazer diff entre versão original e versão 4 para identificar conflitos ou regras órfãs.
- Executar o check do exercício 2.3 (11 regras, % de aderência) contra os últimos 10 arquivos gerados pelo Copilot.

---

### Artefato 2 — Skills (Foundation refinada; 2 sem refinamento)

**Risco identificado: skills não refinadas = outputs não validados.**

A Foundation skill teve o ciclo completo: gerar → testar → corrigir → reprovar o Copilot → refinar skill → reprovar novamente → refinar de novo. O resultado foi validado empiricamente (64% de aderência medido no exercício 2.3, com ponto de corte em 80%).

As 2 skills restantes nunca passaram por esse ciclo. Isso significa que o Copilot está gerando código com base nelas, mas ninguém mediu se o output é aderente. Se a Foundation com refinamento chegou a 64%, é razoável esperar que skills sem refinamento fiquem abaixo disso. O problema não é eventual — cada arquivo gerado com essas skills está potencialmente violando regras que ninguém detectou.

**Armadilha específica:** skills sem refinamento não são "neutras" — elas são ativamente enganosas, porque o desenvolvedor acha que está seguindo um padrão validado quando na verdade não está.

**O que verificar antes do go-live:**
- Identificar quais skills estão sendo usadas mais ativamente (pelo histórico do Copilot ou pela frequência de `// @skill:` nos arquivos).
- Executar avaliação de aderência (mesmo método do ex. 2.3) nas 2 skills não refinadas.
- Se aderência < 50%: refinar antes do go-live. Se 50-79%: aceitar como risco residual e documentar.

---

### Artefato 3 — Pipeline (ingestão + query endpoint, ~60-70% Copilot)

**Risco identificado: violações do AGENTS.md não detectadas em produção.**

O exercício 2.1 identificou 5 violações no código gerado pelo Copilot. Dessas, duas são críticas:
- `minScoreThreshold: 0.2` em vez de `0.70` (ADR-0002): o sistema está retornando chunks com similaridade baixíssima, o que explica parte dos 12% de respostas incorretas em staging.
- `debug_prompt` exposto na resposta da API: dado sensível (o prompt interno do sistema) está sendo enviado para o cliente.

O pipeline tem 75% de cobertura de testes de integração, mas os testes não cobrem os valores de configuração — passam no `config.ts` com os valores errados sem reclamar.

**O que verificar antes do go-live:**
- Corrigir `minScoreThreshold` de 0.2 para 0.70 (mudança de 1 linha; impacto imediato na qualidade das respostas).
- Remover `debug_prompt` da resposta da API.
- Adicionar teste que valida o valor de `minScoreThreshold` (prevenir regressão).

---

### Artefato 4 — System Prompt (6 iterações sem changelog)

**Risco identificado: rollback cego e impossibilidade de auditoria.**

6 iterações sem documentar *por que* cada mudança foi feita significa que se a versão 6 causar problema em produção, o rollback para a versão 5 é cego — o time não sabe o que exatamente mudou nem por que, então não sabe se a versão 5 tinha o mesmo problema ou um problema diferente.

Este é o risco de governança mais silencioso do projeto: o prompt funciona em staging, então parece seguro. Mas sem changelog, qualquer regressão futura vai custar tempo demais para diagnosticar.

**Segundo risco:** 6 iterações de refinamento podem ter criado regras implicitamente contraditórias. O exercício 1.2 documentou 6 regras (R1-R6). Se alguma iteração ajustou R3 sem revisar R5, podem estar em conflito sem que nenhum teste detecte (porque os testes de prompt não cobrem todos os pares de regras).

**O que verificar antes do go-live:**
- Criar `PROMPT-CHANGELOG.md` com as 6 iterações documentadas retrospectivamente (o histórico existe no Claude — basta recuperar o contexto da conversa de criação).
- Fazer análise de consistência interna: pedir ao Claude para identificar contradições entre as 6 regras atuais.
- Adicionar timestamp e hash de versão ao system prompt para rastrear qual versão está em produção.

---

## Parte 2 — Co-revisão com Claude

> Prompt enviado ao Claude: *"Contexto: sou Tech Lead do projeto NovaTech. Antes do go-live, revisei os riscos dos seguintes artefatos gerados com IA: (1) AGENTS.md de 15 páginas, refinado 4 vezes; (2) 3 skills, sendo a Foundation refinada e as outras duas sem refinamento; (3) pipeline de ingestão + query endpoint (~60-70% Copilot); (4) system prompt iterado 6 vezes sem changelog. Segue minha análise de riscos [inserir Parte 1]. Quais riscos adicionais você identifica que não mencionei? Seja específico ao projeto NovaTech, não genérico."*

**Riscos adicionais levantados pelo Claude:**

**1. AGENTS.md — risco de drift entre a intenção e a prática.**
O Claude levantou que o AGENTS.md documenta regras, mas não documenta a *razão* das regras. Se um desenvolvedor novo (ou o próprio Copilot em um contexto diferente) ler que "nunca use console.log" sem entender que é por causa do pino structured logging e da auditabilidade de produção, vai sentir a regra como burocracia e buscar exceções. Sugere adicionar uma linha de "por quê" para as 3 regras mais críticas.

*Avaliação: risco real, mas de médio prazo (não afeta o go-live em 2 semanas). Aceitar como risco residual.*

**2. Skills não refinadas — risco de regressão silenciosa.**
O Claude foi mais específico que minha análise: skills não refinadas tendem a gerar output que passa na revisão humana inicial mas regride nos casos de borda. O risco não é o output óbvio errado — é o output plausível mas sutilmente incorreto (ex: um handler sem `queryId` que passa na revisão porque "o resto está certo"). Sugere manter uma lista de outputs gerados com as 2 skills e revisão manual obrigatória antes de qualquer merge.

*Avaliação: risco confirmado, mais específico que minha análise. Incorporar: adicionar revisão manual obrigatória como gate de PR para arquivos gerados pelas 2 skills.*

**3. Pipeline — risco de configuração em tempo de execução.**
O Claude identificou que o `QUERY_CONFIG` em `config.ts` usa `as const` — isso significa que o valor `0.2` está hard-coded no bundle. Não há variável de ambiente para sobrescrever em produção sem re-build. Se o go-live acontecer com o valor incorreto, não é possível corrigir com hotfix de configuração — é necessário novo deploy. Sugere mover `minScoreThreshold` para variável de ambiente com fallback.

*Avaliação: risco crítico que eu não havia identificado. A distinção entre "configuração hard-coded" e "configuração de ambiente" é significativa — a correção deveria ser `process.env.MIN_SCORE_THRESHOLD ?? 0.70` em vez de constante.*

**4. System Prompt — risco de versão errada em produção.**
O Claude levantou que sem versionamento, não há garantia de que o prompt em produção é o mesmo que está no repositório. Se alguém testou uma variação diretamente na Azure OpenAI console e "esqueceu" de commitar, o sistema de produção pode estar rodando com um prompt diferente do que o time acredita. Sugere hash de conteúdo do prompt no log de cada request para detecção rápida de divergência.

*Avaliação: risco real e específico. Simples de implementar: logar `sha256(systemPrompt).substring(0,8)` em cada request.*

---

## Parte 3 — Comparação Honesta: Humano vs Claude

| Artefato | Achei mas Claude não mencionou | Claude achou mas eu não mencionei |
|----------|-------------------------------|----------------------------------|
| AGENTS.md | Problema do lost-in-the-middle com documento grande; diff entre versões para conflitos | Drift por falta de "por quê" nas regras |
| Skills | Skills não refinadas são ativamente enganosas (não apenas ausentes) | Risco específico de outputs plausíveis mas incorretos em casos de borda; revisão obrigatória no PR |
| Pipeline | `debug_prompt` exposto; threshold 0.2 vs 0.70 como causa dos 12% incorretos | `minScoreThreshold` hard-coded sem variável de ambiente — impossibilita hotfix |
| System Prompt | Regras implicitamente contraditórias em 6 iterações; análise de consistência interna | Risco de versão em produção diferente do repositório; hash de conteúdo no log |

**O que a análise humana acertou mais:** conectar os riscos aos dados concretos do projeto (12% de respostas incorretas, `minScoreThreshold: 0.2`, `debug_prompt`, aderência de 64%). A análise humana partiu de evidências já coletadas.

**O que o Claude acertou mais:** riscos de operação contínua e governança futura (drift de intenção, outputs plausíveis mas sutis, versão divergente em produção). O Claude pensa naturalmente em "o que dá errado depois do go-live" enquanto a análise humana focou em "o que impede o go-live".

**Honestidade:** o risco de `minScoreThreshold` hard-coded é genuinamente algo que eu deveria ter identificado — é uma distinção técnica importante que estava nos dados do exercício 2.1 mas não conectei ao risco de deploy.

---

## Parte 4 — Priorização para as 2 Semanas

### Semana 1 — Bloqueantes (sem isso a demo falha)

| Prioridade | Ação | Artefato | Esforço |
|-----------|------|----------|---------|
| P1 | Corrigir `minScoreThreshold` de 0.2 → 0.70 + mover para env var | Pipeline | 2h |
| P2 | Remover `debug_prompt` da resposta da API | Pipeline | 30min |
| P3 | Adicionar teste que valida `minScoreThreshold` (prevenir regressão) | Pipeline | 1h |
| P4 | Verificar aderência das 2 skills não refinadas (método ex. 2.3) | Skills | 4h |
| P5 | Criar `PROMPT-CHANGELOG.md` com as 6 iterações documentadas | System Prompt | 3h |

**Por quê começar por aqui:** P1 e P2 afetam qualidade e segurança diretamente — são os 12% de respostas incorretas. P3 previne regressão de P1. P4 determina se as skills precisam de refinamento urgente ou se podem ser aceitas como risco residual. P5 é pré-requisito para qualquer decisão futura sobre o prompt.

### Semana 2 — Melhorias de governança (reduzem risco pós go-live)

| Prioridade | Ação | Artefato | Esforço |
|-----------|------|----------|---------|
| P6 | Adicionar hash de conteúdo do system prompt no log de cada request | System Prompt | 1h |
| P7 | Adicionar revisão manual obrigatória no template de PR para arquivos gerados pelas 2 skills | Skills | 2h |
| P8 | Medir tamanho do AGENTS.md em tokens; verificar se ultrapassa 4.000 | AGENTS.md | 1h |
| P9 | Análise de consistência interna do system prompt (pedir ao Claude para identificar contradições) | System Prompt | 2h |

### Riscos Residuais Aceitos Explicitamente

| Risco | Por que aceitar | Mitigação de fallback |
|-------|----------------|----------------------|
| AGENTS.md sem "por quê" nas regras | Não afeta o go-live; risco de médio prazo com novo desenvolvedor | Colocar na retrospectiva pós-demo |
| Skills sem refinamento (se aderência ≥ 50%) | Risco baixo se revisão manual obrigatória no PR estiver ativa | Revisar 100% dos outputs nas 2 primeiras semanas pós go-live |
| Diff entre versões do AGENTS.md sem auditoria completa | Custo de fazer o diff completo > risco em 2 semanas (documento estabilizado) | Bloquear refinamentos do AGENTS.md até pós go-live |
| Regras potencialmente contraditórias no prompt | P9 na semana 2 mitiga; contradição sem efeito em staging provavelmente não aparece na demo | Monitorar qualidade nas primeiras 48h de go-live |

---

## Conclusão

O projeto tem um risco real e quantificado: **12% de respostas incorretas** em staging, causado parcialmente por `minScoreThreshold: 0.2`. Esse risco é **corrigível em 30 minutos** — o que torna qualquer outra discussão de risco secundária na primeira semana.

Os riscos de governança (system prompt sem changelog, skills sem refinamento, AGENTS.md sem versionamento semântico) são reais mas de prazo mais longo. A estratégia correta não é refatorar tudo antes da demo — é corrigir o que afeta qualidade hoje, documentar o que foi aceito como risco residual, e ter visibilidade (observability) para detectar degradação rapidamente após o go-live.

A revisão com o Claude adicionou 4 riscos que eu não havia identificado, especialmente o de `minScoreThreshold` hard-coded e o de versão divergente em produção. O processo humano-primeiro foi útil: minha análise focou em evidências concretas do projeto, enquanto o Claude contribuiu com padrões de risco operacional que complementam o diagnóstico.
