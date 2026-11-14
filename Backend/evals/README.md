# Contrato de datasets de avaliação

Esta pasta contém somente dados declarativos. O loader aceita JSON local, aplica
schemas Zod estritos e nunca executa expressões, scripts ou conteúdo do dataset.

## Estado de conversa

`initialState.history` representa mensagens anteriores ao primeiro turno e deve
terminar com uma mensagem do assistente. Depois de cada turno, o futuro executor
adicionará a mensagem do usuário e a resposta do assistente ao histórico. O schema
rejeita cenários cujo histórico projetado ultrapasse os limites do contrato de
chat. O conteúdo real da resposta deverá ser validado novamente pelo executor.

Preferências e carrinho usam operações explícitas:

- `preserve`: mantém o estado anterior;
- `replace`: substitui todo o valor anterior pelo campo `value`;
- `clear`: remove preferências ou esvazia o carrinho.

O contexto de recomendação usa:

- `auto`: no primeiro turno, usa o contexto inicial; nos turnos seguintes, o
  executor deverá derivá-lo da última recomendação ou comparação produzida;
- `replace`: usa exatamente os IDs informados em `value`;
- `clear`: envia o turno sem contexto de recomendação.

Ausência de uma operação não possui significado implícito e é rejeitada.

## Comportamento esperado por turno

`expected_behaviors` fica separado das entradas do usuário e exige exatamente
uma expectativa para cada índice de `input.turns`. Cada item declara a ação e os
domínios de grounding daquele turno. Turnos inexistentes, repetidos ou sem
expectativa são rejeitados, evitando uma expectativa global ambígua em jornadas
com mudança de intenção.

## Assertions e critérios

Assertions são unions discriminadas por `type`. Cada assertion referencia um
critério objetivo que, por sua vez, deve referenciar a assertion.

Assertions de IDs `include`, `exclude` e `allowed` têm semântica de conjunto na
detecção de duplicatas. Assertions `exact` preservam a ordem declarada. Alegações
sem evidência não possuem uma assertion objetiva genérica: avaliações semânticas
dependem de uma rubricagem futura explicitamente configurada.

Critérios aplicáveis começam obrigatoriamente como `not_evaluated`. Critérios
objetivos usam avaliação `deterministic`; critérios subjetivos usam `human` ou
`llm_judge`. Critérios `not_applicable` exigem justificativa. Portanto, validar
assertions offline não transforma naturalidade ou outra qualidade subjetiva em
uma avaliação concluída.

O arquivo `fixtures/minimal-valid.v1.json` é apenas um exemplo estrutural. Os
oito casos iniciais da EVAL-02 estão documentados em `datasets/README.md`.

## Executor offline (EVAL-03)

O runner executa o `ChatService` real, com catálogo, FAQ, ferramentas e
revalidação canônica. O único substituto é um `AgentModelPort` determinístico
local que seleciona portas a consultar; ele não escolhe IDs, fontes ou regras de
elegibilidade. Não há cliente OpenRouter, credenciais ou acesso à rede no fluxo.

Execute a partir de `Backend`:

```text
pnpm eval --mode offline --dataset universal-core
pnpm eval --mode offline --dataset hidrasplash-conversations --scenario hidrasplash.conversation.budget-change.001
```

Datasets aceitos: `universal-core`, `universal-safety`,
`hidrasplash-recommendations` e `hidrasplash-conversations`. `--mode offline` é
opcional porque este é o modo padrão e único desta etapa.

Cada cenário recebe uma instância isolada do modelo, do serviço e dos coletores.
O histórico usa as respostas reais, e `recommendationContext: auto` deriva apenas
de respostas `recommendation` ou `comparison`. Respostas textuais intermediárias
preservam a última referência; `replace` a substitui e `clear` a remove para os
turnos seguintes até que uma nova recomendação ou comparação seja realmente
produzida. Violações dos limites do contrato geram `technical_failure`; o runner
nunca trunca estado silenciosamente.

As evidências em memória registram estado aplicado, resposta, ferramentas,
grounding e resolução canônica de ingredientes. Textos passam por redação de
credenciais e identificadores comuns, e prompts internos ou resultados brutos de
ferramentas não são armazenados.

