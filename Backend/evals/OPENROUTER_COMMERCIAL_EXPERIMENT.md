# EVAL-07D.6 · Experimento comercial no terminal

O comando roda o ChatService, o catálogo fictício e as ferramentas comerciais
no processo do terminal. A rodada pergunta por um shampoo anticaspa para
couro cabeludo oleoso, com sensação refrescante e preço de até R$ 50.

## Resultado da R4 em 26/11/2026

Primeiro teste comercial real aprovado do agente. O terminal executou o
`ChatService` com o catálogo fictício e o cliente OpenRouter.

| Evidência | Resultado |
| --- | --- |
| Modelo solicitado | `openai/gpt-6-luna` |
| Modelo retornado | `openai/gpt-6-luna` |
| Provedor observado | Azure |
| Status técnico | `completed` |
| Avaliação comercial | `passed` |
| Chamadas ao modelo | 2 |
| Ferramentas executadas | 1 |
| Produto recomendado | ID 13 |
| Tokens de entrada | 5.204 |
| Tokens de saída | 172 |
| Custo estimado local | US$ 0,00073651 |
| Cobrança efetiva | Não verificada |
| Endpoint exato | Não verificado |

O aceite cobre tool calling e recomendação fundamentada para esse cenário.
A validação do fluxo HTTP, da jornada em navegador e de outros cenários
com o modelo real permanece pendente. A autorização de uso único da R4
foi consumida.
[PR #60](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/60) · [Fase 05](../../docs/05-agente-openrouter.md) · [Fase 08](../../docs/08-observabilidade-evals.md)

## Operação e limites

Em `Backend`, o modo padrão verifica o catálogo local e mostra a reserva
histórica de USD 0,00689 para a entrada `azure` publicada na D.4. O dry-run
funciona sem consulta à OpenRouter, credenciais ou criação de marcador.

```sh
pnpm eval:commercial-openrouter --dry-run
```

O CLI lê `process.env.OPENROUTER_API_KEY` e não carrega `.env`
automaticamente. Injete a chave dedicada pelo mecanismo local no mesmo
processo Linux que executará o CLI. Em um terminal privado com Bash,
também é possível usar um prompt com digitação oculta e variável limitada
a um subshell. O comando exibe apenas a presença e a compatibilidade do
formato. A validade e os limites reais serão conferidos na etapa live.

```sh
(
  set +x
  IFS= read -rs -p 'Chave dedicada OpenRouter: ' OPENROUTER_API_KEY || exit
  printf '\n'
  export OPENROUTER_API_KEY
  pnpm eval:commercial-openrouter --check-key
)
```

O live exige autorização separada e um terminal Linux privado, sem gravação
da sessão. Use `--confirm-zdr-only` somente após conferir a política efetiva
da conta ou guardrail da chave dedicada para modelos OpenAI, com ZDR only e
sem Safety Retention. A R4 já foi executada. Outra rodada exige uma nova
autorização e um novo marcador de uso único.

O seletor `azure` cobre a família. O CLI exige uma única entrada Azure
para o modelo em cada catálogo público, com o tag publicado `azure`,
o mesmo nome de deployment e os mesmos preços, os parâmetros exigidos
e `safety_retention: false` na lista ZDR. Entradas regionais adicionais,
duplicatas, divergências ou evidência incompleta bloqueiam antes da
consulta autenticada. A requisição limita a família com `provider.only`,
`data_collection: deny`, `zdr: true`, `allow_fallbacks: false` e
`require_parameters: true`. A documentação condiciona a exclusão de
Safety Retention à política efetiva da conta ou guardrail. A seleção da
família não identifica um endpoint exato no resultado. [Catálogo do Luna](https://openrouter.ai/api/v1/models/openai/gpt-6-luna/endpoints) ·
[Lista ZDR](https://openrouter.ai/api/v1/endpoints/zdr) ·
[Semântica dos seletores](https://openrouter.ai/docs/guides/routing/provider-selection) ·
[Política ZDR](https://openrouter.ai/docs/guides/features/zdr)

Com rota comprovada, o CLI recalcula a reserva para duas chamadas usando os
maiores preços publicados de entrada e cache e o preço de saída aplicável,
com margem de 1,25 e orçamento interno de USD 1,00. Na API, exige teto
externo de USD 5,00 sem reset para a chave dedicada. O saldo da chave e o
do orçamento efetivo, quando informado, devem cobrir a reserva.
A autorização `EVAL-07D.6-R4` usa o marcador exclusivo
`070d6000000000000000000000000004`, criado atomicamente
em `~/.hidrasplash-eval-07d6` antes do primeiro GET autenticado. Os
marcadores R1, R2 e R3 permanecem preservados. O da R4 permanece consumido
após falha ou reinício. A rodada deve ser executada somente pelo usuário
autorizado. [Metadados da chave](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key)

São permitidas duas chamadas de até 20.000 tokens estimados de entrada e
512 de saída, com 15 segundos por chamada, sem retries ou redirecionamentos.
O terminal mostra a conclusão técnica separadamente do resultado comercial.
A aprovação comercial exige uma recomendação de produto compatível e
evidência de consulta de produto executada com resultado encontrado.
Uma resposta genérica sem recomendação é falha comercial. O terminal mostra
a resposta sanitizada para análise humana, inclusive quando o ChatService
recusa o texto por falta de grounding. Nesse caso, identifica o texto como
material para revisão comercial e retorna código 2. Interrupções técnicas
retornam código 1. O custo local é estimado. A cobrança efetiva fica
pendente de conciliação no painel da OpenRouter. O único arquivo persistido
pelo CLI é o marcador de uso único.

## Diagnóstico offline da R2

A atividade da OpenRouter registrou Azure, HTTP upstream 200 e motivo
normalizado `tool_calls` com motivo nativo `completed`. O CLI interrompeu
na primeira tentativa com `INVALID_MODEL_RESPONSE`, sem ferramenta
executada e sem identidade retornada. A observação do modelo só ocorre
depois de o cliente validar o corpo e os metadados. Assim, o primeiro
bloqueio mais provável está nessa etapa. O registro de atividade não
permite identificar qual validação falhou.

| Etapa | Falha observável |
| --- | --- |
| Corpo HTTP com sucesso | Excesso de bytes ou falha de leitura como JSON produzem `INVALID_MODEL_RESPONSE`. Se o JSON falhar com mídia SSE, o diagnóstico indica `UNEXPECTED_EVENT_STREAM`. |
| Envelope Chat Completions | ID, modelo, data, escolhas, mensagem, uso informado e metadados são validados. Ausência da escolha de índice zero ou de texto e ferramentas também é rejeitada. `content: null` com ferramentas válidas é aceito. |
| Estrutura das ferramentas | Tipo, ID, nome, quantidade e campo de argumentos são validados. IDs duplicados falham. Uma função não ofertada produz `TOOL_CALLING_INCOMPATIBLE`. |
| Argumentos da ferramenta | O cliente exige uma string dentro do limite. O orquestrador interpreta a string como JSON e valida o schema da função. JSON interno inválido ou dados incompatíveis produzem `INVALID_ARGUMENTS` como resultado da ferramenta, com execução bloqueada. |
| Metadados de roteamento | Quando a lista de endpoints está presente, exige uma única seleção e consistência literal com o provedor e o modelo retornados quando comparáveis. A tentativa informada deve ser 1. |
| Identidade após validação | O adaptador registra a observação antes de rejeitar uma divergência de identidade. A rodada comercial reporta `MODEL_IDENTITY_MISMATCH` ou `PROVIDER_UNVERIFIED` para uma resposta estruturalmente válida com essas divergências. |
| Orquestrador | Uma mensagem final sem texto, se chegar de outro adaptador, ou uma exceção inesperada ao processar uma chamada também pode terminar em `INVALID_MODEL_RESPONSE`. Lotes inválidos e limites têm motivos próprios. |

`validacaoResposta` informa somente a primeira categoria de validação
observada pelo cliente. O campo não inclui valores recebidos, caminhos ou
mensagens do validador.

O catálogo público relaciona o ID solicitado `openai/gpt-6-luna` ao
`canonical_slug` `openai/gpt-6-luna-20260922`. Isso comprova a relação no
catálogo. O valor de `model` no JSON entregue ao cliente na R2 segue
desconhecido. No código da R2, metadados de seleção e
resposta com slugs diferentes falhavam antes da observação. Um slug
canônico coerente nos metadados chegava à comparação literal do adaptador e
gerava `MODEL_IDENTITY_MISMATCH`, com a identidade observada.
[Metadados públicos do modelo](https://openrouter.ai/api/v1/model/openai/gpt-6-luna)

O POST inclui `stream: false`, conferido nas fixtures. A OpenRouter
documenta `stream` no pedido de Chat Completions e `streamed` nos metadados
da geração, sem esclarecer se esse segundo campo distingue o trecho
upstream da entrega ao cliente. Os metadados da R2 não comprovam que o
cliente recebeu SSE. Um fluxo upstream agregado em JSON e uma entrega
inesperada de SSE permanecem hipóteses. A fixture JSON com `streamed: true`
continua válida. A fixture SSE é rejeitada.
[Chat Completions](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion) ·
[Metadados da geração](https://openrouter.ai/docs/api/api-reference/generations/get-generation) ·
[Contrato de ferramentas](https://openrouter.ai/docs/guides/features/tool-calling)

Reproduza as verificações em `Backend` com transporte em memória.

```sh
node --import tsx --test test/openrouter-commercial-experiment.test.ts test/openrouter-client.test.ts test/tool-orchestrator.test.ts test/openai-direct.test.ts
```

## Verificação de identidade na R4

A R3 confirmou `ROUTING_MODEL_CONFLICT`. Os valores dos dois campos
rejeitados não foram registrados, portanto a divergência entre alias e
slug canônico segue como hipótese para aquela resposta.

No preflight da R4, um GET público, sem credencial, confirma os campos
`id` e `canonical_slug` do par fixado
`openai/gpt-6-luna` e `openai/gpt-6-luna-20260922`. A execução bloqueia
antes de consumir o marcador se a consulta falhar ou se o par mudar.
O dry-run não faz essa consulta. [Catálogo público da OpenRouter](https://openrouter.ai/api/v1/model/openai/gpt-6-luna)

O POST continua solicitando o alias com `stream: false`. O cliente exige
a confirmação do ID solicitado, uma única seleção, a primeira tentativa
e consistência no provedor. Quando o detalhe das tentativas é publicado,
deve identificar uma única tentativa bem-sucedida coerente com a seleção.
Apenas os dois IDs comprovados podem substituir um ao outro na comparação
da seleção com a resposta e na verificação do adaptador. O CLI preserva o
valor literal retornado quando ele pertence ao par. Diagnósticos de
rejeição usam categorias fixas. O roteamento continua limitado à família
Azure verificada no preflight, sem atribuir um endpoint exato a partir
de metadados que só identificam o provedor. [Metadados de roteamento da OpenRouter](https://openrouter.ai/docs/guides/routing/routers/router-metadata)

O caminho é um experimento por usuário local. A autorização digitada e
a declaração de privacidade são responsabilização do operador. O canário
operacional continua com seu próprio gate Ed25519 e isolamento.
