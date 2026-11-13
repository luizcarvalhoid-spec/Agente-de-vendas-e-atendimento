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

Assertions são unions discriminadas por `type`. Elas descrevem expectativas
estruturadas, mas não são executadas nesta etapa. Cada assertion referencia um
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
de respostas `recommendation` ou `comparison`. Violações dos limites do contrato
geram `technical_failure`; o runner nunca trunca estado silenciosamente.

As evidências em memória registram estado aplicado, resposta, ferramentas,
grounding e resolução canônica de ingredientes. Textos passam por redação de
credenciais e identificadores comuns, e prompts internos ou resultados brutos de
ferramentas não são armazenados.

`completed` significa somente que a infraestrutura executou o caso. Assertions,
pontuação e critérios subjetivos não são avaliados: todos permanecem
explicitamente como `not_evaluated` até as etapas futuras.

### Cobertura do modelo offline

Os oito cenários iniciais podem ser percorridos tecnicamente. O modelo local
cobre as rotas de busca de produto, FAQ, grounding vazio e continuidade
multi-turno, mas não comprova naturalidade, resistência semântica a injeção,
qualidade consultiva ou correção factual de paráfrases. Também não é um modelo
geral: novas intenções podem terminar em falha técnica ou grounding `not_found` e
exigir extensão TypeScript revisada. Nenhum contrato JSON de planos foi criado.
