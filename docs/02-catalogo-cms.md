# 02 — Catálogo único e CMS leve

**Objetivo:** substituir o array fixo da vitrine por dados estruturados que sirvam à UI e ao agente.  
**Depende de:** fase 01. **Decisão:** **CMS baseado em arquivos versionados**, sem painel de login. Arquivos editáveis no Git + validação + endpoints constituem o gerenciamento de conteúdo suficiente para este portfólio.

## 2.1 — Modelar produtos e taxonomia

- [ ] Definir esquema validado para `id`, `slug`, `name`, `category`, `subcategory`, `description`, `shortDescription`, `price`, `originalPrice?`, `image`, `images?`, `stock`, `tags`, `indications`, `hairTypes`, `scalpTypes`, `benefits`, `ingredients`, `usage`, `warnings`, `contraindications`, `rating?` e `reviews?`.
- [ ] Definir categorias e vocabulário consistentes (ex.: shampoos, condicionadores, máscaras e finalizadores); usar identificadores estáveis.
- [ ] Documentar quais atributos são **filtros determinísticos** (restrições, preço e estoque) e quais são usados para ranquear pertinência.
- [ ] Validar `price >= 0`, slug único, imagem existente e texto não vazio; preços exibidos sempre formatados em BRL.

**Aceite:** esquema invalida registros ruins com erros claros; não há IDs ou slugs duplicados.  
**Commit:** `feat(catalog): define validated product schema`.

## 2.2 — Popular o catálogo fictício

- [ ] Migrar os 8 shampoos existentes preservando imagens e identidade visual sempre que possível.
- [ ] Expandir gradualmente para aproximadamente **20–24 produtos**, incluindo **3–4 opções de anticaspa com perfis distintos** e alternativas nas demais categorias.
- [ ] Para cada produto, preencher descrição longa, indicações, ingredientes fictícios coerentes, restrições e modo de uso; evitar alegações médicas não verificadas.
- [ ] Revisar produtos que competem entre si: diferenças precisam permitir boas perguntas e comparações.
- [ ] Identificar explicitamente o catálogo e as avaliações como **dados de demonstração**.

**Aceite:** pelo menos 20 produtos válidos em categorias distintas, sem produtos indistinguíveis e com imagens acessíveis.  
**Commit:** `data(catalog): seed fictional cosmetic products`.

## 2.3 — Endpoints de catálogo

- [ ] Implementar `GET /api/products` com busca, categoria, faixa de preço e paginação simples.
- [ ] Implementar `GET /api/products/:slug` (404 para produto inexistente).
- [ ] Criar busca interna do backend por `id` para uso das ferramentas do agente; não enviar todo o catálogo ao LLM a cada mensagem.
- [ ] Garantir que preço, estoque, imagem e slug retornem do mesmo dataset utilizado na busca do agente.
- [ ] Testar filtros combinados, resultados vazios e parâmetros inválidos.

**Aceite:** API retorna dados filtrados e detalhes estáveis; testes automatizados cobrem filtros e 404.  
**Commit:** `feat(api): expose product catalog`.

## 2.4 — Fluxo editorial mínimo (CMS leve)

- [ ] Documentar passo a passo para criar/editar um produto: editar JSON, validar, testar e revisar no Git.
- [ ] Criar comando `validate:catalog` ou equivalente para validar o conteúdo antes de publicar.
- [ ] Explicar que **não há painel administrativo**: mudanças são feitas via arquivos versionados (Git-based content).
- [ ] Garantir que conteúdo comercial falso não seja apresentado como produto real.

**Aceite:** uma pessoa consegue incluir um produto novo por arquivo e ele aparece na API após executar o projeto, sem editar componentes de UI.  
**Commit:** `docs(catalog): document content workflow`.

## Fora de escopo

CMS headless externo, autenticação administrativa, upload de imagens pelo navegador, controle de estoque real, integrações ERP/PIM e banco vetorial. Uma migração para SQLite pode virar sub-backlog futuro se surgir necessidade real — não é pré-requisito.
