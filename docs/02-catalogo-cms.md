# 02 — Catálogo único e CMS leve

**Objetivo:** substituir o array fixo da vitrine por dados estruturados que sirvam à UI e ao agente.  
**Depende de:** fase 01. **Decisão:** **CMS baseado em arquivos versionados**, sem painel de login. Arquivos editáveis no Git + validação + endpoints constituem o gerenciamento de conteúdo suficiente para este portfólio.

## 2.1 — Modelar produtos e taxonomia

- [x] Definir esquema validado para `id`, `slug`, `name`, `category`, `subcategory`, `description`, `shortDescription`, `price`, `originalPrice?`, `image`, `images?`, `stock`, `tags`, `indications`, `hairTypes`, `scalpTypes`, `concerns`, `benefits`, `ingredients`, `usage`, `restrictions`, `warnings`, `contraindications`, `rating?` e `reviews?`.
- [x] Definir categorias e vocabulário consistentes (ex.: shampoos, condicionadores, máscaras e finalizadores); usar identificadores estáveis.
- [x] Documentar quais atributos são **filtros determinísticos** (restrições, preço e estoque) e quais são usados para ranquear pertinência.
- [x] Validar `price >= 0`, slug único, imagem existente e texto não vazio; preços exibidos sempre formatados em BRL.

**Aceite:** esquema invalida registros ruins com erros claros; não há IDs ou slugs duplicados.  
**Commit:** `feat(catalog): define validated product schema`.

### Registro da entrega 2.1 — 06/11/2026

**Status:** concluída; schema, taxonomia, validação de catálogo, testes e build aprovados, sem migrar produtos ou imagens.

**Modelo e taxonomia**

- O tipo `Product` é inferido do schema Zod do backend e mantém os dados necessários à futura página de detalhes: identidade, descrições, categoria, subcategoria, preço, estoque, imagem principal, galeria, uso e informações consultivas.
- IDs são inteiros positivos e imutáveis. Slugs, tags e IDs de ingredientes são normalizados em lowercase kebab-case.
- Categorias controladas: `shampoos`, `condicionadores`, `mascaras` e `finalizadores`, com combinações de subcategoria validadas por categoria.
- `hairTypes` representa tipos de fios; `scalpTypes` contém apenas perfis de couro cabeludo; `concerns` registra necessidades cosméticas como caspa, descamação, oleosidade e ressecamento, sem classificá-las como diagnóstico médico.
- Ingredientes usam objetos `{ id, name }`. O ID normalizado permite que uma incompatibilidade declarada no futuro seja comparada por igualdade, sem busca textual livre.
- `tags`, `indications`, `hairTypes`, `scalpTypes`, `concerns`, `benefits` e `ingredients` são obrigatórios e não vazios. `restrictions`, `warnings` e `contraindications` são obrigatórios, mas podem ser listas vazias após revisão explícita. Lista vazia significa somente que nenhum código estruturado foi registrado; não comprova ausência de risco ou contraindicação.
- Duplicatas são comparadas após normalizar caixa, acentos e espaços. `todos` não pode coexistir com tipos específicos.
- `rating` e `reviews` devem ser omitidos ou informados juntos; zero reviews exige rating zero, e reviews positivas exigem rating maior que zero.

**Semântica de compatibilidade e seleção**

- **Eliminatórios determinísticos:** ID/slug solicitado, categoria ou subcategoria escolhida, faixa de preço, estoque quando disponibilidade for exigida, códigos de restrição declarados e interseção entre IDs de ingredientes e incompatibilidades informadas pelo usuário.
- **Sinais de preferência:** correspondências de `hairTypes`, `scalpTypes` e `concerns` aumentam a pertinência, mas a ausência de correspondência não elimina sozinha um produto. No catálogo demonstrativo, esses perfis são posicionamentos comerciais fictícios e não compatibilidades de segurança avaliadas.
- **Ranqueamento textual:** nome, descrições, tags, indicações, benefícios e ingredientes ajudam a ordenar opções. Rating e reviews servem apenas como desempate secundário.
- `warnings` e `contraindications` preservam explicações para exibição e para o agente, mas não geram exclusão por busca textual. Toda exclusão automática precisa de código controlado ou ID de ingrediente.
- Uma restrição não pode contradizer uma compatibilidade declarada no mesmo produto.

**Preços e imagens**

- Preços são números em reais, finitos, não negativos e com no máximo duas casas decimais. `originalPrice`, quando presente, deve ser maior que `price`.
- Desconto e parcelamento permanecem derivados e não fazem parte do modelo canônico. A apresentação usa `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`.
- Imagens usam caminhos relativos JPG, PNG ou WebP. Caminhos absolutos, URLs, backslashes, travessia de diretório e extensões não permitidas são rejeitados.
- O validador recebe uma raiz explícita, resolve a raiz e cada arquivo com `realpath`, confirma que o destino é um arquivo e rejeita escapes da raiz inclusive por links simbólicos ou junctions.
- A tarefa 2.2 deverá criar o diretório de conteúdo e migrar as imagens; nenhum arquivo visual foi movido nesta entrega.

**Comandos e resultados**

| Comando | Resultado |
| --- | --- |
| `corepack pnpm@11.25.0 install --frozen-lockfile` | Sucesso; dependências e lockfile inalterados. |
| `npm test` | Sucesso; 62/62 testes passaram, preservando os 22 anteriores e adicionando 40 casos de catálogo. |
| `npm run build` | Sucesso; TypeScript compilou o backend. |

