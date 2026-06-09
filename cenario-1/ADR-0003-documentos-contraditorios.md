# ADR-0003: Tratamento de Documentos Contraditórios

## Status: Aceito (revisado após devil's advocate)

---

## Contexto

A base documental da NovaTech contém versões conflitantes do mesmo documento. O caso mais claro — e documentado — é o PROC-042 vs PROC-042-v2: mesma numeração, multiplicadores regionais diferentes, nenhum dos dois marcado como obsoleto no SharePoint.

**Comparativo explícito das contradições identificadas:**

| Parâmetro | PROC-042 v1 (mar/2023) | PROC-042-v2 (nov/2023) | Delta |
|-----------|------------------------|------------------------|-------|
| Multiplicador Sul | 1.2 | 1.3 | +8,3% |
| Multiplicador Sudeste | 1.0 | 1.1 | +10% |
| Multiplicador Centro-Oeste | 1.3 | 1.4 | +7,7% |
| Multiplicador Nordeste | 1.4 | 1.5 | +7,1% |
| Multiplicador Norte | 1.6 | 1.8 | +12,5% |
| Fator de peso 1.001-3.000kg | 1.2 | 1.15 | -4,2% |
| Fator de peso > 3.000kg | 1.5 | 1.4 | -6,7% |
| Prazo adicional | +2 dias úteis | +3 dias úteis | +1 dia |

Essas diferenças não são cosméticas — são diferenças contratuais que impactam diretamente o valor cobrado do cliente. Um frete de 600kg para Manaus calculado com multiplicador 1.6 (v1) vs 1.8 (v2) tem diferença de 12,5% no valor.

**Cenários de falha se o problema não for tratado:**

**Cenário A — retriever traz chunks das duas versões:** O LLM recebe PROC-042-B (Norte: 1.6) e PROC-042v2-B (Norte: 1.8) no mesmo contexto. Tenta sintetizar e gera uma resposta que mistura multiplicadores das duas versões — parecendo fundamentada, mas factualmente incorreta. O atendente repassa ao cliente um valor errado.

**Cenário B — retriever traz apenas uma versão, mas não a correta:** A similaridade semântica não distingue versões — o chunk mais similar pode ser o da versão obsoleta. O atendente usa o multiplicador errado sem perceber, porque a resposta parece completa e citada.

Ambos os cenários são perigosos exatamente porque a resposta *parece* correta e bem fundamentada. O atendente não tem como perceber o erro sem consultar o documento original — o que é exatamente o problema que o assistente deveria eliminar.

**Opções consideradas:**
1. Manter apenas a versão vigente no índice (exclusão na ingestão)
2. Manter ambas as versões com metadados de vigência + instrução ao modelo
3. Delegar ao LLM com instrução no prompt

---

## Decisão

Adotaremos a **Opção 1 com metadados obrigatórios e processo formal de governança**: manter apenas documentos com `status = vigente` no índice ativo, com arquivamento de versões obsoletas em índice separado.

**Como funciona na prática:**

Na **ingestão**, cada documento recebe metadados obrigatórios:
- `documento_id` (ex: `PROC-042`)
- `versao` (ex: `2.0`)
- `data_emissao` (ex: `2023-11-10`)
- `data_vigencia` (ex: `2023-12-01`)
- `status` (`vigente` | `obsoleto` | `em_revisao`)
- `tipo_documento` (`normativo` | `procedimento` | `informal`)
- `area_responsavel` (ex: `Comercial`)

Apenas documentos com `status = vigente` são indexados no **índice ativo** (o que o assistente usa). Documentos obsoletos são arquivados em um **índice de arquivo** — fora do retrieval, mas rastreáveis para auditoria.

**Pré-condição crítica:** Esta decisão depende de a NovaTech estabelecer um processo formal de publicação de documentos antes da primeira ingestão. O processo deve incluir: ao publicar PROC-042-v3, a área responsável marca explicitamente PROC-042-v2 como `obsoleto`. Sem esse processo, o pipeline não consegue determinar automaticamente qual versão é vigente.

