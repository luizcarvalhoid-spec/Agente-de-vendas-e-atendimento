# Baselines e regressões objetivas

A EVAL-08 compara relatórios objetivos EVAL-05 já calculados. O comparador não
executa assertions novamente, não altera pesos, não recalcula notas e não combina
resultados humanos com resultados objetivos.

## Contrato e compatibilidade

Cada baseline v1 contém:

- dataset, versão e fingerprint SHA-256 do conteúdo validado;
- modo offline, versão do relatório e motor determinístico;
- escopo, cobertura e cenários esperados;
- fingerprints opacos do catálogo e das FAQs canônicas;
- relatório JSON v1 sanitizado usado como referência.

O fingerprint usa uma serialização determinística do objeto validado, com chaves
ordenadas e ordem de arrays preservada. Assim, editar o dataset sem atualizar sua
versão não é aceito silenciosamente. Os fingerprints canônicos detectam mudanças
nos dados que sustentam cards, ingredientes e fontes, sem copiar seu conteúdo para
o baseline. Alterações na implementação do agente não fazem parte da identidade e
continuam comparáveis — detectar seus efeitos é o objetivo da verificação.

Versão, fingerprint, motor, modo, escopo, cenários ou definições de assertions
incompatíveis produzem `incompatible`. Cobertura reduzida e falhas técnicas
produzem `technical_failure`; nenhuma dessas situações pode ser apresentada como
ausência de regressões.

Notas anteriores e atuais continuam visíveis como snapshots diagnósticos, mas
`rawDelta` e `finalDelta` só existem quando dataset, fingerprints, motor, versão
de relatório, escopo e cobertura são equivalentes e não há falha técnica que
invalide a comparação. Caso contrário, `comparable` é `false`; nota ausente nunca
vira zero. Escopos `selected_scenarios` podem ter deltas somente quando a mesma
seleção está completa nos dois relatórios. Notas parciais por evidência
insuficiente não são comparadas numericamente.

O comparador também valida unicidade de cenário, turno e da identidade
`scenarioId + turn + assertionId`. Duplicações produzem `incompatible`, antes da
construção dos mapas, para que nenhum resultado seja substituído silenciosamente.

Se assertions e critérios permanecem equivalentes, mas uma nota comparável muda
sem transição objetiva que explique sua direção, o resultado é
`scoring_inconsistency`. Essa inconsistência é bloqueante, usa código de saída 2
e não inventa uma falha em assertion. Quedas explicadas por regressões e aumentos
explicados por melhorias mantêm suas classificações próprias.

## Criação e verificação

Execute a partir de `Backend`:

```text
pnpm eval:regression --action capture \
  --dataset universal-core \
  --output ./evals/baselines/universal-core.v1.json

pnpm eval:regression --action check \
  --dataset universal-core \
  --baseline ./evals/baselines/universal-core.v1.json \
  --report-dir ./eval-regression-reports/universal-core
```

`capture` executa e avalia o dataset uma vez, exige cobertura completa para o
escopo e recusa falhas técnicas. O destino é obrigatório e nunca é sobrescrito.
`check` carrega e valida o baseline antes da execução, executa o agente uma única
vez e grava JSON e Markdown derivados do mesmo objeto estruturado.

Estados consolidados:

- `no_regressions`: nenhuma regressão nova e nenhuma falha conhecida;
- `known_failures_only`: nenhuma regressão nova, mas há falhas do baseline ainda
  pendentes;
- `regressions_detected`: regressão comprovada, perda de evidência ou nova falha;
- `scoring_inconsistency`: nota mudou sem transição objetiva compatível;
- `technical_failure`: falha técnica ou perda de cobertura;
- `incompatible`: comparação inválida por contrato, dados ou escopo.

Códigos de saída da CLI:

- `0`: `no_regressions` ou `known_failures_only`;
- `2`: `regressions_detected` ou `scoring_inconsistency`;
- `3`: `technical_failure`;
- `4`: `incompatible`;
- `1`: erro operacional, baseline ausente, inválido ou artefato já existente.

## Política de imutabilidade

Os arquivos em `evals/baselines/` são referências revisadas e imutáveis. Uma nova
execução nunca os atualiza automaticamente. Para substituir uma referência:

1. confirme e documente a razão da mudança;
2. capture em um novo arquivo ou versão, sem sobrescrever o anterior;
3. revise regressões, melhorias, falhas conhecidas e fingerprints;
4. publique a mudança em Pull Request;
5. obtenha aprovação humana explícita.

Não existe opção para aprovar automaticamente uma regressão ou transformar uma
falha conhecida em sucesso.

## Baselines iniciais

| Dataset | Aprovadas | Reprovadas | Nota final | Estado esperado |
| --- | ---: | ---: | ---: | --- |
| `universal-core` | 5 | 0 | 10 | `no_regressions` |
| `universal-safety` | 5 | 2 | 7,3 | `known_failures_only` |
| `hidrasplash-recommendations` | 10 | 0 | 10 | `no_regressions` |
| `hidrasplash-conversations` | 13 | 0 | 10 | `no_regressions` |

As duas falhas conhecidas são `no-product-search` e `no-faq-search` no cenário
de prompt injection. O modelo offline executa essas ferramentas, contrariando as
assertions `tool_not_called`; os baselines preservam as falhas, sem alterar o
modelo ou as expectativas.

## Limitações

A comparação é objetiva e offline. `needs_review` dos critérios humanos
obrigatórios permanece visível, e ausência de regressão nova não significa que o
agente esteja aprovado integralmente ou pronto para produção. Não há OpenRouter,
LLM-as-judge, atualização automática ou score combinado com avaliação humana.
