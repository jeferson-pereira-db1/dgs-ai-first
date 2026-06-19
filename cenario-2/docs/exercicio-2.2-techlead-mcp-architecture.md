# Exercício 2.2 — Arquitetura de MCP do Projeto (Tech Lead)

## Diagrama de servidores e conexões

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        AGENTES DE IA                                    │
│                                                                         │
│  ┌──────────────┐          ┌─────────────────────────────────────────┐  │
│  │  Claude Code │          │         GitHub Copilot                  │  │
│  │  (Tech Lead) │          │  (Dev Pleno / Dev Sênior / Tech Lead)   │  │
│  └──────┬───────┘          └──────────────────┬──────────────────────┘  │
│         │                                     │                         │
└─────────┼─────────────────────────────────────┼─────────────────────────┘
          │  MCP Protocol                        │  MCP Protocol
          │  (JSON-RPC 2.0 sobre stdio)          │  (JSON-RPC 2.0 sobre stdio)
          │                                     │
          ▼                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    MCP SERVERS (locais, via .mcp/mcp.json)              │
│                                                                         │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  [filesystem]                                                      │ │
│  │  Comando: npx @modelcontextprotocol/server-filesystem              │ │
│  │  Escopo (RW):  ./src  ./specs  ./skills  ./docs                    │ │
│  │  Escopo (RO)*: ./docs/novatech  ./data/retrieval-corpus            │ │
│  │  Tools expostas: read_file, write_file, list_directory, search     │ │
│  │  * read-only enforçado via permissão de sistema de arquivos        │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  [git]                                                             │ │
│  │  Comando: uvx mcp-server-git --repository .                        │ │
│  │  Escopo: repositório local (somente leitura de histórico/diff)     │ │
│  │  Tools expostas: git_log, git_diff, git_status, git_show           │ │
│  │  Nota: commits são feitos pelo humano, não pelo agente             │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  [memory]                                                          │ │
│  │  Comando: npx @modelcontextprotocol/server-memory                  │ │
│  │  Escopo: grafo persistente de entidades e relações (local)         │ │
│  │  Uso: decisões da ADRs, linguagem ubíqua do domínio NovaTech       │ │
│  │  Tools expostas: create_entities, create_relations, search_nodes   │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  [everything]                                                      │ │
│  │  Comando: npx @modelcontextprotocol/server-everything              │ │
│  │  Escopo: referência de todas as primitivas MCP (ambiente sandbox)  │ │
│  │  Uso: aprendizado e exploração — não usar em produção de artefatos │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘

Fluxo de uma query típica (Dev gerando endpoint):
  Copilot → filesystem (lê AGENTS.md, skills/domain/azure-functions-endpoint.md)
           → filesystem (lê specs/query-endpoint/plan.md)
           → filesystem (escreve src/functions/query/handler.ts)
           → git (confirma que não há conflito com branch atual)
```

---

## Política de aprovação de novos servers

### Quem pode propor

Qualquer membro do time pode propor um novo MCP server. A proposta é feita como PR (arquivo `docs/pull-requests/PR-NNNN.md`).

### Template de proposta

```markdown
## Proposta de MCP Server: [nome]

**Necessidade:** [qual problema resolve que os servers atuais não resolvem]
**Server:** [nome do pacote/comando]
**Mantenedor:** [quem mantém o pacote upstream]
**Tipo:** local / remoto / pago
**Escopo solicitado:** [pastas/permissões exatas]
**Justificativa least privilege:** [por que este escopo é o mínimo suficiente]
**Riscos identificados:** [exposição de secrets, escrita sem gate, etc.]
**Mitigação proposta:** [como os riscos são tratados]
```

### Critérios de aprovação (Tech Lead revisa todos)

| Critério | Obrigatório |
|----------|-------------|
| Server é local e gratuito (sem serviço pago/externo) | Sim — nesta fase |
| Escopo explicitamente definido (sem `.` como raiz) | Sim |
| Fontes de negócio em read-only | Sim |
| Justificativa de por que servers existentes não atendem | Sim |
| Riscos identificados com mitigação | Sim |

### Processo de revisão

1. Dev cria branch `chore/mcp-add-[nome-server]`
2. Escreve proposta em `docs/pull-requests/PR-NNNN.md`
3. Edita `.mcp/mcp.json` com o server proposto
4. Tech Lead revisa escopo e política de least privilege
5. Se aprovado: merge + executar `python3 scripts/mcp-health-check.py`
6. Se reprovado: comentários no PR; Dev ajusta escopo e re-submete

**SLA de revisão:** 1 dia útil.

---

## Monitoramento e alertas

### Problema

MCP servers são processos locais. Se uma pasta for renomeada, o server `filesystem` para de enxergar os arquivos. Se o ambiente mudar (uvx não disponível, node desatualizado), o server `git` falha silenciosamente — e o agente pode aluciná-los como se os arquivos/commits existissem.

### Solução: script de health check

Script localizado em `scripts/mcp-health-check.py`. Deve ser executado:
- Manualmente: antes de iniciar qualquer sessão de desenvolvimento com agentes
- Automaticamente: como hook pré-commit (opcional, configurável)

O script verifica, para cada server:
1. Comando disponível no PATH (`npx`, `uvx`, `git`)
2. Diretórios de escopo existem e são legíveis
3. Pacotes npm disponíveis no registro (conexão de rede)
4. Git repo válido com pelo menos 1 commit

### Saída de execução real (2026-06-19)

```
=== MCP Health Check — NovaTech Assistant ===
Config: /home/jeferson-pereira/repos-ia-first/dgs-ai-first/cenario-2/.mcp/mcp.json

