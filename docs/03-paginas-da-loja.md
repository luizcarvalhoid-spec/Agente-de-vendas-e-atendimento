# 03 — Navegação e páginas de produto

**Objetivo:** conectar o catálogo à interface existente e criar páginas individuais úteis ao cliente e ao agente.  
**Depende de:** fase 02. **Arquivos de partida:** `Frontend/src/App.tsx`, `src/Pages/CategoryPage.tsx`, `ProductCard.tsx`, `Header.tsx`.

## 3.1 — Roteamento do SPA

- [x] Adicionar React Router compatível com a versão atual de React.
- [x] Criar rotas `/`, `/produtos/:slug`, `/carrinho` e `/checkout-demo` (as duas últimas podem ser placeholders até fase 06).
- [x] Criar estado de loading, 404 de produto e fallback de rota desconhecida.
- [x] Garantir retorno à vitrine sem recarregar toda a aplicação.

**Aceite:** navegação direta e refresh de `/produtos/:slug` funcionam no ambiente local; documento explica fallback SPA para deploy.  
**Commit:** `feat(web): add routes and product navigation`.

### Registro de execução — 07/11/2026

- React Router `7.18.5` foi adotado por ser compatível com React 18 e Vite 5; a versão 8 exige a atualização conjunta da stack e permanece fora do escopo.
- `BrowserRouter` preserva a vitrine em `/` e disponibiliza `/produtos/:slug`, os placeholders honestos `/carrinho` e `/checkout-demo` e o fallback `*`.
- A rota de produto consulta `GET /api/products/:slug` e valida somente `id`, `slug` e `name`. Loading, produto inexistente, API indisponível e retry foram implementados sem antecipar o layout completo da tarefa 3.3.
- O logo, o carrinho e as ações de retorno usam navegação interna. Os cards continuam sem links até receberem os slugs canônicos na tarefa 3.2.
- O diagnóstico de saúde continua restrito ao modo de desenvolvimento. Cabeçalho e barra de anúncio receberam ajustes mínimos para evitar overflow abaixo do breakpoint `sm`.

O Vite 5 usa o modo SPA por padrão, portanto `dev` e `preview` encaminham rotas do frontend ao `index.html`. No deploy estático, o provedor deverá reescrever URLs desconhecidas para `/index.html`, preservando arquivos estáticos. Se frontend e backend compartilharem uma origem no futuro, `/api/*` deverá ser encaminhado ao backend antes desse fallback.

Validações executadas:

- instalação congelada com pnpm `11.25.0` nos dois pacotes;
- lint e build do frontend;
- 127/127 testes e build do backend;
- smoke HTTP da vitrine, rotas profundas, health, CORS, slug válido e slug inexistente;
- navegador: navegação SPA, refresh direto, loading, sucesso, 404 de produto, 404 de rota, indisponibilidade da API, retry e teclado;
- inspeção visual desktop e mobile abaixo do breakpoint `sm`.

O Corepack precisou de acesso de rede fora do sandbox. Os dois testes que criam links simbólicos receberam `EPERM` no sandbox e passaram quando a suíte foi repetida fora dele. Nenhuma alteração foi feita no catálogo, no backend ou nos oito produtos temporários da vitrine.

## 3.2 — Vitrine orientada pela API

- [x] Retirar o array `products` de `CategoryPage.tsx` e consumir `GET /api/products`.
- [x] Tornar filtros de categoria e busca **funcionais** e refletir quantidade real encontrada.
- [x] Conectar “Ver mais produtos” à paginação ou remover se não houver mais itens; não manter CTA decorativo.
- [x] Adaptar `ProductCard.tsx` ao novo contrato e preservar visual (preço, desconto, estrelas, imagens).
- [x] Criar estados de carregamento, vazio e erro, com alternativa de tentar novamente.

**Aceite:** catálogo muda quando dados mudam no CMS leve; filtros, busca e paginação são verificáveis.  
**Commit:** `feat(web): connect product grid to catalog API`.

### Registro de execução — 08/11/2026

- A vitrine passou a consumir exclusivamente `GET /api/products`, com contrato validado em runtime e imagens resolvidas somente na origem configurada da API. O array temporário, avaliações, parcelas e benefícios inventados foram removidos.
- Busca, categorias, subcategorias e paginação usam parâmetros normalizados na URL. O atalho Anticaspa aplica os identificadores canônicos `shampoos` e `anticaspa`; páginas e combinações inválidas são corrigidas sem loops.
- O cabeçalho acompanha `q` durante back/forward. Novas buscas preservam filtros compatíveis, voltam à primeira página e não deixam respostas anteriores substituírem a consulta atual.
- Os cards mantêm preço, desconto derivado, estoque e imagem da API. Cada card possui um único link acessível para o slug canônico, fallback neutro de imagem e omite avaliações ausentes.
- Foram implementados skeleton de carregamento, lista vazia, indisponibilidade com retry e paginação completa. O CTA decorativo “Ver mais produtos” foi removido.

Validações executadas:

