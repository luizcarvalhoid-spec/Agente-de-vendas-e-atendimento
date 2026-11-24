# Readiness operacional do primeiro canário OpenAI

**Decisão em 24/11/2026: NO-GO.** O preflight offline inspecionou a revisão
`e2d29e84f6b7f3b20aedbbf22f8955a0617237f9`. O cenário e o dataset conferem.
O deployment, a revisão operacional do manifesto, a aprovação humana e a
evidência da conta seguem pendentes. Houve zero inferências e cobranças.
[Relatório JSON](canary/openai-readiness.07c2.v1.json)

## Escopo proposto

| Item | Configuração |
| --- | --- |
| Provedor e modelo | OpenAI direto, `gpt-6-luna` |
| Destino | `POST https://api.openai.com/v1/chat/completions` |
| Geração | `reasoning_effort: none`, `stream: false`, `store: false` |
| Dataset e cenário | `universal-core` v1.0.0, `universal.core.incomplete-need.001` |
| Limites | Duas chamadas, 20.000 tokens estimados de entrada e 512 de saída por chamada, 41.024 tokens totais e timeout de 15 s |
| Transporte | Sem redirects, retries ou persistência de transcrições |
| Financeiro | Teto proposto de USD 1,00, margem 1,25 e reserva documental de USD 0,00564 |

O cenário verifica integração técnica com dados fictícios. As [dez jornadas
comerciais sintéticas](../test/openai-direct-commercial.test.ts) constituem
uma referência separada para a futura avaliação do comportamento comercial.
[Manifesto operacional candidato](canary/gpt-6-luna-openai-operational-candidate.v1.json)

## Bloqueios observados

| Pendência | Bloqueios do preflight | Evidência ainda necessária |
| --- | --- | --- |
| Código e deployment | `LIVE_EXECUTION_DISABLED`, `APPROVAL_AUTHORITY_UNCONFIGURED` | Revisão separadamente autorizada com deployment confiável e autoridade pública fixada em código. `configuredDeployment()` continua desabilitado. |
| Infraestrutura e integridade | `DIRTY_WORKTREE`, `DEPENDENCIES_UNVERIFIED`, `ISOLATED_ENVIRONMENT_UNVERIFIED`, `CREDENTIAL_UNAVAILABLE` | Checkout Linux imutável durante a rodada, dependências locais, serviço e registro privados, e credencial protegida do projeto dedicado. |
| Conta OpenAI | `EXTERNAL_HARD_LIMIT_UNVERIFIED`, `PRICE_REVALIDATION_REQUIRED` | Modelo, tier, tarifa aplicável, cobrança disponível, teto externo efetivo e saldo preventivo comprovados pelo operador. |
| Decisão humana | `DATA_RETENTION_APPROVAL_REQUIRED` | Decisão explícita e vigente sobre retenção padrão e escopo fictício. |
| Autorização da rodada | `SOURCE_REVISION_PENDING`, `APPROVAL_REQUIRED` | Revisão definitiva, fingerprints e assinatura Ed25519 de uso único. O registro ficou `not_checked`, pois não havia autorização para consultar. |

Os dois preflights locais retornaram os mesmos bloqueios. O teste ocorreu
no Windows com Node.js `v24.18.0` e uma junction para `node_modules`. O Git
executado com o ambiente saneado do gate apontou 223 arquivos rastreados.
O diff diagnóstico ignorando somente CR no fim da linha ficou vazio. O
checkout tinha `core.autocrlf=true` na configuração usual, que o gate não
carrega. Essa diferença explica `DIRTY_WORKTREE`; o diagnóstico não
substitui a verificação de integridade. Ubuntu WSL2 consta como parado e
o serviço Linux dedicado segue sem provisionamento verificado. O pnpm
`11.25.0` é o pin do backend. O Corepack não tinha essa versão no cache
offline; as regressões usaram os executáveis já instalados.

## 1. Instalar e verificar o ambiente isolado

Checklist para uma **etapa futura**, em VM Linux dedicada ou ambiente
equivalente cuja separação tenha sido revisada. Use o seguinte procedimento
somente depois da autorização para preparar a infraestrutura.

