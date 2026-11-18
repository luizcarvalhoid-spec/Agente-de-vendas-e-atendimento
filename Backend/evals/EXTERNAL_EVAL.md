# EVAL-07A — preparação de avaliações externas

A EVAL-07A prepara o fluxo do agente para uma futura avaliação controlada com
modelo externo. Ela não autoriza rede, OpenRouter ou qualquer chamada
potencialmente paga. A modalidade `live_external` permanece bloqueada no código
e na CLI.

## Modalidades

- `dry_run`: valida dataset, cenários, modelo, limites, preços, orçamento e
  destino sem executar o agente;
- `mock_external`: executa o `ChatService`, ferramentas, assertions e relatórios
  com um modelo registrado explicitamente pela factory mock;
- `live_external`: reservada para a EVAL-07B e sempre bloqueada nesta etapa.

Uma execução mock declara `simulated_external_transport` e
`not_real_model_performance`. Ela nunca deve ser apresentada como evidência de
desempenho de um modelo real.

## Preflight offline

Execute a partir de `Backend`:

```text
pnpm eval:live --action plan \
  --dataset universal-core \
  --scenario universal.core.incomplete-need.001
```

O exemplo retorna um plano bloqueado, pois modelo, limites, preços, orçamento,
margem para uso não informado e diretório ainda não foram fornecidos. O preflight
não lê `OPENROUTER_API_KEY`, não instancia o cliente OpenRouter e não permite
rede.

Para um plano completo, informe explicitamente:

- modelo;
- máximo de chamadas;
- saída máxima por chamada;
- limite total de tokens;
- estimativa conservadora de entrada por chamada;
- timeout;
- preços de entrada e saída por milhão de tokens, moeda USD e instante de
  confirmação;
- orçamento máximo;
- multiplicador de segurança para uso não informado;
- diretório de saída.

Preços não são embutidos no projeto. A tabela informada deve corresponder
exatamente ao modelo selecionado. Se o pior caso exceder o orçamento, o plano é
bloqueado antes da execução.

## Execução mock

O runner reutiliza o mesmo `ChatService`, catálogo, FAQ, ferramentas, histórico,
preferências, carrinho, contexto de recomendação, trace e motor de assertions.
Um modelo simulado deve passar por `createMockExternalEvalModel`: a factory cria
uma instância registrada, e o runner recusa objetos não registrados. Adaptadores
externos conhecidos, incluindo o adaptador OpenRouter, são marcados em sua
criação e não podem ser registrados como mock. A existência de
`OPENROUTER_API_KEY` não altera essa decisão.

Essa fronteira evita a injeção acidental dos adaptadores externos conhecidos;
ela não é uma sandbox para JavaScript arbitrário. Uma factory mock é código
confiável do processo e não deve executar I/O por conta própria nem encapsular
um transporte externo desconhecido. Metadados como `networkAllowed: false`
descrevem a política e o fluxo implementado, mas isoladamente não conseguem
impedir operações externas realizadas por código arbitrário injetado.

O controle financeiro registra chamadas, tokens e custo reservado antes de
invocar `model.complete()`. A admissão seguinte considera, em conjunto, consumo
já contabilizado e todas as reservas ativas. Cada reserva é reconciliada uma
única vez: com `usage` completo e válido, contabiliza-se o uso reportado e o
excedente reservado volta a ficar disponível; sem `usage`, mantém-se a reserva
conservadora com o multiplicador configurado. Falhas após início do transporte,
timeouts e cancelamentos conservam a reserva; rejeições comprovadamente
anteriores ao transporte a liberam sem cobrança estimada.

O snapshot distingue consumo confirmado/contabilizado, reserva ativa e saldo
preventivamente disponível. Chamadas futuras são recusadas quando a soma
ultrapassaria chamadas, tokens ou orçamento, inclusive sob concorrência. Valores
de `estimatedCostUsd` e `chargedCostUsd` continuam sendo estimativas de controle,
não garantia da cobrança final de um provedor.

## Relatórios

O contrato EVAL-07 v1 gera JSON e Markdown a partir do mesmo objeto validado. Os
artefatos contêm apenas allowlists estruturais: identidades, estados técnicos,
contagens, grounding, uso, custo estimado e resultados objetivos. Mensagens,
prompts, credenciais, headers e argumentos brutos de ferramentas não são
incluídos. Arquivos existentes nunca são sobrescritos.

A avaliação objetiva reutiliza o motor EVAL-04, mas fica dentro do contrato
EVAL-07. O relatório EVAL-05 continua restrito a `mode: offline`; resultados de
modelos diferentes não são comparados automaticamente aos baselines EVAL-08.

## Revisão humana

A integração com a EVAL-06 exige exportação explícita de uma transcrição já
sanitizada. Amostras mock usam origem `unverified` e
`not_real_performance`. Nenhuma nota humana é atribuída automaticamente e nenhuma
transcrição é persistida por padrão. A identidade da amostra inclui um
fingerprint SHA-256 dos turnos sanitizados, além de dataset, cenário, modalidade,
modelo e versões aplicáveis. Transcrições equivalentes geram o mesmo ID;
respostas sanitizadas diferentes geram IDs distintos, sem incluir texto bruto no
identificador. A preparação também rejeita divergências entre dataset, cenário,
quantidade de turnos e o relatório informado.

## Condições futuras da EVAL-07B

Antes de implementar ou executar `live_external`, será necessária nova revisão e
autorização explícita. A etapa deverá, no mínimo:

1. confirmar preços atuais do modelo e registrar sua origem;
2. exigir modalidade, chave de habilitação e confirmação humana independentes;
3. exigir modelo, cenários, limites, orçamento e destino explícitos;
4. conectar a instrumentação ao modelo efetivamente informado pelo provedor;
5. recomendar e verificar limites financeiros também na conta do provedor;
6. definir política própria de comparabilidade entre execuções externas;
7. autorizar separadamente eventual exportação de transcrições sanitizadas.

Uma variável `OPENROUTER_API_KEY` isolada nunca será autorização suficiente. Não
há fallback de modelo nem retry automático nesta preparação.
