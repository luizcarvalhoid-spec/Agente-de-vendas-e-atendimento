# HidraSplash IA — Roadmap e backlogs do projeto

> **Projeto:** [Agente-de-vendas-e-atendimento](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento)  
> **Objetivo:** portfólio de agente de vendas consultivas e atendimento para e-commerce fictício de cosméticos.  
> **Referência de análise:** branch `main`, commit inicial `066a6bdd`, consultado em 06/11/2026.  
> **Frontend existente:** React 18, TypeScript, Vite 5 e Tailwind CSS 3.

## Como usar esta documentação

Esta pasta funciona como **plano de execução + fonte de backlogs**. Cada documento numerado é uma *fase*; cada seção `N.M` é um **backlog independente**, delegável ao Codex como uma tarefa delimitada. As caixas `[ ]` são marcadas manualmente depois da validação. Não marque tarefas como concluídas apenas porque o código foi gerado.

1. Leia [00 — Estado atual](./00-estado-atual.md), depois siga a ordem da tabela.
2. Abra o documento da fase e selecione **uma seção N.M** (ex.: `3.2`).
3. Peça ao Codex para ler `docs/README.md`, o arquivo da fase e somente implementar aquela seção, respeitando critérios de aceite e limites de escopo.
4. Revise o diff, execute os testes indicados, teste manualmente e só então marque os checkboxes.
5. Faça um commit com escopo claro. Atualize a tabela abaixo ao concluir a fase.

Os recursos especializados já implementados do agente estão reunidos no
[índice técnico `agente/`](../agente/README.md); os documentos numerados desta
pasta continuam sendo o roadmap geral.

**Prompt reutilizável para o Codex:**

```text
Leia docs/README.md, docs/00-estado-atual.md e docs/03-paginas-da-loja.md.
Implemente SOMENTE o backlog 3.2. Antes de alterar arquivos, examine o código
existente e descreva rapidamente seu plano. Preserve React + Vite + TypeScript
+ Tailwind e a identidade visual HidraSplash. Não adicione autenticação,
frameworks de agente ou infraestrutura fora do escopo. Ao terminar, informe:
arquivos alterados, testes executados, pendências e quais checkboxes podem ser
marcados mediante minha validação. Não faça commit nem push automaticamente.
```

## Visão geral do progresso

Marque a fase apenas quando **todos os critérios de aceite** de seus backlogs forem cumpridos.

- [x] **00. Diagnóstico do ponto de partida** — interface existente e repositório público identificados.
- [x] **01. Fundação técnica e contratos** — [Abrir](./01-fundacao-tecnica.md)
- [x] **02. Catálogo e CMS leve** — [Abrir](./02-catalogo-cms.md)
- [x] **03. Navegação e páginas de produto** — [Abrir](./03-paginas-da-loja.md)
- [x] **04. FAQ fictícia e RAG** — [Abrir](./04-faq-rag.md)
- [ ] **05. Agente com OpenRouter e ferramentas** — [Abrir](./05-agente-openrouter.md)
- [ ] **06. Chat comercial, carrinho e checkout demo** — [Abrir](./06-chat-carrinho-checkout.md)
- [ ] **07. Diferenciais de vendas consultivas** — [Abrir](./07-diferenciais-vendas.md)
- [ ] **08. Observabilidade e avaliações (evals)** — [Abrir](./08-observabilidade-evals.md)
- [ ] **09. Qualidade, segurança e demonstração online** — [Abrir](./09-qualidade-deploy.md)
- [ ] **10. Apresentação no GitHub e LinkedIn** — [Abrir](./10-publicacao.md)

**Marco M1 (MVP demonstrável):** fases 01–06.  
**Marco M2 (portfólio diferenciado):** fases 07–08.  
**Marco M3 (publicação):** fases 09–10.

## Acompanhamento da execução