- instalação congelada com pnpm `11.25.0` nos pacotes frontend e backend;
- lint e build do frontend; 127/127 testes e build do backend;
- smoke HTTP: 27 IDs únicos, páginas 12/12/3, categorias 14/5/4/4, seis itens Anticaspa, detalhes por slug, 27 imagens HTTP 200 e CORS para `http://127.0.0.1:5173`;
- navegador desktop e mobile: busca, filtros, subcategorias, paginação, URL direta, back/forward, teclado, 404, resposta vazia, API indisponível, retry e ausência de overflow horizontal ou erros no console.

O Corepack exigiu acesso de rede fora do sandbox. No sandbox, dois testes de links simbólicos receberam `EPERM`; a suíte repetida fora dele aprovou os 127 testes. Backend, catálogo, imagens, dependências e etapas 3.3/6 permaneceram inalterados.

## 3.3 — Página de detalhe de produto

- [x] Criar layout `/produtos/:slug`: imagem, nome, preço, disponibilidade, descrição, benefícios, indicações, ingredientes, modo de uso e avisos.
- [x] Exibir avisos importantes sem esconder em abas; evitar claims clínicos exagerados.
- [x] Adicionar CTAs “Adicionar ao carrinho” e “Voltar à loja” (a ação real de carrinho entra na fase 06).
- [x] Implementar responsividade e textos alternativos para fotos.
- [x] Validar que os detalhes vêm da API; não duplicar descrições em JSX.

**Aceite:** todas as páginas dos produtos válidos abrem por slug e exibem campos corretos; produto inexistente apresenta estado 404.  
**Commit:** `feat(web): add product detail pages`.

### Registro de execução — 08/11/2026

- A rota `/produtos/:slug` passou a validar e apresentar o contrato completo de `GET /api/products/:slug`, sem importar dados do backend ou duplicar conteúdo comercial no JSX.
- O layout reutilizável reúne breadcrumb canônico, galeria, marca, preço, desconto derivado, estoque, conteúdo, variante, apresentação do sabonete, descrições, benefícios, indicações e compatibilidades específicas para produtos capilares e corporais.
- Produtos individuais exibem sua própria formulação sintética. Kits mantêm cada componente, quantidade, conteúdo, ingredientes, uso e segurança em blocos independentes, sem sugerir uma fórmula agregada.
- A classificação demonstrativa e a segurança não avaliada permanecem visíveis. Listas vazias de restrições ou contraindicações são descritas como ausência de informação registrada, não como comprovação de ausência de riscos.
- O CTA de compra é explicitamente demonstrativo, não cria estado de carrinho e informa por região acessível que nenhum item foi adicionado. Produtos sem estoque mantêm o CTA desabilitado e identificado como esgotado.
- O cliente diferencia 404, consulta inválida, configuração, rede, timeout, falha HTTP/servidor e resposta incompatível. Somente falhas recuperáveis oferecem retry; cancelamento e chave da requisição impedem conteúdo obsoleto após troca de slug.
- A galeria utiliza somente `primaryUrl` e `galleryUrls` resolvidos na origem validada da API, reinicia seleção e falhas ao trocar de produto e possui fallback neutro para imagens indisponíveis.

Validações executadas:

- lint, 2/2 testes unitários da galeria e build de produção do frontend;
- 127/127 testes e build do backend; os dois testes com links simbólicos exigiram execução fora do sandbox por limitação de permissões do Windows;
- smoke HTTP dos 27 slugs e das 27 imagens, incluindo 18 produtos capilares, 9 corporais, 1 kit, 404 e consulta inválida;
- navegador: produto capilar, sabonete, kit com dois componentes, CTA demonstrativo, breadcrumbs, 404, erro 400, resposta inválida, rede indisponível com retry, timeout, desktop e mobile sem overflow horizontal;
- dados simulados verificaram galeria com uma e três imagens sem alterar o catálogo canônico.

O Corepack não conseguiu consultar o registry dentro do sandbox durante uma repetição dos comandos; as dependências já instaladas permitiram executar as mesmas validações pelos scripts locais com `npm`. Backend, catálogo, imagens e dependências permaneceram inalterados.

## 3.4 — Polimento de UX e acessibilidade

- [ ] Tornar busca e filtros utilizáveis pelo teclado e acessíveis por rótulos.
- [ ] Verificar mobile, desktop, scroll, foco e contraste da interface já existente.
- [ ] Substituir links/botões sem ação por ação real ou estado explicitamente desabilitado.
- [ ] Exibir aviso discreto de loja fictícia/demonstração.

**Aceite:** fluxos de listar → filtrar → abrir produto funcionam com mouse e teclado, em viewport pequena e grande.  
**Commit:** `fix(web): improve catalog UX and accessibility`.

## Se houver algo imprevisto

Crie `## 3.5 — ...` aqui, ou `docs/03.5-nome-do-backlog.md` com o [template](./TEMPLATE-SUBBACKLOG.md). **Não renumere 3.1–3.4.**
