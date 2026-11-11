# 06 — Chat integrado, carrinho e checkout demonstrativo

**Objetivo:** concluir a primeira jornada comercial ponta a ponta.  
**Depende de:** fases 03 e 05. **M1 concluído** quando cliente conversa, recebe cartão real e navega ao carrinho/checkout fictício.

## 6.1 — Substituir o mock do chat

- [x] Refatorar `ChatbotButton.tsx` separando UI, hook de conversa e cliente de API **apenas quando isso simplificar o componente**.
- [x] Remover `setTimeout`/resposta fixa e chamar `POST /api/chat`.
- [x] Exibir loading, erro, retry e bloqueio de envios simultâneos; permitir Enter e botão de envio.
- [x] Preservar abrir, minimizar, fechar, autoscroll e identidade visual atual.
- [x] Persistir histórico local limitado enquanto a demonstração estiver aberta/recarregada, sem dados sensíveis.

**Aceite offline:** integração com `POST /api/chat`, contratos estritos, histórico limitado, falhas recuperáveis, cancelamento e acessibilidade cobertos por transporte falso e testes de DOM. A validação operacional com OpenRouter real permanece pendente e não foi executada nesta tarefa.

**Commit:** `feat(web): wire chat to live agent API`.

**Registro de execução (2026-11-10, base `18552e63`):** o frontend envia somente `message`, `sessionId` e `history`; conserva no máximo cinco turnos concluídos em `sessionStorage`; remove pares antigos para respeitar 32.000 bytes UTF-8; não renderiza cartões nem CTAs nesta etapa. Respostas estruturadas são validadas e preservadas como snapshots históricos para a futura 6.2, que deverá atualizar dados canônicos antes de qualquer ação comercial sensível a preço ou disponibilidade.

## 6.2 — Cartão de recomendação no chat

- [x] Renderizar mensagens `recommendation` e `comparison` com justificativa curta, foto real do produto, nome, preço e disponibilidade.
- [x] Oferecer CTA funcional **Detalhes**, associado ao `productId/slug` validado pelo backend e sem inferir campos comerciais do texto do modelo.
- [ ] Ativar **Adicionar ao carrinho** após a implementação do estado compartilhado na 6.3.
- [ ] Ativar **Finalizar compra** após a implementação do checkout demonstrativo na 6.4.
- [x] Tratar snapshot histórico, imagem inválida, produto removido, divergência de identidade e indisponibilidade sem quebrar a UI.
- [x] Garantir leitura em mobile e teclado, com cartões de comparação empilhados.

**Aceite visual:** recomendações e comparações exibem dados validados, atualizam snapshots restaurados pelo catálogo canônico e navegam para a PDP existente.

**Aceite comercial pendente:** os três CTAs somente estarão completos após a integração do carrinho na 6.3 e do checkout na 6.4; nenhum carrinho temporário ou confirmação falsa é oferecido nesta etapa.

**Commit:** `feat(web): render actionable product recommendations`.

**Registro de execução (2026-11-10, base `7a1324c9`):** respostas novas usam somente os cartões validados pelo contrato do chat. Cartões restaurados são identificados como snapshots históricos, reconsultados por slug e somente recebem dados atuais quando `id` e `slug` permanecem idênticos. Falhas temporárias preservam o snapshot rotulado; remoção ou divergência elimina ações inválidas. As consultas de catálogo são limitadas, canceláveis e não acionam o modelo.

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