**Atualizado em:** 12/11/2026.  
**Referência auditada:** `main` após o merge do [PR #35](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/35), commit `9af5c7ae790446e27584894388251b75be6b8933`. O diagnóstico inicial de 06/11/2026 é histórico.

**Critério de marcação:** a caixa de uma fase na visão geral só muda para `[x]` quando **todos os seus critérios de aceite** estiverem comprovados. Entrega de código, teste offline, smoke real e validação visual são evidências diferentes.

| Fase | Implementação confirmada | Aceite ainda necessário | Estado do checklist |
| --- | --- | --- | --- |
| **05 — Agente** | **5.1–5.5 implementadas e mescladas** ([#17](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/17), [#18](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/18), [#19](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/19), [#21](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/21), [#22](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/22)). Smoke preparado e corrigido em PRs posteriores. | Smoke com OpenRouter real e compatibilidade de tool calling do modelo configurado; registro do resultado. | **Aberta — validação operacional pendente** |
| **06 — Jornada comercial** | **6.1–6.4 implementadas** ([#24](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/24)–[#27](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/27)); **6.5 aprovada offline** ([#28](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/28)); polimento visual técnico [#29](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/29). | Inspeção desktop/mobile em navegador real e vídeo local verificado; OpenRouter real continua pendente pela fase 05. | **Aberta — aceite manual pendente** |
| **07 — Vendas consultivas** | Há entregas **parciais** de filtro/ranking, comparações e humanização segura; cotação contextual [#34](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/34) e respostas humanizadas [#35](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/35). | Completar critérios 7.1–7.4; especialmente comparação estruturada prevista, uso do contexto do carrinho no backend e testes adversariais. | **Aberta — execução parcial** |
| **08 — Observabilidade/evals** | Testes determinísticos e cenários offline já existem, incluindo 12 casos de MVP [#28](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/28) e 15 jornadas de humanização [#35](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/35). Os conjuntos têm objetivos diferentes e **não equivalem** a 27 evals independentes com LLM. | Consolidar dataset de aproximadamente 30 cenários, executor e rubrica; executar e registrar avaliações reais opt-in; ampliar telemetria, painel e evidências. | **Aberta — base offline parcial** |

**Marcos:** M1 (01–06) tem a **jornada implementada e validada offline**, mas **não está integralmente aceito**; M2 (07–08) está em execução parcial; M3 (09–10) permanece futuro.

### Próximas tarefas objetivas

- [ ] **05 — Aceite real:** executar somente com autorização explícita de custo o smoke controlado e confirmar tool calling do modelo escolhido; registrar modelo, data, resultado e limites, sem segredos.
- [ ] **06 — Aceite manual:** inspecionar a jornada desktop e mobile em navegador real, inclusive teclado/responsividade, e registrar o vídeo previsto em [6.5](./06.5-mvp-validation.md).
- [ ] **07 — Completar diferenciais:** fechar itens ainda abertos no [backlog 07](./07-diferenciais-vendas.md), sem presumir que humanização equivale à fase inteira.
- [ ] **08.4 — Próxima frente de avaliação:** versionar cenários com `id`, `input`, condições iniciais e critérios objetivos de comportamento; projetar um executor semiautomatizado (por exemplo, `eval.py` com notas de 1 a 10) **ainda não implementado**, com rubrica explícita, medidas reproduzíveis e distinção entre teste offline e teste real pago.
- [ ] **08 — Observabilidade:** concluir telemetria e painel de demonstração sem exposição de dados pessoais ou credenciais.

Os PRs são evidência de **implementação mesclada**, não de inspeção visual nem de conformidade de um LLM real. Mais detalhes estão nos documentos das fases 05–08.

## Dependências (caminho crítico)

`01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10`

Essa sequência reduz retrabalho; algumas tarefas de documentação e UI podem ser feitas em paralelo, mas **o catálogo é a fonte única de verdade** para vitrine, páginas, ferramentas e cartões de recomendação.

## Decisões de escopo

- **Manter:** `Frontend/` com React + Vite + TypeScript + Tailwind.
- **Adicionar:** `Backend/` com Node.js + TypeScript + Fastify + Zod e integração OpenRouter exclusivamente no servidor.
- **CMS leve:** conteúdo versionado em JSON/Markdown, editável no código, validado e servido pela API. **Não é um painel administrativo**; atenderá a demonstração sem login.
- **RAG:** busca textual em FAQ Markdown + trechos recuperados para o modelo. Sem vetor, embeddings externos ou LangChain no MVP.
- **Persistência:** catálogo/FAQ versionados; carrinho e sessão de chat no navegador. Observabilidade pode começar sem banco persistente.
- **Sem:** autenticação, multi-tenant, pagamentos reais, pedidos reais, envio por transportadora, CRM, scraping, microserviços ou múltiplos agentes.
- **Cenário fictício:** marcas, pedidos, preços, depoimentos e políticas claramente sinalizados como demonstração. Não afirmar eficácia clínica sem fundamento.

## Convenção para novos backlogs (1.1, 3.1, 3.2...)

- **Subseção prevista:** escreva `## 3.1 — Nome do backlog` dentro de `03-paginas-da-loja.md`.
- **Trabalho extra descoberto:** adicione `## 3.5 — Nome` no mesmo arquivo ou crie `docs/03.5-nome-do-extra.md` e acrescente um link na fase 03, sem renumerar seções antigas.
- **Mudança grande:** use o [template de sub-backlog](./TEMPLATE-SUBBACKLOG.md) e registre **motivo, dependências, impacto no cronograma e critérios de aceite**.
- **Rastreabilidade GitHub:** uma subseção `N.M` = uma issue ou PR, com prefixo `[N.M]` no título. Exemplos: `[02.3] Endpoint de listagem`, `[05.2] Entrevista consultiva`.
- **Status:** `[ ]` pendente; `[x]` validado. Bloqueios e decisões ficam anotados abaixo da subseção.

## Definição global de pronto (Definition of Done)

Uma seção só termina quando: funcionalidade observável funciona, dados são reais **dentro do catálogo fictício** e não inventados pelo modelo, erros são tratados, lint/build/testes relevantes passam, UI é usável em mobile e desktop quando pertinente, documentação ou contratos afetados são atualizados, e não houve exposição de chave ou dados privados.

## Comandos e estrutura

```text
Agente-de-vendas-e-atendimento/
├─ Frontend/          # existente
├─ Backend/           # a criar na fase 01
├─ agente/            # índice e documentação técnica especializada do agente
├─ docs/              # estes documentos
├─ .gitignore         # existente; revisar
└─ README.md          # a criar na fase 10
```

Os comandos exatos de backend serão definidos na fase 01. No frontend, o `package.json` atual já tem `dev`, `build`, `lint`, `preview`.
