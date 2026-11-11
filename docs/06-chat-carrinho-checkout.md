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
- [x] Ativar **Adicionar ao carrinho** após a implementação do estado compartilhado na 6.3.
- [ ] Ativar **Finalizar compra** após a implementação do checkout demonstrativo na 6.4.
- [x] Tratar snapshot histórico, imagem inválida, produto removido, divergência de identidade e indisponibilidade sem quebrar a UI.
- [x] Garantir leitura em mobile e teclado, com cartões de comparação empilhados.

**Aceite visual:** recomendações e comparações exibem dados validados, atualizam snapshots restaurados pelo catálogo canônico e navegam para a PDP existente.

**Aceite comercial parcial:** **Detalhes** e **Adicionar ao carrinho** usam identidades validadas e o mesmo estado compartilhado. **Finalizar compra** continua pendente até o checkout fictício da 6.4; nenhum pedido ou confirmação falsa é oferecido nesta etapa.

**Commit:** `feat(web): render actionable product recommendations`.

**Registro de execução (2026-11-10, base `7a1324c9`):** respostas novas usam somente os cartões validados pelo contrato do chat. Cartões restaurados são identificados como snapshots históricos, reconsultados por slug e somente recebem dados atuais quando `id` e `slug` permanecem idênticos. Falhas temporárias preservam o snapshot rotulado; remoção ou divergência elimina ações inválidas. As consultas de catálogo são limitadas, canceláveis e não acionam o modelo.

## 6.3 — Carrinho real no frontend

- [x] Criar estado único de carrinho em contexto/hook simples com `localStorage` (sem backend de compras).
- [x] Implementar adicionar, remover, alterar quantidade, subtotal e contador no `Header.tsx`.
- [x] Conectar botão rápido de `ProductCard.tsx`, página de detalhe e CTA do chat à **mesma ação**.
- [x] Calcular frete grátis (> R$ 100 conforme política definida; documentar diferença entre `>` e `>=` e ser consistente).
- [x] Recalcular valores a partir do catálogo, nunca confiar em preços persistidos no navegador.

**Aceite:** o `Header` apresenta a quantidade total de unidades confirmadas e ações da vitrine, PDP ou chat refletem no mesmo carrinho.
**Commit:** `feat(web): implement shared demo cart`.

**Registro de execução (2026-11-10, base `41444fee`):** `CartProvider` e `useCart()` mantêm uma única instância dentro do roteador. A persistência `hidrasplash:cart:v1` contém exclusivamente `productId`, `slug` e quantidade, limitada a 20 produtos, 20 unidades por produto e 16 KiB. Referências recuperadas são dados não confiáveis e só entram nos totais após nova consulta ao catálogo, com igualdade estrita de ID/slug, preço em centavos e estoque suficiente. Operações ficam bloqueadas durante a hidratação, exceto `clearCart()`, que aborta e invalida resultados antigos; mutações por produto também são serializadas e canceláveis.

Carrinho vazio não exibe frete. Com unidades válidas, subtotal de até R$ 100,00 — inclusive R$ 100,00 exatos — usa o frete fictício de R$ 12,90; somente subtotal **maior** que R$ 100,00 recebe frete grátis. Itens removidos, esgotados, divergentes ou temporariamente não validados permanecem identificáveis, mas são excluídos dos valores, que ficam explicitamente parciais. `/carrinho` apresenta apenas o estado real temporário; edição completa e checkout permanecem na 6.4.

O CTA do chat revalida cartões `fresh` e `current`; snapshots `refreshing`, `removed` ou `failed` não autorizam inclusão. O `POST /api/chat` permanece sem o campo `cart`: uma integração futura deverá enviar somente IDs e quantidades válidos, nunca preços do navegador. Todos os testes desta tarefa são offline e não acionam a OpenRouter.

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