- [ ] Escolher UID Linux dedicado e não root. O UID efetivo deve coincidir
  com aquele fixado no deployment revisado. Manter permissões mínimas e
  separar o serviço do atendimento e dos processos de desenvolvimento.
- [ ] Obter Node.js Linux de versão exata aprovada, compatível com `>=22`,
  e pnpm `11.25.0`. Verificar distribuição, checksum de origem, arquitetura
  e versões efetivas com o mesmo ambiente que iniciará o preflight. Registrar
  `node --version`, `pnpm --version`, `node -p process.platform` e a versão Git.
- [ ] Preparar um clone dedicado, pertencente ao UID do serviço para o Git
  confiar na propriedade. O gate ignora a configuração Git global e de
  sistema. Fixar LF no clone, checkout em SHA completo e manter a montagem
  do clone, `.git` e dependências somente leitura durante a rodada.
- [ ] Instalar no `Backend` usando o lockfile congelado e importação por
  cópia. Verificar que `Backend/node_modules` é um diretório real, que
  links das dependências resolvem internamente e que o lock virtual
  `Backend/node_modules/.pnpm/lock.yaml` corresponde ao `Backend/pnpm-lock.yaml`
  rastreado, conforme o gate. Falhas de layout ou lockfile exigem corrigir
  a instalação e repetir o preflight.
- [ ] Montar o registro persistente `/var/lib/openai-canary/authorizations`
  fora do checkout, com proprietário igual ao UID do serviço, permissão
  `0700`, escrita atômica no volume local e caminho real sem links. Preservar
  marcadores quando o serviço reiniciar. Se o estado for perdido ou houver
  dúvida sobre consumo, invalidar as autorizações afetadas e suspender a rodada.
- [ ] Projetar entrega do segredo via mecanismo protegido do serviço em
  `/run/credentials/openai-canary.service/openai-api-key`. O gate espera
  arquivo regular local pertencente ao UID do serviço, sem permissões para
  grupo ou outros, sem links e com leitura limitada. A chave de inferência
  pertence ao projeto dedicado. Guardar chaves privadas da autoridade em
  mecanismo separado. Manter manifestos completos, envelopes assinados e
  saída de relatórios em diretórios privados fora do checkout.
- [ ] Bloquear egress por padrão. Na rodada futura, permitir ao serviço
  somente o host oficial `api.openai.com` via HTTPS na porta 443, além da
  resolução de nomes necessária e aprovada. O cliente fixa método e caminho
  e rejeita redirect. Desativar captura de corpos, cabeçalhos e depuração de
  tráfego. Logs persistem apenas contagens, estados e códigos sanitizados.

Exemplo de preparação do clone pelo operador com os caminhos e a revisão
já aprovados. A instalação deve ocorrer antes de fechar o egress do serviço
e tornar o checkout somente leitura.

```sh
set -eu
git clone --no-checkout --config core.autocrlf=false --config core.eol=lf \
  https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento.git "$CANARY_CHECKOUT"
git -C "$CANARY_CHECKOUT" checkout --detach "$CANARY_RELEASE_SHA"
test "$(git -C "$CANARY_CHECKOUT" rev-parse --verify 'HEAD^{commit}')" = "$CANARY_RELEASE_SHA"
cd "$CANARY_CHECKOUT/Backend"
test "$(node -p 'process.platform')" = linux
test "$(node --version)" = "$CANARY_NODE_VERSION"
test "$(pnpm --version)" = 11.25.0
pnpm install --frozen-lockfile --package-import-method=copy
test -z "$(git status --porcelain=v1 --untracked-files=all)"
```

