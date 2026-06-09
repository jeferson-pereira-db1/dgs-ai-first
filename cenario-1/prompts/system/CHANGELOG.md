# CHANGELOG — Prompts do Assistente NovaTech

Todas as alterações significativas nos prompts são documentadas aqui.
Formato: [versão] — data — responsável — descrição da mudança e justificativa

---

## [v1.0] — 2026-06-09 — Jeferson Pereira (Tech Lead)

**Criação inicial do system prompt de produção.**

Baseado no protótipo do desenvolvedor (exercício 1.2), com as seguintes adições e mudanças:

- Adicionado disclaimer explícito de que o assistente "não tem conhecimento próprio" — evita que o modelo responda com conhecimento geral quando os chunks não cobrem a pergunta
- Adicionada R5 (tiers inexistentes) como regra explícita — a armadilha do tier "Platinum" identificada no FAQ-15 precisa de instrução explícita
- Adicionada R4 (priorizar versão vigente) como fallback para o caso raro de dois chunks com versões diferentes chegarem ao contexto — complementa a decisão da ADR-0003
- Estrutura de resposta com seção "Atenção" opcional — evita que o modelo adicione ressalvas desnecessárias em respostas simples e diretas
- Adicionado campo `{{TIMESTAMP}}` nos metadados — permite auditoria temporal das respostas

**Casos de teste cobrindo esta versão:** TEST-001 a TEST-007 em test-cases.json

---

## Próxima versão planejada: v1.1

Alterações em avaliação após primeiros 30 dias de produção:
- Instrução explícita para descontos de volume (PROC-042-v2, seção 4) — atendentes estão escalando perguntas que poderiam ser respondidas
- Reformulação da instrução de R4 para ser mais específica sobre quando sinalizar contradição vs quando simplesmente usar a versão mais recente
