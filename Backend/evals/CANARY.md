# Preparação do primeiro canário externo

O candidato inicial está em [first-external-candidate.v1.json](canary/first-external-candidate.v1.json).
Ele seleciona `universal.core.incomplete-need.001` no dataset `universal-core`.
É uma amostra funcional de um turno para verificar a cadeia de execução e uma
pergunta de esclarecimento. Modelo, provedor e configuração financeira aguardam
decisão humana.

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