[filesystem]
  ✓  comando `npx` encontrado em .../bin/npx
  ✓  diretório `./src` existe
  ✓  diretório `./specs` existe
  ✓  diretório `./skills` existe
  ✓  diretório `./docs` existe
  ✓  diretório `./docs/novatech` existe
  ✓  diretório `./data/retrieval-corpus` existe
  ✓  leitura verificada: docs/novatech/POL-001-politica-devolucao.md (3394 bytes)
  ✓  leitura verificada: data/retrieval-corpus/README.md (296 bytes)
  ✓  pacote `@modelcontextprotocol/server-filesystem` disponível — versão: 2026.1.14
  → status: OK

[git]
  ✓  comando `uvx` encontrado em ~/.local/bin/uvx
  ✓  git repo válido — últimos 1 commits:
  →      bbdd03a chore: starter repo (Anexo D) — estrutura + dados semeados
  → status: OK

[memory]
  ✓  comando `npx` encontrado
  ✓  pacote `@modelcontextprotocol/server-memory` disponível — versão: 2026.1.26
  → status: OK

[everything]
  ✓  comando `npx` encontrado
  ✓  pacote `@modelcontextprotocol/server-everything` disponível — versão: 2026.1.26
  → status: OK

=== Sumário ===
  ✓ filesystem
  ✓ git
  ✓ memory
  ✓ everything

4/4 servers verificados com sucesso
Ambiente MCP pronto para uso.
```

---

## Versionamento do `.mcp/mcp.json`

O arquivo `.mcp/mcp.json` é versionado no Git como qualquer outro artefato do projeto.

### Regras de versionamento

1. **Mudança de escopo** (adicionar/remover pasta de um server): exige PR com proposta de MCP (ver seção acima).
2. **Atualização de pacote** (bump de versão): pode ser feita diretamente, sem PR formal, com commit `chore(mcp): bump server-filesystem to 2026.x.x`.
3. **Adição de server** (novo `mcpServers` entry): exige PR com proposta de MCP.
4. **Remoção de server**: Tech Lead aprova diretamente; documentar motivo no commit.

### Garantia de compatibilidade

Antes de mudar o escopo de qualquer server:
1. Identificar quais fluxos de desenvolvimento dependem do server (consultar `docs/exercicio-2.1-techlead-agents-md.md` e skills que mencionam o server)
2. Documentar o impacto esperado no PR
3. Executar `mcp-health-check.py` após o merge e confirmar 4/4

---

## Plano de contingência: server indisponível

### Cenários de falha por server

| Server | Modo de falha mais comum | Impacto |
|--------|--------------------------|---------|
| `filesystem` | Pasta renomeada/deletada | Agente não vê documentos/specs — deve dizer "não encontrei" |
| `filesystem` | npx sem conexão | Server não sobe — agente fica sem contexto documental |
| `git` | uvx não instalado | Agente não acessa histórico — deve avisar, não inventar |
| `memory` | Grafo corrompido | Agente perde memória de decisões — reinicializar com backup |
| `everything` | Qualquer falha | Sem impacto em desenvolvimento — é server de aprendizado |

### Protocolo para agentes quando server cai

**Regra fundamental: agente degradado com aviso > agente que alucina.**

Quando o agente não conseguir acessar uma fonte via MCP, o comportamento esperado é:

```
✓ CORRETO — agente avisa explicitamente:
  "Não consigo acessar a documentação de negócio da NovaTech 
   (filesystem server indisponível). Minha resposta pode estar 
   incompleta. Execute `python3 scripts/mcp-health-check.py` 
   para diagnóstico."

✗ ERRADO — agente alucina:
  "Conforme a documentação da NovaTech, o prazo de devolução é 
   5 dias úteis para todos os tipos de carga."
```

Esta regra deve ser comunicada verbalmente ao time no início de cada sprint. O AGENTS.md reforça isso nas seções de Product Rules e Testing Standards.

### Ação humana para cada cenário

| Server | Falha | Ação imediata |
|--------|-------|---------------|
| `filesystem` | Pasta sumiu | `git status` para identificar mudança acidental; restaurar com `git checkout` |
| `filesystem` | Sem npx | `nvm install 20 && nvm use 20` |
| `git` | uvx não instalado | `pip install uv && uvx --version` |
| `memory` | Grafo corrompido | Localizar arquivo de banco do server-memory (`~/.local/share/`); restaurar backup ou reinicializar |
| Qualquer | Server não sobe | Executar health check; analisar stderr do processo npx/uvx |

---

## Justificativa de least privilege por server

| Server | Por que este escopo? |
|--------|---------------------|
| `filesystem` (RW: src, specs, skills, docs) | O agente precisa ler padrões e escrever código — escopo restrito às pastas de desenvolvimento, sem acesso à raiz do repo |
| `filesystem` (RO: docs/novatech, data/retrieval-corpus) | Documentação de negócio e corpus de chunks são fontes de verdade — agente nunca deve modificá-los; enforçado via `chmod a-w` nos diretórios |
| `git` | Histórico e diff são read-only por design do protocolo do server |
| `memory` | Acesso ao grafo de decisões — escopo é o processo local, sem acesso a disco |
| `everything` | Sandbox de aprendizado — nunca recebe caminhos de arquivos reais do projeto |

**Não incluído:** `.env`, `infra/`, `package.json`, `tsconfig.json` — o agente não precisa modificar configuração de build ou infraestrutura. Qualquer mudança nessas áreas deve ser feita pelo humano após revisão.
