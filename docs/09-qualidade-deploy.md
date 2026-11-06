# 09 — Qualidade, segurança e demonstração online

**Objetivo:** tornar o projeto apresentável e reproduzível por quem acessa o GitHub, sem tratá-lo como e-commerce real.  
**Depende de:** fases 01–08. Uma demonstração pública é desejável, mas **não obrigatória** para finalizar o repositório.

## 9.1 — Revisão técnica final

- [ ] Executar build, lint, testes unitários e mocks do backend/frontend, corrigindo erros que impeçam execução.
- [ ] Testar manualmente nas larguras mobile e desktop: catálogo, filtros, produto, chat, FAQ, carrinho, checkout-demo e painel.
- [ ] Validar estados vazios e falhas: API fora do ar, imagem ausente, produto inexistente, rate limit e timeout.
- [ ] Conferir semântica, teclado, foco, contraste e rótulos dos botões do chat.

**Aceite:** fluxo principal funciona de ponta a ponta e falhas comuns são comunicadas.  
**Commit:** `fix: stabilize demo flows and responsiveness`.

## 9.2 — Segurança mínima e custos

- [ ] Revisar histórico Git (e não só arquivos atuais) quanto a tokens, `.env`, credenciais, dados privados e URLs internas.
- [ ] Confirmar API key apenas no servidor e variável `VITE_*` sem segredos.
- [ ] Ativar limites de input, histórico, tokens, ciclo de tools, tempo e rate limit no backend.
- [ ] Garantir que o conteúdo de FAQ e produtos não altere instruções do sistema nem execute URLs/comandos externos.
- [ ] Impedir checkout real e armazenamento de cartão/CPF; colocar aviso de **demonstração fictícia** em local visível.
- [ ] Substituir contato pessoal hardcoded na interface por contato fictício de demonstração antes de divulgar publicamente.

**Aceite:** teste de segurança manual + checklist documentados; nenhum segredo detectável no repositório.  
**Commit:** `chore: harden public demo defaults`.

## 9.3 — Hospedagem opcional do demo

- [ ] Escolher hospedagem estática para Vite e serviço Node para o backend, verificando termos, preços e persistência **atuais** antes de contratar.
- [ ] Configurar build, variável `VITE_API_URL`, `FRONTEND_ORIGIN` e chave OpenRouter no serviço backend, nunca no repositório.
- [ ] Configurar fallback SPA para `/produtos/:slug` e outras rotas em refresh.
- [ ] Executar smoke test com requisições limitadas; considerar orçamento e limites para evitar uso indevido em um link público.
- [ ] Se não houver deploy, registrar vídeo e instruções de execução local como alternativa honesta.

**Aceite:** link demo funciona em aba anônima **ou** gravação e execução local estão documentadas como alternativa; nenhum serviço é descrito como gratuito sem verificação.  
**Commit:** `chore: prepare deployment configuration`.

## 9.4 — Checklist de demonstração pública

- [ ] Verificar que frete, pagamentos e promoções são explicitamente fictícios.
- [ ] Verificar que o painel técnico não expõe conversas ou eventos de outros visitantes.
- [ ] Testar modelo com quota controlada; falha de chave ou saldo mostra resposta amigável.
- [ ] Testar fluxo `pergunta → produto → detalhes → carrinho → checkout-demo` a partir de navegação limpa.

**Aceite:** qualquer visitante consegue entender a finalidade do portfólio sem confundi-lo com uma loja transacional.  
**Commit:** `test: complete release smoke checklist`.
