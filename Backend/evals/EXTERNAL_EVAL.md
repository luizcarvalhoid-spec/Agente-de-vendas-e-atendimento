# EVAL-07B.1 — integração OpenRouter sem execução real

A EVAL-07B.1 conecta tecnicamente cliente OpenRouter, adaptador de modelo,
`ChatService`, ferramentas, assertions e relatórios usando exclusivamente um
transporte HTTP em memória registrado pelo runner. Ela não autoriza rede,
OpenRouter ou qualquer chamada potencialmente paga. A modalidade
`live_external` permanece bloqueada incondicionalmente no código e na CLI:
variável de ambiente, flag ou confirmação textual não a habilitam.

## Modalidades

- `dry_run`: valida dataset, cenários, modelo, roteamento, limites, preços,
  orçamento e destino sem executar o agente;
- `mock_external`: executa o fluxo completo com um modelo registrado pela
  factory mock ou, no teste de integração, com o cliente OpenRouter real sobre
  um transporte em memória registrado;
- `live_external`: reservada para uma etapa futura e sempre bloqueada nesta
  entrega.

Uma execução simulada declara `simulated_external_transport` e
`not_real_model_performance`. Ela nunca deve ser apresentada como evidência de
desempenho de um modelo real.

## Preflight offline

Execute a partir de `Backend`:

```text
pnpm eval:live --action plan \
  --dataset universal-core \
  --scenario universal.core.incomplete-need.001
```

O preflight não lê `OPENROUTER_API_KEY`, não instancia o cliente OpenRouter e
não permite rede. Para um plano completo, informe explicitamente modelo,
provedor, política de dados, cenários, limites de chamadas/tokens/timeout,
estimativa conservadora de entrada, preços de entrada e saída por milhão de
tokens em USD, instante e fonte opcional da confirmação do preço, orçamento,
margem para uso não informado e diretório de saída.

O roteamento registra um provedor exato. `order` e `only` contêm somente esse
provedor, `allow_fallbacks=false`, `require_parameters=true`, política de coleta
de dados e, quando aplicável, ZDR. O provedor do preço deve ser o mesmo do
roteamento. Não há lista de modelos alternativos.

Preços não são embutidos no projeto. Se o pior caso exceder o orçamento, o plano
é bloqueado antes da execução.

## Integração simulada

Um modelo puramente simulado deve passar por `createMockExternalEvalModel`; o
runner recusa objetos não registrados. Adaptadores externos conhecidos não
podem ser registrados como mocks. A existência de `OPENROUTER_API_KEY` não
altera essa decisão.

O caminho OpenRouter simulado usa `createInMemoryOpenRouterTransport`. Somente
transportes criados por essa factory são aceitos; `globalThis.fetch` e funções
não registradas são recusados. O cliente serializa a requisição que seria usada
no futuro e recebe uma resposta HTTP fabricada em memória, exercitando o fluxo
real sem DNS, socket, credencial ou cobrança. A chave interna é uma sentinela
fixa, não lê o ambiente e nunca é registrada.

O adaptador observa separadamente modelo solicitado, modelo retornado, ID da
geração, provedor somente quando informado pela resposta, `finish_reason` e
estado de uso (`complete`, `missing` ou `inconsistent`). Divergência de modelo —
ou de provedor quando ele é efetivamente retornado — interrompe a execução e
impede chamadas posteriores. A ausência do provedor na resposta não é
preenchida por suposição.

Essa fronteira impede a injeção acidental do transporte de produção; ela não é
uma sandbox para JavaScript arbitrário. Código confiável de teste não deve
executar I/O por conta própria.

## Controle de custo

O controle financeiro reserva chamadas, tokens e custo antes de iniciar o
transporte. Cada reserva é reconciliada uma única vez: com `usage` completo e
válido, contabiliza-se o uso reportado; sem `usage` ou com dados inconsistentes,
mantém-se a reserva conservadora. Falhas após o início do transporte, timeouts e
cancelamentos também conservam a reserva. Rejeições comprovadamente anteriores
ao transporte a liberam sem cobrança estimada.

Quando o uso válido informado excede a reserva, o excesso de tokens e custo fica
explícito no relatório. A reconciliação contabiliza o valor informado, marca o
limite afetado e bloqueia admissões futuras; ela não reduz nem oculta o consumo
para caber no orçamento estimado. Valores de custo continuam sendo estimativas
de controle, não garantia da cobrança final de um provedor.

## Relatórios e revisão humana

O contrato EVAL-07 v2 gera JSON e Markdown a partir do mesmo objeto validado.
Os artefatos contêm apenas allowlists estruturais: identidades, estados
técnicos, contagens, grounding, uso, custo estimado e resultados objetivos.
Mensagens, prompts, credenciais, headers e argumentos brutos de ferramentas não
são incluídos. Arquivos existentes nunca são sobrescritos.

Cada relatório possui `executionId` determinístico e mantém separados o modelo
solicitado, os modelos retornados e os provedores realmente observados. Também
preserva IDs de geração sanitizados, motivo de término, integridade de uso e
divergências de identidade.

A avaliação objetiva reutiliza o motor EVAL-04, mas fica dentro do contrato
EVAL-07. O relatório EVAL-05 continua restrito a `mode: offline`; resultados de
modelos diferentes não são comparados automaticamente aos baselines EVAL-08.

A integração com a EVAL-06 exige exportação explícita de transcrição já
sanitizada. A exportação permanece desabilitada para a execução simulada desta
etapa. Nenhuma nota humana é atribuída automaticamente e nenhuma transcrição é
persistida por padrão.

## Condições para uma futura ativação real

Antes de implementar ou executar `live_external`, será necessária outra entrega,
revisão e autorização explícita. Esta branch não contém a capacidade pública de
ativação. A etapa futura deverá, no mínimo:

1. criar uma capacidade de ativação revisada, separada de variáveis, flags e
   texto fornecido ao comando;
2. administrar a credencial real como segredo, sem incluí-la em plano,
   evidência, erro ou relatório;
3. aprovar modelo, provedor, roteamento, política de coleta e ZDR;
4. confirmar preços atuais, provedor e fonte, além de orçamento local e limites
   financeiros na conta do provedor;
5. exigir dataset, cenários, parâmetros, cobertura, destino e retenção
   explicitamente aprovados;
6. definir consentimento e autorização separados para persistência ou revisão
   humana de transcrições sanitizadas;
7. iniciar com canário controlado, monitoramento, interrupção operacional e
   verificação posterior de uso e cobrança;
8. comparar execuções externas apenas quando dataset/fingerprint, modelo,
   provedor, roteamento, parâmetros, limites, contratos, cobertura e procedência
   forem equivalentes.

Uma variável `OPENROUTER_API_KEY` isolada nunca será autorização suficiente. Não
há fallback de modelo nem retry automático nesta integração. Resultados externos
futuros não serão comparáveis automaticamente aos baselines determinísticos da
EVAL-08.
