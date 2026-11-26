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

**Atualizado em:** 26/11/2026.

**Referência auditada:** `main` no commit `e83b69c`, que integra a correção de identidade do [PR #60](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/60).

A caixa de uma fase na visão geral só muda para `[x]` quando todos os seus critérios de aceite estiverem comprovados.

| Fase | Implementação confirmada | Aceite ainda necessário | Estado do checklist |
| --- | --- | --- | --- |
| **05 — Agente** | **5.1–5.5 implementadas e mescladas.** Tool calling confirmado em 26/11/2026 em uma recomendação com GPT-6 Luna via OpenRouter (Azure) no terminal. [Registro da R4](../Backend/evals/OPENROUTER_COMMERCIAL_EXPERIMENT.md#resultado-da-r4-em-26112026) | Validar o fluxo operacional pela rota HTTP `POST /api/chat` e ampliar a avaliação comportamental com o modelo real. | **Aberta — aceite real parcial** |
| **06 — Jornada comercial** | **6.1–6.4 implementadas** ([#24](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/24)–[#27](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/27)). **6.5 aprovada offline** ([#28](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/28)), com polimento posterior ([#29](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/29)). | Inspecionar a jornada desktop/mobile em navegador real, validar a integração do chat com o provedor e registrar o vídeo local. | **Aberta — aceite manual pendente** |
| **07 — Vendas consultivas** | Há entregas **parciais** de filtro/ranking, comparações e humanização segura; cotação contextual [#34](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/34) e respostas humanizadas [#35](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/35). | Completar critérios 7.1–7.4; especialmente comparação estruturada prevista, uso do contexto do carrinho no backend e testes adversariais. | **Aberta — execução parcial** |
| **08 — Observabilidade/evals** | EVAL-01 a EVAL-08 mescladas, com oito cenários iniciais, executor offline, assertions e pontuação, relatórios, rubrica humana, preparação de execução externa e baselines. A R4 é o primeiro teste comercial real aprovado. [Entregas e evidências](./08-observabilidade-evals.md#auditoria-de-progresso-26112026) | Ampliar o dataset para cerca de 30 cenários, registrar avaliações reais e revisões humanas, concluir telemetria, painel e evidências de portfólio. | **Aberta — cobertura e observabilidade pendentes** |

O M1 (01–06) tem jornada implementada, validação offline e um aceite comercial real no terminal. O aceite da jornada em navegador continua aberto. O M2 (07–08) segue em execução parcial. O M3 (09–10) permanece futuro.

### Próximas tarefas objetivas

- [ ] **05 — Aceite operacional.** Validar a rota HTTP com o modelo configurado e ampliar os cenários reais em ambiente controlado, mediante autorização explícita de custo.
- [ ] **06 — Aceite manual:** inspecionar a jornada desktop e mobile em navegador real, inclusive teclado/responsividade, e registrar o vídeo previsto em [6.5](./06.5-mvp-validation.md).
- [ ] **07 — Completar diferenciais:** fechar itens ainda abertos no [backlog 07](./07-diferenciais-vendas.md), sem presumir que humanização equivale à fase inteira.
- [ ] **08.4 — Cobertura de avaliação.** Ampliar os oito cenários iniciais com o contrato e o executor existentes, e registrar resultados de execuções reais opt-in e da revisão humana.
- [ ] **08 — Observabilidade:** concluir telemetria e painel de demonstração sem exposição de dados pessoais ou credenciais.

Os PRs registram as implementações mescladas. O registro da R4 documenta a execução real de um cenário comercial em terminal. As fases 05–08 detalham os demais critérios de aceite.

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
├─ Backend/           # API, agente e avaliações
├─ agente/            # índice e documentação técnica especializada do agente
├─ docs/              # estes documentos
├─ .gitignore         # existente; revisar
└─ README.md          # a criar na fase 10
```

O backend tem `pnpm test` e `pnpm build`. Os comandos de avaliação estão no
[guia de evals](../Backend/evals/README.md). No frontend, o `package.json`
oferece `dev`, `build`, `lint` e `preview`.
