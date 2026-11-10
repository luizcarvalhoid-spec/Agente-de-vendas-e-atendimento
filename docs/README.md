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

## Acompanhamento da fase atual

**Atualizado em:** 10/11/2026.

**Referência atual:** branch `main`, commit
`8ff4a2152297618850be581a9ce0a8ad59e63939`. A referência histórica do
diagnóstico inicial permanece registrada no início deste documento.

- **Fase atual:** 05 — Agente com OpenRouter e ferramentas.
- [x] **5.1** — Implementada e mesclada no PR #17.
- [x] **5.2** — Implementada e mesclada no PR #18.
- [x] **5.3** — Implementada e mesclada no PR #19.
- [x] **5.4** — Implementada e mesclada no PR #21.
- [x] **5.5** — Implementada e validada offline; aguarda revisão e merge.
- [ ] **Smoke real com OpenRouter** — pendente.
- [ ] **Tool calling real com o modelo configurado** — pendente.

A fase 05 permanece aberta: 5.1 a 5.4 foram revisadas e mescladas; a 5.5 está
implementada nesta branch e aguarda revisão. A validação manual com OpenRouter
real e a compatibilidade operacional de tool calling ainda não foram
comprovadas.

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
├─ docs/              # estes documentos
├─ .gitignore         # existente; revisar
└─ README.md          # a criar na fase 10
```

Os comandos exatos de backend serão definidos na fase 01. No frontend, o `package.json` atual já tem `dev`, `build`, `lint`, `preview`.