**Mitigação de risco de governança (adicionada após devil's advocate):** A NovaTech precisa acordar com as 3 áreas responsáveis (Operações, Compliance, Comercial) antes do go-live. O assistente também atuará como sinalizador de gaps: se o pipeline de ingestão detectar dois documentos com o mesmo `documento_id` e ambos com `status = vigente`, gera alerta automático para a área responsável.

---

## Consequências

**Positivas:**
- Elimina na raiz o risco de o modelo misturar versões — se apenas uma versão está no índice, o problema não existe
- Pipeline de retrieval mais simples — sem lógica especial para lidar com contradições em tempo de query
- Comportamento determinístico: o modelo sempre responde com base na versão vigente, sem depender de instrução probabilística
- O alerta automático de conflito de vigência adiciona uma camada de governança que a NovaTech não tem hoje

**Negativas:**
- Requer acordo prévio com a NovaTech sobre processo de publicação — é um pré-requisito humano e organizacional, não técnico
- Se o processo falhar (alguém publica v3 sem marcar v2 como obsoleta), o problema reaparece silenciosamente — o pipeline não detecta automaticamente a contradição se ambas estiverem marcadas como `vigente` sem conflito de `documento_id`
- Documentos sem metadados claros (como o FAQ-Atendimento, que não tem responsável formal nem versionamento) precisam de curadoria manual antes da ingestão — isso é trabalho de discovery que precisa estar no cronograma
- Perda de acesso ao histórico de versões via assistente: atendentes que precisarem consultar o que estava vigente em uma data anterior terão que ir ao SharePoint diretamente

---

## Processo de devil's advocate

**Contra-argumento 1: "Manter apenas a versão vigente é simples demais. E se o atendente precisar consultar o que estava vigente no momento de um contrato antigo?"**

Status: **Respondido e mantido.** O requisito de "consultar versões históricas" não foi identificado no discovery. O caso de uso atual é "responder dúvidas com a regra vigente hoje". Se o requisito histórico aparecer, a solução é expor o índice de arquivo via interface separada, não misturar com o índice ativo. A decisão se mantém para v1.

**Contra-argumento 2: "Colocar a resolução de conflitos no system prompt é frágil — em conversas longas, o modelo pode ignorar a instrução."**

Status: **Incorporado e fortaleceu a decisão.** Este argumento foi usado como justificativa adicional para a Opção 1 (não depender do prompt) em vez da Opção 2 (instrução no prompt). A fragilidade probabilística do prompt é exatamente o motivo pelo qual a solução deve ser determinística na camada de dados, não depender do LLM.

**Contra-argumento 3: "Quem decide qual versão é 'vigente' nos metadados? Você está assumindo que a NovaTech vai manter isso atualizado, mas o problema que motivou o projeto é exatamente a falta de governança documental."**

Status: **Incorporado como risco crítico.** Este foi o contra-argumento mais relevante. A dependência de governança da NovaTech foi adicionada explicitamente como pré-condição e como risco. A mitigação foi adicionada: o assistente atua como sinalizador de gaps de governança. Esse ponto também precisa ser comunicado ao cliente como pré-requisito de sucesso do projeto — o assistente não resolve o problema de governança documental da NovaTech, ele depende da resolução desse problema.

**Contra-argumento 4: "Mostrar ao atendente que existe uma versão contraditória vai confundi-lo."**

Status: **Respondido e mantido.** Esse é o argumento para a Opção 1 (mostrar apenas uma versão). O erro silencioso — usar multiplicador errado sem avisar — é pior do que não existir contradição visível. A Opção 1 elimina a contradição na raiz, não a esconde.

---

## Alternativas descartadas

### Manter ambas as versões com metadados de vigência e instrução ao modelo
A instrução de "usar a versão mais recente" é **probabilística** — o modelo seguirá a instrução na maioria das vezes, mas não em todas. Para multiplicadores de frete que impactam o valor cobrado do cliente, "na maioria das vezes" não é aceitável. Além disso, se o retriever trouxer chunks das duas versões, o modelo recebe informação contraditória e precisa resolver o conflito — adicionando um passo cognitivo que aumenta o risco de erro. Descartada.

### Delegar a decisão ao LLM com instrução no prompt
A pior das três opções. LLMs não "sabem" que PROC-042 e PROC-042-v2 são o mesmo documento em versões diferentes a menos que isso esteja explícito nos metadados. E mesmo com metadados, a decisão continuaria sendo probabilística. Contradições no contexto são uma das causas mais comuns de alucinação — o modelo tenta reconciliar informações incompatíveis e gera algo que não corresponde a nenhuma das fontes. Descartada.