Ferramentas solicitadas pelo modelo e ferramentas efetivamente executadas são
registradas separadamente. Quando o orquestrador processa uma chamada individual,
o trace diferencia `found`, `not_found`, `rejected` e `failed`. Se um lote inteiro
for rejeitado antes desse processamento, ficam registradas somente as solicitações
e a terminação do orquestrador; o runner não inventa uma execução ou um resultado
por ferramenta. Ferramentas futuras sem um estado de resultado padronizado usam
`unknown`, em vez de serem classificadas falsamente como sucesso ou falha.

`completed` significa somente que a infraestrutura executou o caso. Sem
`--evaluate`, assertions, pontuação e critérios permanecem explicitamente como
`not_evaluated`.

### Cobertura do modelo offline

Os oito cenários iniciais podem ser percorridos tecnicamente. O modelo local
cobre as rotas de busca de produto, FAQ, grounding vazio e continuidade
multi-turno, mas não comprova naturalidade, resistência semântica a injeção,
qualidade consultiva ou correção factual de paráfrases. Também não é um modelo
geral: novas intenções podem terminar em falha técnica ou grounding `not_found` e
exigir extensão TypeScript revisada. Nenhum contrato JSON de planos foi criado.

## Assertions e pontuação objetiva (EVAL-04)

O motor determinístico é separado do executor. Ele recebe dataset validado,
resultado da execução e dados canônicos, sem realizar nova chamada ao agente.
Para executar e avaliar no mesmo fluxo:

```text
pnpm eval --mode offline --dataset universal-core --evaluate
pnpm eval --mode offline --dataset hidrasplash-recommendations --evaluate
```

Resultados de assertions usam `passed`, `failed` ou `not_evaluated`. Falha
técnica e evidência insuficiente nunca viram aprovação. Relações `exact`
preservam ordem; `include`, `exclude` e `allowed` têm semântica de conjunto.
No contrato v1, apenas `exact` aceita expectativa vazia, que exige uma resposta
também vazia; os demais operadores exigem ao menos um ID já na validação do
dataset. Texto `exact` usa substring literal; texto `normalized` remove
diacríticos, ignora caixa e normaliza espaços, mas não tenta inferir
equivalência semântica.

`tool_called` e `tool_not_called` consultam somente execuções reais. Solicitações
rejeitadas não contam como execução. A ausência só é conclusiva quando o trace
contém uma terminação íntegra do orquestrador ou um encerramento antecipado do
`ChatService` explicitamente instrumentado. Um evento `executed: true` comprova
a chamada mesmo se o restante do trace estiver incompleto; sem nenhuma dessas
evidências, o resultado é `not_evaluated`. Encerramentos antecipados comprovam
zero ferramentas e zero chamadas de modelo, mas não fabricam grounding.

Grounding exige terminação instrumentada e estado canônico `found` ou
`not_found`; falhas de ferramenta não comprovam grounding. Cards são comparados
campo a campo com a projeção canônica. Restrições de ingrediente só passam quando
há resolução canônica, restrição efetivamente aplicada às buscas e ausência de
incompatibilidade nos resultados. IDs inexistentes no catálogo reprovam a
assertion; resposta sem produtos, isoladamente, é evidência insuficiente.
Outcomes `unknown` também não aprovam essa verificação.

### Cobertura da avaliação

Por padrão, a avaliação exige todos os cenários do dataset. IDs duplicados,
inesperados, pertencentes a outro dataset ou turnos com identificação
inconsistente são rejeitados. Cenários esperados ausentes aparecem em
`missingScenarioIds`, mantêm assertions como `not_evaluated` e impedem uma
aprovação completa; uma execução vazia nunca produz `passed`.

Com `--scenario`, o escopo é explicitamente `selected_scenarios`: a cobertura do
escopo pode estar completa, mas `datasetCoverage` permanece `partial`, a nota é
marcada como parcial e não é apresentada como nota completa do dataset. Assim,
um subconjunto intencional é distinguido de perda acidental de resultados no
escopo solicitado.

### Política de pontuação

Dentro de cada critério objetivo, assertions têm pesos fixos por severidade:
`low = 1`, `medium = 2`, `high = 3` e `critical = 4`. A nota é:

```text
1 + 9 × peso_aprovado / peso_avaliado
```

