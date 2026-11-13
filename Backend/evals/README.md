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
casos definitivos pertencem à EVAL-02.
