# 06 — Chat integrado, carrinho e checkout demonstrativo

**Objetivo:** concluir a primeira jornada comercial ponta a ponta.  
**Depende de:** fases 03 e 05. **M1 concluído** quando cliente conversa, recebe cartão real e navega ao carrinho/checkout fictício.

## 6.1 — Substituir o mock do chat

- [ ] Refatorar `ChatbotButton.tsx` separando UI, hook de conversa e cliente de API **apenas quando isso simplificar o componente**.
- [ ] Remover `setTimeout`/resposta fixa e chamar `POST /api/chat`.
- [ ] Exibir loading, erro, retry e bloqueio de envios simultâneos; permitir Enter e botão de envio.
- [ ] Preservar abrir, minimizar, fechar, autoscroll e identidade visual atual.
- [ ] Persistir histórico local limitado enquanto a demonstração estiver aberta/recarregada, sem dados sensíveis.

**Aceite:** resposta exibida vem da OpenRouter via backend; falha de rede é comunicada e o usuário pode repetir.  
**Commit:** `feat(web): wire chat to live agent API`.

## 6.2 — Cartão de recomendação no chat

- [ ] Renderizar mensagens `recommendation` com justificativa curta, foto real do produto, nome, preço e disponibilidade.
- [ ] Adicionar CTAs **Detalhes**, **Adicionar ao carrinho** e **Finalizar compra** (não tratar como ações textuais do LLM).
- [ ] Associar os CTAs a `productId/slug` validado pelo backend; jamais usar preço retornado livremente pelo modelo.
- [ ] Tratar imagem inválida, produto removido e indisponibilidade sem quebrar UI.
- [ ] Garantir leitura em mobile e teclado.

**Aceite:** uma recomendação real traz os três CTAs funcionais e dados consistentes com a página de produto.  
**Commit:** `feat(web): render actionable product recommendations`.

## 6.3 — Carrinho real no frontend

- [ ] Criar estado único de carrinho em contexto/hook simples com `localStorage` (sem backend de compras).
- [ ] Implementar adicionar, remover, alterar quantidade, subtotal e contador no `Header.tsx`.
- [ ] Conectar botão rápido de `ProductCard.tsx`, página de detalhe e CTA do chat à **mesma ação**.
- [ ] Calcular frete grátis (> R$ 100 conforme política definida; documentar diferença entre `>` e `>=` e ser consistente).
- [ ] Recalcular valores a partir do catálogo, nunca confiar em preços persistidos no navegador.

**Aceite:** contador deixa de ser `2` fixo; ações em qualquer parte da aplicação refletem no mesmo carrinho.  
**Commit:** `feat(web): implement shared demo cart`.

## 6.4 — Checkout fictício

- [ ] Implementar `/carrinho` com resumo e ações de quantidade/exclusão.
- [ ] Implementar `/checkout-demo` com resumo final e **finalização simulada**, sem coleta de cartão, CPF ou pagamento real.
- [ ] Criar confirmação explícita “Pedido demonstrativo gerado — nenhuma compra foi efetuada”.
- [ ] Permitir recomeçar demonstração/carrinho; não integrar gateway de pagamentos.

**Aceite:** é possível ir da conversa à confirmação simulada em uma sessão sem erro e sem transação financeira.  
**Commit:** `feat(web): add mock checkout flow`.

## 6.5 — Teste de ponta a ponta do M1

- [ ] Testar conversa de anticaspa com perguntas adaptativas → recomendação → detalhes → carrinho → checkout-demo.
- [ ] Testar dúvidas de frete e devolução recuperadas pela FAQ.
- [ ] Testar resposta quando nenhum produto é adequado.
- [ ] Registrar vídeo curto de demonstração local para comparar com evolução posterior.

**Aceite:** jornada principal demonstrada manualmente, com dados corretos e sem ações falsas.  
**Commit:** `test(e2e): validate portfolio MVP journey`.
