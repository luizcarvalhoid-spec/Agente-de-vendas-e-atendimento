# EVAL-07A — preparação de avaliações externas

A EVAL-07A prepara o fluxo do agente para uma futura avaliação controlada com
modelo externo. Ela não autoriza rede, OpenRouter ou qualquer chamada
potencialmente paga. A modalidade `live_external` permanece bloqueada no código
e na CLI.

## Modalidades

- `dry_run`: valida dataset, cenários, modelo, limites, preços, orçamento e
  destino sem executar o agente;
- `mock_external`: executa o `ChatService`, ferramentas, assertions e relatórios
  com um `AgentModelPort` injetado e simulado;
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
preferências, carrinho, contexto de recomendação, trace e motor de assertions. O
modelo simulado é injetado por `AgentModelPort`; os testes nunca dependem de
credenciais ou disponibilidade externa.

O controle financeiro reserva custo antes de cada chamada. Com `usage` completo,
o consumo reportado é usado no diagnóstico. Sem `usage`, a reserva conservadora
é mantida com o multiplicador configurado. Chamadas futuras são recusadas quando
ultrapassariam chamadas, tokens ou orçamento. Esse controle é preventivo e não é
garantia da cobrança final de um provedor.

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
transcrição é persistida por padrão.

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