O teste de link simbólico recebeu `EPERM` dentro do sandbox antes de executar a asserção. A suíte foi repetida fora desse isolamento, usando somente diretórios temporários, e o caso de escape por junction passou.

**Pendências deliberadas**

- Não foram criados catálogo JSON, produtos, imagens, endpoints, página de detalhes ou integração com o frontend.
- A raiz definitiva de conteúdo e os registros reais serão criados na tarefa 2.2 usando o validador desta entrega.
- Não foi criado novo ADR: o CMS em arquivos e o backend modular já estão cobertos pelo planejamento da fase 02 e pelo ADR-001.

## 2.2 — Popular o catálogo fictício

- [x] Migrar os 8 shampoos existentes para o catálogo canônico preservando os IDs 1–8 e as imagens equivalentes.
- [x] Cadastrar exatamente **27 produtos**: 14 shampoos (incluindo um kit), 5 sabonetes, 4 óleos corporais e 4 condicionadores.
- [x] Manter **6 opções anticaspa** comercialmente distinguíveis, sem inferir eficácia terapêutica ou diferenças de formulação.
- [x] Para cada produto publicável, preencher descrição, indicações, ingredientes sintéticos revisados, restrições, avisos, contraindicações e modo de uso demonstrativo.
- [x] Revisar produtos que competem entre si: diferenças precisam permitir boas perguntas e comparações.
- [x] Identificar explicitamente o catálogo, preços, estoques e perfis comerciais como **dados de demonstração**.

**Aceite:** 27 produtos aprovados pelo schema de publicação, distribuição 14/5/4/4, seis alternativas anticaspa distinguíveis, IDs históricos preservados, imagens únicas e acessíveis, formulações identificadas como dados sintéticos e segurança explicitamente não avaliada.
**Commit:** `data(catalog): seed fictional cosmetic products`.

### Registro da entrega 2.2 — 07/11/2026

**Status:** concluída e validada; o catálogo canônico demonstrativo contém 27 produtos e não antecipa endpoints nem integração com o frontend.

- [x] Schema evoluído para produtos capilares, corporais, individuais e kits.
- [x] Categorias `sabonetes` e `oleos-corporais`, conteúdo líquido/peso, variante comercial, forma de sabonete e metadados de demonstração modelados.
- [x] 27 imagens copiadas para o CMS com nomes canônicos, hashes SHA-256 preservados e manifesto de correspondência por ID.
- [x] Inventário comercial demonstrativo criado com 27 identidades, preços, estoques, descrições e perfis; avaliações foram omitidas.
- [x] Validação confirma contagens 14/5/4/4, seis anticaspa, um kit, IDs 1–8 preservados, imagens únicas e separação entre campos capilares e corporais.
- [x] O schema de publicação rejeita o inventário comercial enquanto ingredientes, uso e informações de segurança não estiverem classificados para demonstração.
- [x] Responsável revisou o material editorial local e autorizou o uso das propostas exclusivamente como dados sintéticos de teste.
- [x] `products.json` canônico criado e os 27 produtos validados com `productCatalogSchema` e verificação física das imagens.

**Classificação e segurança dos dados**

- `dataClassification` é estrito: dados comerciais são `fictional-demo`, compatibilidade é `commercial-positioning`, formulação publicável é `synthetic-test-data` e segurança é `not-evaluated`.
- O inventário intermediário `commercial-products.json` usa `formulation: not-provided`, não contém formulações e não passa pelo schema de publicação.
- Ingredientes do catálogo canônico são dados sintéticos para exercitar a aplicação e não representam as fórmulas fotografadas. Eles não autorizam recomendações reais sobre alergias, compatibilidade ou segurança dermatológica.
- Modos de uso são gerais e conservadores, sem frequência ou tempo de contato dependentes de formulação. Listas vazias de restrições e contraindicações significam somente que nenhuma informação específica foi registrada; não comprovam ausência de risco.
- O kit ID 7 continua sendo um único produto comercial. Shampoo e condicionador possuem formulações sintéticas, modos de uso e avisos independentes; o produto não possui lista agregada de ingredientes.
- O arquivo local `editorial-review.local.md` permanece fora do dataset publicável e é ignorado pelo Git.

**Comandos e resultados**

| Comando | Resultado |
| --- | --- |
| `corepack pnpm@11.25.0 install --frozen-lockfile` | Sucesso durante a preparação do worktree; lockfile inalterado. |
| `npm test` | Sucesso fora do sandbox do Windows; 85/85 testes passaram, preservando os 73 anteriores. |
| `npm run build` | Sucesso; TypeScript compilou o backend. |
| `git diff --check` | Sucesso; nenhuma inconsistência de whitespace. |

O teste de escape de imagem por junction recebeu `EPERM` dentro do sandbox e passou quando a suíte foi repetida fora dele. Não houve alteração no frontend, nos endpoints, nas imagens de origem ou no stash existente. Não foi criado ADR: a classificação editorial complementa o schema do catálogo sem alterar a arquitetura modular monolítica aprovada.

**Dependências futuras:** a tarefa 2.3 deverá expor produtos e imagens do mesmo catálogo canônico. Na tarefa 3.2, a categoria "Todos" deverá apresentar os 27 produtos, com filtros 14/5/4/4, busca e subcategorias funcionais, sem manter um segundo array fixo no React e sem botão visual sem função real.

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