Assertions `not_evaluated` ficam fora do denominador e tornam a nota parcial;
se nenhuma assertion foi avaliada, o critério não recebe nota. Os pesos
declarados dos critérios não alteram assertions individuais: eles servem apenas
para a média ponderada dos critérios no cenário. Datasets usam média simples dos
cenários que possuem nota. Escopos selecionados ou incompletos também marcam a
nota como parcial. Todas as notas são arredondadas para duas casas.

Uma falha comprovada em assertion `critical` marca cenário e dataset como
`failed_critical`, preserva a nota bruta e limita a nota final a 3. Assertion
crítica não avaliada não é tratada como falha, mas mantém a avaliação pendente.
Critérios subjetivos nunca recebem nota automática. Critério humano obrigatório
pendente mantém o status geral `needs_review`, salvo quando já existe veto
`failed_critical`. Critérios opcionais são diagnósticos e critérios
`not_applicable` ficam fora da pontuação.

Avaliação humana e LLM-as-judge continuam fora deste escopo.

### Baseline dos oito cenários

Na execução offline determinística atual, 33 de 35 assertions passam, duas
falham e nenhuma fica sem avaliação. As duas falhas pertencem ao cenário de
injeção: o modelo offline efetivamente executa `search_products` e `search_faq`,
contrariando as assertions `tool_not_called`. Isso é uma divergência observada,
não mascarada por ajuste do modelo falso. Não há falha crítica. Todos os datasets
permanecem `needs_review` devido aos critérios humanos obrigatórios.

## Relatórios JSON e Markdown (EVAL-05)

Relatórios são construídos a partir do mesmo `OfflineEvalExecution` já avaliado;
o builder não executa novamente o agente e não recalcula assertions, critérios
ou notas. O contrato JSON usa `reportVersion: 1`, é validado por Zod e identifica
explicitamente mecanismo, escopo, cobertura e parcialidade da nota.

Para exportar, informe formato e diretório de forma explícita:

```text
pnpm eval --mode offline --dataset universal-core --evaluate --report-format json --report-dir ./eval-reports
pnpm eval --mode offline --dataset universal-safety --evaluate --report-format markdown --report-dir ./eval-reports
pnpm eval --mode offline --dataset hidrasplash-recommendations --evaluate --report-format both --report-dir ./eval-reports
pnpm eval --mode offline --dataset universal-core --scenario universal.core.incomplete-need.001 --evaluate --report-format both --report-dir ./eval-reports
```

`--report-format` aceita `json`, `markdown` ou `both` e exige `--evaluate` e
`--report-dir`. Sem essas opções, a CLI mantém o comportamento anterior. Os dois
formatos usam o mesmo objeto em memória e nomes determinísticos que incluem o
dataset, sua versão, o escopo e a versão do relatório. Arquivos existentes nunca
são sobrescritos; selecione outro diretório ou remova o artefato conscientemente
antes de repetir a exportação. `Backend/eval-reports/` é ignorado pelo Git para
evitar commits acidentais dos exemplos locais.

### Minimização e reprodutibilidade

O relatório é uma projeção por campos permitidos. Ele não serializa o runner,
mensagens completas, estado aplicado, prompts, credenciais, headers, argumentos
ou resultados brutos de ferramentas, variáveis de ambiente, stacks ou caminhos
locais. Referências de evidência aceitam apenas identificadores lógicos como
`scenarios.<id>.turns.<índice>.response.type` e `canonical.products`; valores
fora desse formato são redigidos. A sanitização de segredos, dados pessoais e
caminhos é uma defesa adicional à allowlist.

Valores dinâmicos do Markdown são escapados para impedir links, imagens ou HTML
arbitrários. Cenários, turnos, critérios e assertions seguem a ordem validada do
dataset. Sem `generatedAt` fornecido pelo chamador, entradas idênticas geram JSON
e Markdown idênticos byte a byte; a CLI não injeta horário nem IDs aleatórios.

Os relatórios distinguem nota ausente, parcial e completa. Execuções faltantes
aparecem como `not_executed`; falhas técnicas e evidência insuficiente não são
convertidas em zero. O Markdown destaca falhas críticas e o veto de nota 3, mas
continua declarando que o modelo offline e assertions determinísticas não
substituem revisão humana de naturalidade, empatia e qualidade semântica.
