# 03 — Navegação e páginas de produto

**Objetivo:** conectar o catálogo à interface existente e criar páginas individuais úteis ao cliente e ao agente.  
**Depende de:** fase 02. **Arquivos de partida:** `Frontend/src/App.tsx`, `src/Pages/CategoryPage.tsx`, `ProductCard.tsx`, `Header.tsx`.

## 3.1 — Roteamento do SPA

- [ ] Adicionar React Router compatível com a versão atual de React.
- [ ] Criar rotas `/`, `/produtos/:slug`, `/carrinho` e `/checkout-demo` (as duas últimas podem ser placeholders até fase 06).
- [ ] Criar estado de loading, 404 de produto e fallback de rota desconhecida.
- [ ] Garantir retorno à vitrine sem recarregar toda a aplicação.

**Aceite:** navegação direta e refresh de `/produtos/:slug` funcionam no ambiente local; documento explica fallback SPA para deploy.  
**Commit:** `feat(web): add routes and product navigation`.

## 3.2 — Vitrine orientada pela API

- [ ] Retirar o array `products` de `CategoryPage.tsx` e consumir `GET /api/products`.
- [ ] Tornar filtros de categoria e busca **funcionais** e refletir quantidade real encontrada.
- [ ] Conectar “Ver mais produtos” à paginação ou remover se não houver mais itens; não manter CTA decorativo.
- [ ] Adaptar `ProductCard.tsx` ao novo contrato e preservar visual (preço, desconto, estrelas, imagens).
- [ ] Criar estados de carregamento, vazio e erro, com alternativa de tentar novamente.

**Aceite:** catálogo muda quando dados mudam no CMS leve; filtros, busca e paginação são verificáveis.  
**Commit:** `feat(web): connect product grid to catalog API`.

## 3.3 — Página de detalhe de produto

- [ ] Criar layout `/produtos/:slug`: imagem, nome, preço, disponibilidade, descrição, benefícios, indicações, ingredientes, modo de uso e avisos.
- [ ] Exibir avisos importantes sem esconder em abas; evitar claims clínicos exagerados.
- [ ] Adicionar CTAs “Adicionar ao carrinho” e “Voltar à loja” (a ação real de carrinho entra na fase 06).
- [ ] Implementar responsividade e textos alternativos para fotos.
- [ ] Validar que os detalhes vêm da API; não duplicar descrições em JSX.

**Aceite:** todas as páginas dos produtos válidos abrem por slug e exibem campos corretos; produto inexistente apresenta estado 404.  
**Commit:** `feat(web): add product detail pages`.

## 3.4 — Polimento de UX e acessibilidade

- [ ] Tornar busca e filtros utilizáveis pelo teclado e acessíveis por rótulos.
- [ ] Verificar mobile, desktop, scroll, foco e contraste da interface já existente.
- [ ] Substituir links/botões sem ação por ação real ou estado explicitamente desabilitado.
- [ ] Exibir aviso discreto de loja fictícia/demonstração.

**Aceite:** fluxos de listar → filtrar → abrir produto funcionam com mouse e teclado, em viewport pequena e grande.  
**Commit:** `fix(web): improve catalog UX and accessibility`.

## Se houver algo imprevisto

Crie `## 3.5 — ...` aqui, ou `docs/03.5-nome-do-backlog.md` com o [template](./TEMPLATE-SUBBACKLOG.md). **Não renumere 3.1–3.4.**
