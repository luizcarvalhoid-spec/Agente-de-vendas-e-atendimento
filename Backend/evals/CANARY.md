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
