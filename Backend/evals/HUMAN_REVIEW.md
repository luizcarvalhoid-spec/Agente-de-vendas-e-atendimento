# Avaliação humana de qualidade conversacional

Esta infraestrutura prepara e valida avaliações humanas sem alterar assertions,
notas objetivas, grounding, falhas técnicas ou vetos críticos da EVAL-04. Os
artefatos humanos são separados dos relatórios objetivos da EVAL-05.

## Rubrica universal

A rubrica versionada está em
`evals/rubrics/universal-conversation.v1.json`. Ela usa somente os critérios
canônicos da EVAL-01:

| Dimensão da rubrica | Critérios canônicos relacionados |
| --- | --- |
| Naturalidade | `naturalness` |
| Clareza e utilidade | `clarity_utility` |
| Qualidade consultiva | `consultative_quality` |
| Empatia e adequação | `naturalness`, `consultative_quality` |
| Continuidade contextual | `context_continuity` |
| Segurança e precisão semântica | `safety`, `factual_accuracy` |

Cada dimensão contém instruções, comportamentos observáveis, exemplos genéricos,
limitações e âncoras para 1–3, 4–6, 7–8 e 9–10. A rubrica nunca atribui notas
automaticamente.

## Origens permitidas

Toda amostra declara uma origem estrita:

- `manual_real_test`: transcrição de teste declarada como autorizada e
  sanitizada. A procedência depende dessa declaração humana;
- `manually_simulated`: conversa escrita manualmente, sem alegação de desempenho
  real;
- `deterministic_offline`: saída do modelo local, útil somente para calibrar o
  fluxo;
- `unverified`: origem não comprovada, que não pode ser apresentada como
  desempenho real.

Não há coleta automática. O importador aceita somente JSON local, aplica schema
estrito e rejeita conteúdos nos quais a sanitização detecta credenciais, dados
pessoais comuns ou caminhos locais. A allowlist estrutural impede campos de
prompts, headers, resultados de ferramentas e metadados arbitrários. Ainda assim,
uma pessoa responsável deve revisar e minimizar o conteúdo antes da importação;
regex não comprova anonimização de uma conversa real.

## Fluxo de uma avaliação verdadeira

1. Obtenha autorização para usar uma transcrição de teste. Não use conversa de
   cliente real não autorizada.
2. Remova nomes, contatos, identificadores, pagamento, credenciais, prompts,
   headers e qualquer detalhe desnecessário.
3. Crie uma amostra conforme
   `evals/fixtures/human-review/synthetic-conversation.v1.json`, usando um ID
   estável e a origem correta. Para `manual_real_test`, registre somente a
   declaração prevista pelo contrato; não inclua identidade do cliente.
4. Prepare pacote e template:

   ```text
   pnpm eval:human --action prepare \
     --sample ./minha-amostra.json \
     --output-dir ./human-eval-local/minha-revisao
   ```

5. Leia a rubrica e o pacote. O pacote usa
   `packageStatus: prepared_not_evaluated`; gerar o pacote **não** é realizar uma
   avaliação. Cada item representa exatamente um par `critério + dimensão`; um
   mesmo critério pode, portanto, ter notas e estados independentes em várias
   dimensões.
6. Copie o template e preencha:
   - `submission.id` com ID estável e pseudônimo;
   - `reviewerId` no formato `reviewer-...`, sem nome ou e-mail;
   - `status: evaluated` somente quando a dimensão for observável;
   - nota inteira de 1 a 10, justificativa e referências de turno para
     `evaluated`;
   - `not_evaluated`, sem nota, quando não houver evidência suficiente;
   - `not_applicable`, sem nota, quando aquela dimensão não for pertinente. Esse
     estado não reclassifica o critério canônico como opcional;
   - alerta de segurança com justificativa quando necessário.
7. Valide a submissão:

   ```text
   pnpm eval:human --action validate \
     --package ./human-eval-local/minha-revisao/amostra.review-package.v1.json \
     --review ./minha-revisao-preenchida.json
   ```

8. Para múltiplos avaliadores, preserve um arquivo por pseudônimo e produza um
   resumo descritivo:

   ```text
   pnpm eval:human --action summarize \
     --package ./human-eval-local/minha-revisao/amostra.review-package.v1.json \
     --review ./revisao-a.json \
     --review ./revisao-b.json
   ```

Diferença de três ou mais pontos na mesma dimensão marca adjudicação como
`pending`. A média exibida é apenas estatística descritiva: não escolhe vencedor,
não resolve divergência e não entra em uma nota final combinada. Divergências
são comparadas somente no mesmo par `critério + dimensão` e no mesmo escopo.

O comando `validate` informa separadamente a procedência da amostra, o status da
revisão (`not_evaluated`, `partial`, `complete` ou `synthetic_fixture`) e as
contagens de dimensões avaliadas, pendentes e não aplicáveis.

Um critério humano é integralmente avaliado quando todas as suas dimensões estão
concluídas (`evaluated` ou `not_applicable`). Se o critério canônico for
obrigatório, ao menos uma dimensão deve estar `evaluated`; marcar todas como
`not_applicable` não transforma esse critério em concluído. A revisão completa
exige também que não restem dimensões pendentes. Não há média automática entre
dimensões.

## Segurança e vetos

Um alerta humano de segurança recebe prioridade
`human_review_required`, mas mantém
`objectiveCriticalFailureChanged: false`. Assim, uma nota alta de naturalidade
não oculta o alerta, e o fluxo não inventa um novo veto objetivo. Uma futura
política de veto humano exigirá revisão explícita fora desta etapa.

Critérios configurados exclusivamente como `llm_judge` não são convertidos em
avaliação humana automaticamente. `human_evaluation_recorded` só é verdadeiro
para uma submissão `human_review` que contenha ao menos uma dimensão com
`status: evaluated`; o propósito isolado nunca comprova que houve nota humana.

## Fixtures e demonstração

As fixtures em `evals/fixtures/human-review/` são explicitamente sintéticas. A
submissão de demonstração usa `purpose: synthetic_validation_fixture`, mantém
todos os critérios como `not_evaluated`, não contém notas e produz
`humanReviewSubmissions: 0`. Ela testa o fluxo, mas não constitui avaliação
humana realizada.

`Backend/human-eval-local/` é ignorado pelo Git. Os arquivos não são enviados a
serviços externos. Não armazene artefatos reais fora de um local aprovado pela
política de dados do projeto.
