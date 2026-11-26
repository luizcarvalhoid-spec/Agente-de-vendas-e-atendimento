# EVAL-07D.6 · Experimento comercial no terminal

O comando roda o ChatService, o catálogo fictício e as ferramentas comerciais
no processo do terminal. A rodada pergunta por um shampoo anticaspa para
couro cabeludo oleoso, com sensação refrescante e preço de até R$ 50.

Em `Backend`, o modo padrão verifica o catálogo local e mostra a reserva
histórica de USD 0,00689 para a entrada `azure` publicada na D.4. O dry-run não consulta a OpenRouter, lê
credenciais ou cria o marcador de uso único.

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
sem Safety Retention. Para a rodada autorizada, execute o comando abaixo
no processo com a chave injetada.

```sh
pnpm eval:commercial-openrouter --live --authorize EVAL-07D.6-R3 --provider azure --confirm-zdr-only
```

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
A autorização `EVAL-07D.6-R3` usa o marcador exclusivo
`070d6000000000000000000000000003`, criado atomicamente
em `~/.hidrasplash-eval-07d6` antes do primeiro GET autenticado. Os
marcadores R1 e R2 permanecem preservados. O da R3 permanece consumido
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
catálogo. O valor de `model` no JSON entregue ao cliente segue
desconhecido. As fixtures reproduzem dois casos. Metadados de seleção e
resposta com slugs diferentes falham antes da observação. Um slug
canônico coerente nos metadados chega à comparação literal do adaptador e
gera `MODEL_IDENTITY_MISMATCH`, com a identidade observada.
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

Antes de autorizar outra rodada, revisar a categoria mais provável com
evidência sanitizada sobre o tipo de mídia e a consistência dos campos de
roteamento. Se a divergência de slugs for confirmada, validar uma regra
restrita ao par de IDs comprovado com as mesmas exigências de Azure, ZDR
e ausência de fallback. Os marcadores consumidos da R1 e R2 devem ser
preservados.

O caminho é um experimento por usuário local. A autorização digitada e
a declaração de privacidade são responsabilização do operador. O canário
operacional continua com seu próprio gate Ed25519 e isolamento.
