# EVAL-07D.6 · Experimento comercial no terminal

O comando roda o ChatService, o catálogo fictício e as ferramentas comerciais
no processo do terminal. A rodada pergunta por um shampoo anticaspa para
couro cabeludo oleoso, com sensação refrescante e preço de até R$ 50.

Em `Backend`, o modo padrão verifica o catálogo local e mostra a reserva
histórica de USD 0,008268 da D.4. O dry-run não consulta a OpenRouter, lê
credenciais ou cria o marcador de uso único.

```sh
pnpm eval:commercial-openrouter
```

O live exige autorização separada e um terminal Linux privado, sem gravação
da sessão. Utiliza o `OPENROUTER_API_KEY` dedicado injetado localmente por um
mecanismo seguro. A flag `--confirm-zdr-only` registra a conferência humana
da política efetiva da conta, com ZDR only e sem Safety Retention. A flag
deve ser usada somente após a conferência. Substitua `AZURE_SLUG` pelo slug
regional cuja elegibilidade e autorização foram confirmadas.

```sh
pnpm eval:commercial-openrouter --live --authorize EVAL-07D.6 --provider AZURE_SLUG --confirm-zdr-only
```

O CLI exige a mesma rota exata (`azure/us` ou `azure/eu`) nos dois
catálogos públicos, com parâmetros compatíveis e `safety_retention: false`
na lista ZDR. `azure` seleciona uma família. Na evidência pública revisada
na D.4, a rota da API era `azure`, sem comprovação de um seletor Azure
exclusivo que também constasse nos dois catálogos. Esse estado interrompe
o experimento antes da consulta autenticada. [Catálogo do Luna](https://openrouter.ai/api/v1/models/openai/gpt-6-luna/endpoints) ·
[Lista ZDR](https://openrouter.ai/api/v1/endpoints/zdr) ·
[Semântica dos seletores](https://openrouter.ai/docs/guides/routing/provider-selection)

Com rota comprovada, o CLI recalcula a reserva para duas chamadas usando os
maiores preços publicados de entrada e cache e o preço de saída aplicável,
com margem de 1,25. Valida na API o teto de USD 1,00, a ausência de reset
e o saldo disponível da chave e do orçamento efetivo, quando informado.
O marcador em `~/.hidrasplash-eval-07d6` é criado atomicamente antes do
primeiro GET autenticado. Ele pertence ao usuário Linux e permanece após
falha ou reinício. A rodada deve ser executada somente pelo usuário
autorizado. [Metadados da chave](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key)

São permitidas duas chamadas de até 20.000 tokens estimados de entrada e
512 de saída, com 15 segundos por chamada, sem retries ou redirecionamentos.
O terminal mostra a resposta sanitizada e as observações técnicas. A
identidade de família `Azure`, quando retornada, mantém a confirmação do
endpoint como pendente. O custo local é estimado. A cobrança efetiva fica
pendente de conciliação no painel da OpenRouter. O único arquivo persistido
pelo CLI é o marcador de uso único.

O caminho é um experimento por usuário local. A autorização digitada e
a declaração de privacidade são responsabilização do operador. O canário
operacional continua com seu próprio gate Ed25519 e isolamento.
