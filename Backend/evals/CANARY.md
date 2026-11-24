# Preparação do primeiro canário externo

O candidato inicial está em [first-external-candidate.v1.json](canary/first-external-candidate.v1.json).
Ele seleciona `universal.core.incomplete-need.001` no dataset `universal-core`.
É uma amostra funcional de um turno para verificar a cadeia de execução e uma
pergunta de esclarecimento. Modelo, provedor e configuração financeira aguardam
decisão humana.

## Candidato GPT-4.1 Mini (EVAL-07B.4)

O [candidato versionado](canary/gpt-4.1-mini-candidate.v1.json) fixa
`openai/gpt-4.1-mini` no provedor `openai`, com `allowFallbacks: false`,
`requireParameters: true`, `dataCollection: deny` e
`zeroDataRetention: true`. Mantém o cenário universal do rascunho original,
com persistência de transcrições desativada. O plano propõe duas chamadas de
até 20.000 tokens estimados de entrada e 512 de saída, teto total de 41.024,
timeout de 15.000 ms tanto no cliente quanto no turno e orçamento de USD 1,00.

O preço de referência do endpoint OpenAI é USD 0,40 de entrada e USD 1,60 de
saída por milhão de tokens. Os valores foram observados no GET público do
catálogo em 19/11/2026 às 11:31:29 em São Paulo. O instante UTC observado foi
registrado em `pricing.confirmedAt`. A confirmação humana do preço, da fonte
e do teto na conta permanece pendente.
[Página do modelo](https://openrouter.ai/openai/gpt-4.1-mini) ·
[Catálogo de endpoints do modelo](https://openrouter.ai/api/v1/models/openai/gpt-4.1-mini/endpoints)

Com margem 1,25, a estimativa é de USD 0,0088192 por chamada e USD 0,0176384
para duas chamadas. A reserva preventiva é de USD 0,011024 por chamada e
USD 0,022048 no total, deixando USD 0,977952 no orçamento proposto.

A [lista pública de endpoints ZDR](https://openrouter.ai/api/v1/endpoints/zdr),
consultada em 19/11/2026, mostrou uma entrada do modelo com tag `azure` e
nenhuma com a combinação exata de modelo e tag `openai`. A elegibilidade do
endpoint pretendido permanece pendente (`data_policy_review_pending`).
O catálogo do endpoint OpenAI anuncia `max_tokens` em
`supported_parameters`. Antes de uma eventual ativação, confirme como o
filtro `requireParameters` trata `max_completion_tokens`, campo enviado
pelo cliente atual. A rota segue vinculada ao provedor OpenAI e exige ZDR.

Para gerar os relatórios offline a partir de `Backend`:

```sh
pnpm eval:canary --action prepare --manifest evals/canary/gpt-4.1-mini-candidate.v1.json --output-dir external-eval-reports/gpt-4.1-mini-prepare
pnpm eval:canary --action verify --manifest evals/canary/gpt-4.1-mini-candidate.v1.json --output-dir external-eval-reports/gpt-4.1-mini-verify
```

O preparo calcula os custos do rascunho e permanece
`configuration_incomplete` sem `sourceRevision` ou fingerprint do plano.
O gate mantém `LIVE_EXECUTION_DISABLED`, junto com as pendências de autoridade
e teto financeiro externo. Após o merge, preencha a revisão efetivamente
carregada numa cópia operacional, gere um novo preflight e revise o
fingerprint resultante antes de obter atestações ou assinatura.

## Alternativa Azure para GPT-4.1 Mini (EVAL-07B.5)

A variante [Azure](canary/gpt-4.1-mini-azure-candidate.v1.json) preserva
modelo, cenário, limites, margem e orçamento do candidato OpenAI. `azure`
designa a família de provedor pesquisada. Os GETs públicos e a documentação
consultados em 19/11/2026 foram resumidos em
[evidência versionada](canary/gpt-4.1-mini-endpoint-evidence.v1.json),
com horários UTC e uma seleção de campos de catálogo.

| Endpoint observado | Escopo | Evidência ZDR | Tarifas entrada/saída em USD por milhão | Reserva estimada em USD |
| --- | --- | --- | ---: | ---: |
| `openai` · `872eccb7-9c85-45fc-974a-ff7c8e2407e6` | Chat global | Excluído pelo ZDR para modelos OpenAI | 0,40 / 1,60 | 0,022048 |
| `azure` · `1551aa56-4221-448a-b280-f862f73c27de` | Chat global | Indicador da página e lista pública ZDR, com `safety_retention: false` | 0,40 / 1,60 | 0,022048 |
| `azure/swedencentral` · `fd1475c4-5864-42c0-bca0-d78568a069cb` | Chat regional | Indicador da página positivo. Ausente na lista ZDR global consultada. | 0,44 / 1,76 | 0,0242528 |
| `openai` · `fe95eb82-a92a-4886-8492-7a138b2afc5f` | Batch | Sem evidência de ZDR para este fluxo | 0,20 / 0,80 | Fora do escopo |

O maior valor observado para Azure é USD 0,0242528, abaixo do orçamento de
USD 1,00. Ele compara as tarifas publicadas com os mesmos limites de duas
chamadas e margem 1,25. A variante deixa `pricing` e `sourceRevision`
pendentes até confirmar o endpoint, sua tarifa aplicável e o checkout. Seu
preflight permanece `configuration_incomplete`, sem fingerprint definitivo
ou reserva aprovada. O candidato OpenAI foi mantido como histórico.

O [guia de roteamento](https://openrouter.ai/docs/guides/routing/provider-selection)
explica que `order` e `only` com slug base podem alcançar todos os endpoints
elegíveis da família. Desabilitar fallback não seleciona um UUID do catálogo.
A página associa o UUID regional ao slug `azure/swedencentral` e descreve
essa oferta no roteamento regional da UE. O cliente atual usa a URL global.
A variante regional não foi adotada. O manifesto v1 aceita slugs base para
este ensaio. Antes de propor um endpoint específico, valide o seletor e o
contrato de roteamento aplicáveis.

O Azure global anuncia `max_completion_tokens`, `tools`, `tool_choice` e
escolha automática de ferramenta. O OpenAI direto anuncia `max_tokens`.
A [API de chat](https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request)
documenta ambos e deprecia `max_tokens`, sem comprovar equivalência no
filtro `require_parameters`. Mantemos `max_completion_tokens`,
`stream: false` e `require_parameters: true`. O ensaio em memória verifica
o formato enviado, sem tratar o resultado como teste de compatibilidade em
produção.

O [guia ZDR](https://openrouter.ai/docs/guides/features/zdr) exclui o OpenAI
de primeira parte sob ZDR para o grupo OpenAI. A página descreve os endpoints
Azure observados sem retenção de prompts, treinamento ou Safety Retention,
mas as condições efetivas da conta não foram verificadas. `zdr: true` aplica
a política da conta ou guardrail. Onde houver a opção de permitir Safety
Retention, o canário exige `ZDR only`. Confira a configuração efetiva do
grupo OpenAI, as opções de retenção aplicáveis, `data_collection: deny` e o
teto financeiro da conta. Nenhuma configuração da conta foi consultada.

### Seleção e identidade do endpoint (EVAL-07B.6)

Em 20/11/2026, o tag publicado para a rota global continua sendo `azure`.
`provider.order` prioriza os slugs informados, `provider.only` restringe
os candidatos e `allow_fallbacks: false` desativa o fallback. O slug base
se expande para endpoints elegíveis da família. Sufixos delimitam variantes,
regiões ou tiers e também podem corresponder a um prefixo. `azure/swedencentral`
é a variante regional observada na EVAL-07B.5, apresentada na página do modelo
fora do roteamento Standard. A rota regional exige análise própria. Exclusões
por `provider.ignore` dependeriam da lista completa de rotas elegíveis.
O UUID na tabela identifica o registro de catálogo. As fontes consultadas
não documentam o UUID como seletor nem um slug exclusivo para o Azure global.
O resultado permanece `EXACT_ENDPOINT_SELECTION_UNVERIFIED`.
[Roteamento por provedor](https://openrouter.ai/docs/guides/routing/provider-selection) ·
[API pública de endpoints](https://openrouter.ai/api/v1/models/openai/gpt-4.1-mini/endpoints) ·
[Página do modelo](https://openrouter.ai/openai/gpt-4.1-mini)

Nos ensaios, o campo `provider` da resposta é comparado literalmente. O
nome de exibição `Azure` e um campo ausente não satisfazem a identidade
esperada `azure`. Se a lista `openrouter_metadata.endpoints.available`
estiver presente, a resposta deve indicar uma única seleção coerente com
o modelo retornado e com `provider` quando informado. `selected` localiza
uma entrada da lista, cujos campos documentados incluem provedor e modelo,
sem UUID. Um `attempt` diferente de 1 em resposta bem-sucedida contradiz
o ensaio com fallback desabilitado. O opt-in `X-OpenRouter-Metadata` está documentado e o ensaio
injeta esse formato no transporte em memória.
[Chat Completions](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion) ·
[Metadados de roteamento](https://openrouter.ai/docs/guides/routing/routers/router-metadata)

`GET /api/v1/generation` requer autenticação e pode correlacionar `id`,
`model` e `provider_name`. `provider_name` é um nome de exibição, e a
referência consultada não vincula um campo de identidade ao UUID de catálogo.
A projeção offline exercita a correlação em fixtures e descarta todos os
outros campos. Uma eventual consulta operacional exigiria autorização e
credencial de leitura específicas. Ela usaria apenas metadados da mesma
geração e excluiria a rota de conteúdo armazenado, novas gerações e retries.
[Metadados de geração](https://openrouter.ai/docs/api/api-reference/generations/get-generation)

O contrato do manifesto v1 e os dois candidatos permanecem válidos para
preparação. Para revisar o contrato operacional são necessários um seletor
exclusivo, uma evidência estável que correlacione o endpoint à geração, a
compatibilidade dos parâmetros e a garantia efetiva de `ZDR only`, sem
Safety Retention. A tarifa precisa corresponder à rota permitida. Os
preços observados na família são exemplos documentais, pois a cobertura
e a política de todas as rotas elegíveis não estão comprovadas. Uma futura
mudança de contrato deverá vincular a rota, a identidade, a política e a
tarifa ao fingerprint e exigir nova aprovação.

Em `Backend`, o comando abaixo gera JSON e Markdown com as evidências,
os preflights e os resultados dos ensaios offline.

```sh
pnpm exec tsx src/scripts/eval-canary-compatibility.ts --output-dir external-eval-reports/gpt-4.1-mini-azure-identity
```

A alternativa segue documental e o gate mantém `LIVE_EXECUTION_DISABLED`.
Uma futura mudança de provedor para execução depende de aprovação separada,
confirmação da rota e da identidade observável, política ZDR efetiva
sem Safety Retention não aprovada, tarifa e limite de conta confirmados.

### Diagnóstico do ensaio intermitente do gate

Na EVAL-07B.5, um caso do ensaio `timeout, erro técnico e identidade
inválida` registrou zero chamadas em memória onde esperava uma. A causa
não foi confirmada. A fixture usa um relógio fixo para a aprovação, mas
a inspeção Git e os timeouts do ensaio usam limites reais. Se o sintoma
reaparecer, preserve a primeira falha. O diagnóstico agora registra o
caso sintético, os códigos de bloqueio, o estado de consumo e os códigos
técnicos para distinguir falha antes do transporte de resposta rejeitada.

Em `Backend`, execute o caso isolado e depois repita o mesmo comando de
forma diagnóstica, inclusive sob a carga em que o erro foi observado.

```sh
pnpm exec tsx --test --test-name-pattern 'timeout, erro técnico e identidade inválida' test/external-canary-operations.test.ts
```

Instabilidade de I/O ou de agendamento continua possível quando os limites
reais são atingidos. Registre o resultado e a duração de cada execução.

## Candidato GPT-6 Luna via OpenAI direto

O manifesto [gpt-6-luna-openai-direct-candidate.v1.json](canary/gpt-6-luna-openai-direct-candidate.v1.json)
usa o contrato de preparação `openai_direct_preparation`. O adaptador
implementa `AgentModelPort` e reutiliza as validações, o transporte
limitado e o tratamento de uso de Chat Completions. O servidor continua
com a configuração existente. A preparação direta exige transporte
em memória registrado e não lê credenciais.

O contrato envia `model: gpt-6-luna`, `reasoning_effort: none`,
`stream: false`, `store: false`, `max_completion_tokens` e, quando
fornecidas pelo `ChatService`, as funções registradas com `tool_choice: auto`.
A requisição é dirigida a `https://api.openai.com/v1/chat/completions`.
Os campos de roteamento da OpenRouter não fazem parte da requisição.
A origem OpenAI vem da integração selecionada, e o campo `model` retornado
é comparado literalmente. A identidade do endpoint executado fica
desconhecida nos ensaios. [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) ·
[Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)

`store: false` desativa o armazenamento solicitado da conclusão. A
documentação lista retenção padrão de até 30 dias para monitoramento de
abuso e descreve exceções e condições de ZDR. A política efetiva do
projeto e eventuais dados permitidos ainda precisam de revisão humana.
O manifesto tem fingerprint próprio, sem revisão operacional ou aprovação,
e `LIVE_EXECUTION_DISABLED` continua obrigatório. [Controles de dados](https://developers.openai.com/api/docs/guides/your-data)

Em 22/11/2026, as tarifas públicas Standard eram USD 0,10 por milhão de
tokens de entrada e USD 0,50 por milhão de saída. Com duas chamadas de até
20.000 tokens de entrada e 512 de saída, o controlador estima uma reserva
documental de USD 0,00564, já incluindo margem de 1,25. O teto proposto é
USD 1,00. Tarifas efetivas, condições da conta e cobrança futura continuam
pendentes de aprovação. [Tarifas do modelo](https://developers.openai.com/api/docs/models/gpt-6-luna)

Em `Backend`, gere o relatório JSON e Markdown do ensaio em `universal-core`.

```sh
pnpm exec tsx src/scripts/eval-openai-direct.ts --output-dir external-eval-reports/openai-direct-preparation
```

As dez jornadas de cosméticos são exercitadas separadamente em
`test/openai-direct-commercial.test.ts`, com respostas de modelo sintéticas
e catálogo local. Os testes cobrem interesse em anticaspa, necessidade
incompleta, couro cabeludo oleoso, comparação, preço e estoque, produto
inexistente, orçamento contraditório, recomendação imediata sem preferências,
benefício inventado e linguagem coloquial com pedido de garantia clínica.
Os casos verificam grounding, ferramentas executadas, preços canônicos e
limites comerciais. A qualidade conversacional do modelo real segue pendente.

## Primeiro canário operacional OpenAI direto (EVAL-07C.1)

O [rascunho operacional](canary/gpt-6-luna-openai-operational-candidate.v1.json)
define `universal.core.incomplete-need.001` como primeiro cenário, com dados
fictícios, até duas chamadas, 20.000 tokens estimados de entrada e 512 de
saída por chamada, e timeout de 15 segundos. A simulação e o rascunho
operacional usam contratos distintos. O rascunho não possui revisão nem
fingerprint operacional. A reserva documental é USD 0,00564, com teto
proposto de USD 1,00 e margem de 1,25.

A futura assinatura Ed25519 usa o domínio `agent-evals/openai-direct-canary-approval/v1`.
Ela vincula o manifesto completo, dataset, cenário, código, worktree,
dependências, projeto e autorização de uso único. As evidências assinadas
para retenção, vigência de tarifas e teto externo são verificadas
independentemente. O gate exige enforcement do limite externo e saldo
suficiente no mesmo projeto. A própria OpenAI documenta que notificações
permitem novas chamadas e que o enforcement do teto pode ter atraso.
[Limites de projetos na OpenAI](https://help.openai.com/en/articles/9186755-managing-projects-in-the-api-platform)

O caminho autenticado fixa HTTPS, `OpenAI-Project`, `gpt-6-luna` e bloqueia
redirecionamentos. Reutiliza o timeout, cancelamento, limites de payload,
validação de ferramentas e reserva financeira existentes. Verifica a
vigência das evidências antes de cada envio. A autorização é reservada de
forma atômica antes do primeiro envio e permanece consumida após falha ou
interrupção. Os relatórios registram contagens e códigos, sem prompts,
transcrições, textos retornados, IDs de geração, cabeçalhos ou credenciais.

O módulo operacional vem sem deployment ou autoridade provisionados.
Variáveis de ambiente e argumentos CLI não liberam esse caminho. Um
deployment futuro exige revisão separada, serviço Linux dedicado com UID
fixo, diretório de estado privado e persistente em
`/var/lib/openai-canary/authorizations`, e credencial protegida pelo serviço
em `/run/credentials/openai-canary.service/openai-api-key`, vinculada ao
projeto dedicado. O mount e o
checkout precisam ficar protegidos de alterações concorrentes. O runtime
verificável usa os módulos TypeScript do checkout aprovado e dependências
instaladas no próprio checkout. Uma junction para dependências de outra
worktree pode servir aos testes e fica bloqueada pela verificação operacional.

`store: false` não comprova ZDR. A futura execução exige decisão humana
expressa sobre a retenção padrão para este escopo exclusivamente fictício.
Dados pessoais reais e persistência de transcrições permanecem proibidos.
[Controles de dados da OpenAI](https://developers.openai.com/api/docs/guides/your-data)

O comando abaixo executa o preflight somente leitura e grava os relatórios.

```sh
pnpm exec tsx src/scripts/verify-openai-canary.ts --output-dir external-eval-reports/openai-canary-07c1
```

Os ensaios de gate em `test/openai-canary-operations.test.ts` usam checkout,
assinatura, credencial e transporte sintéticos. Cobrem recusas antes do
envio, expiração após reserva, concorrência, modelo divergente, falhas HTTP,
timeout, cancelamento, limite de duas chamadas, excesso de reserva e
sanitização. A preparação não habilitou `live_external` nem executou o canário.

## Readiness do primeiro canário (EVAL-07C.2)

A decisão atual é **NO-GO**. O procedimento de instalação, revisão humana,
aprovação e reconciliação está no [checklist operacional](OPENAI_CANARY_READINESS.md).
O [relatório JSON](canary/openai-readiness.07c2.v1.json) registra o preflight
offline e as regressões executadas na revisão do merge do PR #52.

## Preflight local

A partir de `Backend`, gere os dois relatórios de preparação:

```sh
pnpm eval:canary --action prepare --manifest evals/canary/first-external-candidate.v1.json --output-dir external-eval-reports/canary-draft
```

Arquivos JSON e Markdown são gravados de forma exclusiva. Use outro diretório
para registrar uma revisão posterior. O destino de `--output-dir` é o dos
artefatos desta etapa. O campo `outputDirectory` no manifesto descreve o destino
planejado do experimento.

Complete uma cópia local do rascunho após definir modelo exato, slug do provedor,
`dataCollection` e `zeroDataRetention`, limites, preços em USD por milhão de
tokens, fonte HTTPS pública sem parâmetros, horário confirmado, orçamento,
margem, destino relativo e `sourceRevision` (SHA completo do código a revisar).
Confira as versões técnicas e calcule o fingerprint com o preflight. O hash
SHA-256 usa a serialização canônica da EVAL-08 e cobre o manifesto inteiro.
Uma alteração exige reavaliar as atestações do plano. O dataset é verificado
contra seu hash e versão locais. O SHA de código informado deve ser conferido
contra a revisão a implantar.

`maxInputTokensPerCall` é o teto da estimativa local de entrada, incluindo
mensagens e ferramentas anunciadas. Ele é usado também na reserva preventiva.
`maxOutputTokensPerCall` é enviado ao cliente. O timeout de cada requisição
aceita até 60.000 ms e o timeout efetivo do turno deve ser
`min(timeoutMs, 45000)`, respeitando o teto do orquestrador. A amostragem usa os
padrões do provedor. A seleção de ferramentas segue o ChatService, com
streaming desabilitado. A estimativa financeira exibe custo e reserva por
chamada e totais, margem e saldo. O cálculo local arredonda como EVAL-07 e
pode diferir da cobrança e da tokenização reais.

## Revisão humana e autorização

O JSON expõe `status`, etapas e requisitos. Um rascunho incompleto indica os
campos pendentes. Uma configuração tecnicamente válida chega a
`ready_for_human_review`, com estados financeiros, de dados e de autorização
pendentes conforme as evidências registradas. Conflitos de fingerprint,
roteamento, timeout ou orçamento bloqueiam o preflight.

A revisão pode ser registrada em um JSON local separado, passado como
`--review <arquivo>`. Use `manifestFingerprint` com o hash do manifesto e
`attestations` com os itens efetivamente revisados:

- `price_and_source` — preço vigente, fonte pública e data conferidos.
- `model_and_provider` — modelo e provedor aprovados para o ambiente isolado.
- `data_policy` — coleta, retenção e condições aplicáveis ao conteúdo conferidas.
- `local_budget` — teto em USD aprovado para este plano.
- `provider_account_spend_limit` — limite na conta isolada verificado. Sem a atestação, permanece pendente.
- `scope_and_scenario` — dataset e único cenário aprovados.
- `plan_and_fingerprint` — parâmetros, revisão de código, destino e hash conferidos.
- `secure_credential_mechanism` — disponibilidade da credencial verificada pelo operador no mecanismo seguro, sem registrar o valor.

Esses registros são atestações declaradas. O preflight offline não autentica
o autor nem consulta a fonte de preço ou a conta do provedor. Somente as
atestações com fingerprint correspondente são reconhecidas. A autorização
específica permanece pendente mesmo com todos os itens atestados.
`runLiveExternalEval()` e `eval:live --action run` continuam bloqueados. A
ativação futura depende de implementação e revisão próprias e de autorização
específica para o fingerprint e para a execução. Chave de ambiente, flags,
confirmação textual e arquivo de atestação não concedem essa autorização.

## Prontidão operacional (EVAL-07B.3)

A ação `verify` gera o relatório operacional v1 em JSON e Markdown. Execute a
CLI a partir do código-fonte em `Backend`:

```sh
pnpm eval:canary --action verify --manifest <arquivo> --review <arquivo> --approval <arquivo> --output-dir <diretório>
```

O relatório pode ser gerado sem aprovação para inventariar bloqueios. A
verificação é somente leitura para o registro de uso único. O processo
retorna código 1 e inclui `LIVE_EXECUTION_DISABLED` porque a execução
externa continua indisponível, inclusive com uma aprovação sintética válida.
`prepare` e o ensaio local da EVAL-07B.2 continuam disponíveis.

### Revisão, checkout e dependências

O gate consulta o HEAD do Git no checkout do código, compara o commit com
`sourceRevision` e verifica arquivos rastreados, alterações no índice e
arquivos não rastreados. Arquivos ignorados nas árvores usadas pelo runtime
também bloqueiam a verificação. O relatório registra separadamente a revisão
aprovada e o commit verificado, sem expor caminhos locais.

A raiz operacional vem dos caminhos reais dos módulos carregados do canário,
do runner EVAL-07 e do verificador no código-fonte. O gate registra o HEAD no
carregamento e confere novamente o commit, a identidade da worktree e o
conteúdo dos módulos que ancoram essa verificação. Uma troca de HEAD exige
reiniciar o processo no checkout aprovado. Raiz informada pelo chamador e
diretório corrente não são usados como prova operacional. Os testes com
repositórios sintéticos usam uma entrada exclusiva de ensaio. Seus relatórios
indicam `synthetic_fixture` e mantêm `sourceMatches` falso.

O lockfile em disco e o lock instalado do pnpm precisam corresponder à
revisão. O fingerprint das dependências cobre os arquivos e os destinos dos
links internos da instalação local, além de plataforma, arquitetura e versão
do Node.js. Links para instalações compartilhadas fora do checkout bloqueiam
a verificação. A aprovação vincula o fingerprint da instalação e a
identidade do checkout. Mudança de código, checkout ou dependências exige
revisar a configuração e obter outra assinatura. Atualize `sourceRevision`
após integrar alterações que afetem a execução.

### Aprovação independente e uso único

O envelope de aprovação v1 contém um payload estrito e assinatura Ed25519.
A assinatura cobre o fingerprint canônico do payload, com domínio próprio
para este contrato: `agent-evals/canary-approval/v1`. Assinaturas do domínio
anterior são rejeitadas. O payload vincula o manifesto completo, escopo de um uso,
dataset, cenário, modelo, provedor, verba, revisão e instalação. O manifesto
por sua vez vincula a política de dados, os limites e o destino dos
relatórios. O identificador da autoridade, a identidade do aprovador e o
escopo são confrontados com um registro confiável provisionado separadamente
do envelope. A CLI não emite assinaturas e o registro distribuído está vazio.
Os testes geram pares efêmeros em memória com escopo exclusivamente sintético.

O teto externo é uma evidência assinada separada da verba interna no payload.
O gate verifica origem, provedor, fingerprint, instante, validade e valor. O
teto tem de cobrir a reserva prevista e caber na verba aprovada. Uma futura
evidência precisa vir da conferência da conta pelo operador. Esta etapa não
consulta o provedor. O relatório distingue reserva estimada, consumo
reportado no ensaio, custo contabilizado localmente e cobrança ainda não
verificada.

A disponibilidade de credencial é verificada separadamente da aprovação. O
provedor simulado retorna somente um marcador opaco, sem ler
`OPENROUTER_API_KEY`, arquivos de aprovação ou argumentos. Uma futura
integração precisa provisionar o mecanismo de segredos e a autoridade em
ambiente controlado. Nenhum deles é provisionado nesta entrega.

O registro de uso único exige um diretório local de controle preexistente. A
CLI conhece o caminho fixo
`external-eval-reports/canary-control` relativo a `Backend`. Ela não o cria nem
aceita outro caminho pela linha de comando. O ensaio operacional reserva o
`useId` em disco com criação exclusiva e sincroniza o marcador antes de
prosseguir. Um marcador parcial ou uma tentativa reservada permanece
bloqueante. A autorização nunca é reaberta automaticamente após falha ou
possível envio. A operação futura deve proteger o registro contra remoção,
rollback, substituição e uso de diretórios distintos por operadores.

### Ensaio de operação e riscos residuais

`pnpm exec tsx --test test/external-canary-operations.test.ts` percorre o
gate, o registro e o ChatService usando transporte em memória. Antes de
reservar a autorização, um cancelamento conhecido interrompe a tentativa.
Entre a reserva financeira e o transporte, um cancelamento libera a reserva
local. Depois de possível envio, o custo continua contabilizado de forma
conservadora e a autorização continua consumida. Timeout, divergência de
identidade e limites usam os diagnósticos técnicos existentes sem retry.

A verificação de integridade é uma evidência local de um instante. A futura
ativação exige checkout, dependências e ambiente de processo isolados e
protegidos contra alterações concorrentes, autoridade provisionada por um
administrador e registro persistente sob controle operacional. O preflight e
o ensaio mantêm `networkAllowed`, `experimentAuthorized` e
`experimentExecuted` como falsos.

## Ensaio de integração

O ensaio automatizado usa um manifesto marcado `synthetic_rehearsal`, com
fonte de preço `.invalid`, e respostas HTTP geradas em memória:

```sh
pnpm exec tsx --test test/external-canary.test.ts
```

O teste também exercita `eval:canary --action rehearse` com um manifesto
sintético temporário. Essa entrada usa uma resposta fixa para o cenário
inicial. O ensaio programático permite respostas simuladas para outros
cenários unitários. A cadeia inclui o cliente OpenRouter, o adaptador,
o ChatService, reservas por chamada, observabilidade e o motor de assertions
existentes. Apenas transportes em memória do runner são usados. Uma função de
transporte injetada é código de teste confiável, com a mesma fronteira da
EVAL-07B.1.

O ensaio passa o sinal de cancelamento ao ChatService. Falha técnica encerra
o cenário. O controlador impede novos transportes quando o limite de chamadas,
de tokens ou de custo impedir uma reserva, ou quando o uso ultrapassar a
reserva. Uso ausente conserva a reserva. Divergência de modelo ou de provedor,
inclusive ausência de identidade do provedor neste canário, encerra o
cenário. Esses eventos ficam na execução técnica, com assertions sem
evidência marcadas como não avaliadas.

## Operação e leitura de uma futura execução

1. Isolar conta, ambiente e destino de produção. Confirmar o teto de gasto na
   conta e a política de dados. Usar um mecanismo de segredos fora do
   repositório e dos argumentos da CLI. Manter segredo, cabeçalhos e payloads
   brutos fora de logs e artefatos.
2. Na etapa de ativação autorizada, comparar o fingerprint com o da aprovação,
   confirmar reserva e limites e preparar o cancelamento operacional. Interromper
   por divergência de identidade, falha técnica ou limite preventivo. Manter
   fallback e retries desabilitados, transcrições desativadas por padrão e
   relatórios com gravação exclusiva.
3. Após a execução, verificar conclusão técnica, modelo retornado e provedor
   observado quando informado. Conferir gerações, uso reportado versus
   estimado, custo contabilizado localmente e cobrança do provedor. Identificar
   ferramentas solicitadas e executadas e distinguir erro do provedor de
   não conformidade comportamental.
4. Registrar assertions aprovadas, reprovadas e não avaliadas, falhas críticas
   e critérios humanos pendentes. A amostra é de um cenário e um turno.
   Comparações com outras execuções exigem condições, versões e proveniência
   equivalentes. O baseline EVAL-08 é determinístico e tem outra proveniência.

A retenção e o roteamento efetivos dependem do provedor. O limite local de
custo é preventivo, e o cancelamento não garante que o provedor deixe de
processar uma requisição já recebida. O ensaio em memória valida a integração
e o relatório. Qualidade comercial e prontidão para produção ficam fora da
evidência desta amostra.
