# EVAL-07D.6 · Experimento comercial no terminal

O comando roda o ChatService, o catálogo fictício e as ferramentas comerciais
no processo do terminal. A rodada pergunta por um shampoo anticaspa para
couro cabeludo oleoso, com sensação refrescante e preço de até R$ 50.

Em `Backend`, o modo padrão verifica o catálogo local e mostra a reserva
histórica de USD 0,00689 para a entrada `azure` publicada na D.4. O dry-run não consulta a OpenRouter, lê
credenciais ou cria o marcador de uso único.

```sh
pnpm eval:commercial-openrouter
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
pnpm eval:commercial-openrouter --live --authorize EVAL-07D.6-R2 --provider azure --confirm-zdr-only
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
A autorização `EVAL-07D.6-R2` tem um novo marcador, criado atomicamente
em `~/.hidrasplash-eval-07d6` antes do primeiro GET autenticado. O marcador
anterior permanece preservado. O novo permanece consumido após falha
ou reinício. A rodada deve ser executada somente pelo usuário
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

O caminho é um experimento por usuário local. A autorização digitada e
a declaração de privacidade são responsabilização do operador. O canário
operacional continua com seu próprio gate Ed25519 e isolamento.