O preflight usa os módulos TypeScript do checkout, via `tsx`, como âncoras
do runtime. Execute com o mesmo UID, plataforma, versões e volume da rodada.
`git status` limpo é uma checagem inicial. A verificação do gate também
inspeciona worktree, dependências, lockfile e módulos carregados. Alterações
depois dessa leitura são controladas pelo isolamento e pela montagem.
[Configuração de importação do pnpm](https://pnpm.io/settings#packageimportmethod)

## 2. Revisar o projeto e o orçamento no painel OpenAI

- [ ] Selecionar a organização e um projeto dedicado, sem outro tráfego
  durante a janela. Conferir o ID do projeto em registro privado. Usar o
  mesmo projeto na evidência financeira, na decisão de dados, na autoridade
  de deployment e na credencial.
- [ ] Conferir `gpt-6-luna` em **Project settings → Limits → Model usage**.
  Verificar que o tier efetivo é Standard (`default`). A requisição não
  envia `service_tier`; `auto` herda o ajuste do projeto. Se o tier efetivo
  não puder ser comprovado, adiar a autorização.
- [ ] Conferir cobrança ativa, créditos ou saldo disponível e limites
  aplicáveis da organização. Usar credencial de serviço restrita ao projeto
  e à permissão mínima necessária para Chat Completions, sem funções
  administrativas. Registrar a verificação em local privado da operação.
- [ ] Abrir **Project settings → Limits → Spend**. Conferir limite mensal
  e **Enforce a hard limit** ativo. Registrar hora UTC, vigência, limite
  efetivo e saldo disponível após gasto observado e margens necessárias.
  Uma notificação de gasto não satisfaz o gate. A propagação do enforcement
  pode atrasar, de modo que o limite externo não é uma garantia absoluta.
- [ ] Exigir `reserva ≤ saldo disponível ≤ limite externo ≤ orçamento
  assinado` e orçamento assinado de USD 1,00. A evidência assinada usa
  `enforcement: hard_limit`. Se a configuração do projeto não permitir
  esses valores, manter NO-GO e encaminhar a restrição para revisão.
- [ ] Revalidar as tarifas vigentes na ficha oficial do modelo e conferir
  tier, região e condições de cache e cobrança aplicáveis. Registrar fonte,
  moeda, preços de entrada e saída, instante de observação e janela de
  validade. Preços ou condições diferentes exigem revisar a reserva e, se
  mudar o manifesto, obter novo fingerprint e nova autorização.

As tarifas públicas Standard observadas na preparação foram USD 0,10/M de
entrada e USD 0,50/M de saída. Por chamada a fórmula atual estima
`(20.000 × 0,10 + 512 × 0,50) / 1.000.000 = USD 0,002256`. Para duas chamadas
com margem de 1,25, a reserva é **USD 0,00564**. A reserva, o saldo do
projeto e a cobrança apurada são valores distintos. Os totais locais não
conferem separadamente ajustes de cache, tier ou atraso da plataforma.
[Modelo e preços](https://developers.openai.com/api/docs/models/gpt-6-luna) ·
[Parâmetros Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) ·
[Projetos e permissões](https://help.openai.com/en/articles/9186755-managing-projects-in-the-api-platform) ·
[Limites financeiros](https://developers.openai.com/api/docs/guides/spend-limits)

## 3. Registrar a decisão humana de retenção

**Estado atual: pendente.** O operador consulta a configuração efetiva do
projeto e da organização e leva a decisão à pessoa responsável. O modelo
abaixo é um registro em branco. O registro preenchido é privado e a decisão
só integra a autorização após revisão humana.

| Campo | Preenchimento pelo responsável |
| --- | --- |
| Projeto, manifesto e cenário revisados | Pendente |
| Política efetiva observada e referência restrita da evidência | Pendente |
| Dados aprovados | Confirmar somente dados fictícios e ausência de dados pessoais reais |
| Persistência local | Confirmar transcrições, prompts, respostas e payloads fora dos artefatos persistidos |
| Configuração de requisição | Confirmar `store: false` |
| Retenção do provedor | Reconhecer monitoramento de abuso padrão, documentado em até 30 dias sob as condições aplicáveis |
| ZDR | Para aceitar retenção padrão, registrar que ZDR não está ativo no projeto. Esta etapa não ativou nem presumiu ZDR e o estado efetivo segue sem verificação. |
| Decisão expressa, responsável e janela UTC | Pendente |

O contrato exige decisão afirmativa específica
`standard_abuse_monitoring_explicitly_accepted`, com
`dataScope: approved_fictional_only` e `transcriptPersistence: disabled`.
`store: false` não comprova ZDR. Se a configuração efetiva não corresponder
ao contrato ou não puder ser verificada, manter NO-GO e revisar a política
aplicável antes de aprovar. [Controles de dados da OpenAI](https://developers.openai.com/api/docs/guides/your-data)

## 4. Preparar, emitir e verificar a autorização

1. A revisão técnica futura estabelece o deployment no código revisado,
   com projeto, UID e chave pública de autoridade confiável para
   `openai_direct_once`. Fixe a revisão **depois** dessa revisão técnica.
   A EVAL-07C.2 conserva o deployment desabilitado.
2. Copie o candidato para um local protegido fora do checkout. Preencha
   `sourceRevision` com o SHA completo aprovado do runtime. Revise scope e
   preços no manifesto. Calcule o fingerprint definitivo do manifesto e
   os fingerprints de worktree e dependências apenas no ambiente real
   pretendido. O fingerprint do dataset é independente.
3. Confira as evidências privadas de teto com enforcement, saldo, tarifa
   e decisão de retenção. Cada evidência tem verificação e validade UTC
   próprias. A data de observação da tarifa deve anteceder ou coincidir
   com a revalidação. Cada verificação deve anteceder ou coincidir com a
   emissão e permanecer vigente durante os envios. Evite janelas que
   atravessem a virada mensal sem nova conferência de saldo.
4. A autoridade humana autorizada prepara o payload
   `openAiCanaryApprovalPayloadSchema`, vinculando o projeto, o escopo, o
   manifesto, o dataset e cenário, o orçamento, a revisão, a worktree e
   as dependências. Emite um `useId` novo e único, horários UTC de emissão
   e expiração e as evidências independentes de gasto, retenção e tarifa.
   A assinatura Ed25519 usa somente os bytes de
   `openAiCanaryApprovalSigningBytes` e o domínio
   `agent-evals/openai-direct-canary-approval/v1`. Preserve a chave privada
   no mecanismo da autoridade. Use o envelope assinado somente no ambiente
   revisado. Nenhum exemplo de assinatura operacional é fornecido.
5. No serviço pretendido, execute somente `verifyOpenAiCanary` com o
   manifesto e o envelope protegido. O verificador lê a disponibilidade
   do registro e não consome a autorização. O gate operacional revalida a
   integridade, consome atomicamente o uso e revalida a vigência antes de
   cada envio. Nenhuma etapa deste checklist aciona o caminho de envio.

No checkout de revisão, o preflight do rascunho rastreado é reproduzível
a partir de `Backend`. Ele sempre usa o manifesto versionado e omite a
aprovação de propósito.

```sh
pnpm exec tsx src/scripts/verify-openai-canary.ts --output-dir "$CANARY_REPORT_DIR"
```

No futuro, para levantar os fingerprints após completar a cópia operacional,
use os módulos existentes. O comando abaixo apenas lê o manifesto e
inspeciona o checkout local. Execute na raiz `Backend` como o UID aprovado.
`CANARY_MANIFEST_FILE` aponta para o manifesto protegido, sem segredos.

```sh
node --import tsx --input-type=module - "$CANARY_MANIFEST_FILE" <<'NODE'
import { readFile } from 'node:fs/promises'
import { inspectCanaryRuntimeSource } from './src/evals/external-canary-integrity.ts'
import { fingerprintOpenAiCanaryManifest, openAiCanaryManifestSchema } from './src/evals/openai-canary-contract.ts'
const manifest = openAiCanaryManifestSchema.parse(JSON.parse(await readFile(process.argv[2], 'utf8')))
const source = await inspectCanaryRuntimeSource(manifest.sourceRevision)
if (source.issues.length || !source.worktreeFingerprint || !source.dependenciesFingerprint) {
  console.error(JSON.stringify({ issues: source.issues }))
  process.exit(1)
}
console.log(JSON.stringify({
  sourceRevision: source.runtimeCommit,
  manifestFingerprint: fingerprintOpenAiCanaryManifest(manifest),
  worktreeFingerprint: source.worktreeFingerprint,
  dependenciesFingerprint: source.dependenciesFingerprint,
}))
NODE
```

Após receber o envelope, a verificação final usa o gate OpenAI e suas
âncoras adicionais. O comando abaixo apenas verifica e imprime os campos
sanitizados de readiness. `CANARY_APPROVAL_FILE` aponta para o envelope
em um arquivo protegido. O código de saída 1 representa NO-GO.

```sh
node --import tsx --input-type=module - "$CANARY_MANIFEST_FILE" "$CANARY_APPROVAL_FILE" <<'NODE'
import { readFile } from 'node:fs/promises'
import { verifyOpenAiCanary } from './src/evals/openai-canary-operations.ts'
const [manifest, approval] = await Promise.all(process.argv.slice(2).map(async (path) =>
  JSON.parse(await readFile(path, 'utf8'))))
const result = await verifyOpenAiCanary({ manifest, approval })
console.log(JSON.stringify({ preflight: result.preflight, blockers: result.blockers, checks: result.checks,
  authorization: result.authorization, manifestFingerprint: result.manifestFingerprint, source: result.source }))
if (result.preflight !== 'ready' || result.blockers.length ||
    !result.authorization.authenticated || !result.authorization.current || result.authorization.use !== 'available') {
  process.exitCode = 1
}
NODE
```

## 5. Decidir GO / NO-GO

| Decisão | Critérios objetivos |
| --- | --- |
| **GO técnico** | Preflight `ready`, zero bloqueios, todos os checks positivos, `authorization.authenticated=true`, `authorization.current=true`, `authorization.use=available`, os mesmos SHA e fingerprints aprovados e condições independentes de preço, teto, saldo e política ainda vigentes. |
| **GO de execução** | GO técnico mais autorização humana explícita para iniciar a rodada, operador identificado em registro protegido, janela válida e ambiente de saída e cancelamento supervisionados. A decisão cabe ao operador. |
| **NO-GO** | Qualquer ausência, validade expirada, divergência, mudança de conta/tier/escopo, registro indisponível ou consumido, checkout não íntegro ou evidência inconclusiva. Preservar os códigos sanitizados e suspender a rodada. |

Antes da decisão, registre o saldo e contadores de início no projeto
dedicado, confirme ausência de tráfego concorrente e disponibilidade de
cancelamento. Durante uma rodada futura, interrompa diante de falha
técnica, divergência de modelo, cancelamento, excedente de reserva ou
limite alcançado. Em caso de possível cobrança, preserve a reserva e o
marcador de uso enquanto investiga. Uma rodada seguinte exige nova revisão
e nova autorização de uso único.

## 6. Conferir uso e cobrança após uma rodada autorizada

1. Preserve horário UTC de início e fim, revisão, fingerprint, status
   técnico, número de tentativas, tokens reportados, estimativa local e
   códigos de interrupção. Preserve o marcador de consumo no volume
   persistente. Mantenha prompts, respostas, payloads e segredos fora
   dos registros e artefatos.
2. No painel oficial, abra **Usage** para a organização e o projeto
   dedicados, selecione a mesma janela UTC e confronte as requisições e
   tokens com o relatório. Confira modelo e tier quando os filtros estiverem
   disponíveis. Use **Spend** ou o extrato de custos para confirmar valores,
   respeitando granularidade, cache e eventuais atrasos de agregação.
3. Compare o saldo e o custo apurado com a linha de base registrada, a
   reserva e o teto aprovado. Registre `pendente` se a cobrança ainda não
   se refletir no painel. Se houver tráfego, valor ou tier inexplicados,
   mantenha NO-GO para uma nova rodada até reconciliar com o operador.

[Verificação de uso e custos da API](https://help.openai.com/en/articles/10478918-reviewing-api-usage-and-costs) ·
[Janelas e exportação de uso](https://help.openai.com/en/articles/20001072-exporting-monthly-usage-details-from-the-api-usage-dashboard)

## Evidências desta revisão

Passaram 53 testes focados no SHA do merge do PR #52. Os ensaios existentes
confirmaram bloqueio por falta de deployment, credencial, assinatura,
revisão compatível, decisão de retenção, revalidação de tarifa e teto
externo, além de bloqueio de reutilização. As dez jornadas comerciais
passaram com transporte sintético. A entrega altera somente documentação
e relatório, conforme o escopo da EVAL-07C.2.
