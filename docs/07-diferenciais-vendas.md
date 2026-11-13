# 07 — Diferenciais de vendas consultivas

**Objetivo:** diferenciar o projeto de um chatbot com resposta genérica, demonstrando seleção justificável e contexto comercial.  
**Depende de:** MVP (01–06). Evite técnicas de persuasão agressiva e recomendações incompatíveis com o cliente.

## 7.1 — Rankeamento explicável

- [x] Definir regras simples de compatibilidade: restrições eliminatórias (ingrediente, faixa de preço, estoque) e sinais de preferência (categoria, objetivo, tipo de cabelo).
- [ ] Implementar classificação determinística dos candidatos no backend (score/fatores legíveis), com LLM responsável pela explicação natural.
- [ ] Retornar ao agente **motivos e limites da recomendação**; evitar alegar uma pontuação clínica.
- [x] Testar mudanças de perfil: alterar necessidade deve alterar candidatos/ranking quando fizer sentido.

**Aceite:** é possível explicar por dados do catálogo por que A supera B, sem depender de afirmações inventadas.  
**Commit:** `feat(recommendation): add explainable ranking`.

## 7.2 — Comparação de produtos

- [ ] Criar ferramenta ou operação `compare_products` limitada a 2–3 IDs existentes.
- [ ] Comparar indicação, benefícios, ingredientes, restrições, preço e disponibilidade usando dados do catálogo.
- [x] Renderizar resposta textual e, se útil, cartões lado a lado no chat (mobile: empilhados).
- [ ] Fazer recomendação preferencial somente se houver diferença relevante; caso contrário, explicar o empate.

**Aceite:** pergunta “Qual a diferença entre esses dois shampoos?” tem resposta fundamentada e reproduzível.  
**Commit:** `feat(agent): support catalog-grounded comparisons`.

## 7.3 — Contexto do carrinho

- [ ] Enviar ao backend apenas `productId` e quantidade de itens, com limite e validação.
- [ ] Resolver valores no catálogo e permitir respostas “O que combina com o shampoo do meu carrinho?”.
- [ ] Mostrar quanto falta para frete grátis com regra **exata** da FAQ; não inventar descontos.
- [ ] Evitar recomendar produto já adicionado como se fosse novidade, salvo pedido explícito.

**Aceite:** conversa considera o carrinho sem acesso a dados de pagamento ou identidade.  
**Commit:** `feat(agent): make recommendations cart-aware`.

## 7.4 — Sensibilidade, orçamento e opção de não recomendar

- [ ] Criar cenários de alergia/restrição declarada, orçamento e indisponibilidade.
- [x] Garantir que filtro por restrição seja aplicado pelo código, e não apenas pelo prompt.
- [x] Fazer o agente pedir esclarecimento quando faltar dado crítico; não insistir indefinidamente.
- [x] Permitir resposta “Não encontrei um produto adequado” com orientação neutra.
- [x] Evitar diagnósticos e promessas de cura, especialmente para caspa intensa ou queda capilar.

**Aceite:** testes mostram que nenhum produto incompatível é recomendado, mesmo quando o usuário solicita explicitamente ignorar a restrição anterior.  
**Commit:** `feat(agent): enforce purchase constraints`.

## Auditoria de progresso (12/11/2026)

Os checkboxes acima foram conciliados com funcionalidades e testes **offline** já mesclados; a fase 07 **não** foi concluída.

- **7.1 parcial:** existem filtros/restrições, ranking determinístico e testes de mudança de objetivo/orçamento ([PR #21](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/21), [#35](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/35)). Ainda é necessário comprovar todos os requisitos de pontuação e explicação de ranking.
- **7.2 parcial:** comparação fundamentada de dois produtos e cartões empilhados existem ([#25](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/25), [#35](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/35)); isso **não** equivale à ferramenta `compare_products` prevista nem comprova todos os atributos e critérios de preferência/empate.
- **7.3 pendente:** carrinho no frontend está pronto ([#26](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/26), [#27](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/27)), mas o envio do seu contexto ao agente para recomendações complementares **não** foi entregue. Cotação de recomendação anterior ([#34](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/34)) não é contexto de carrinho.
- **7.4 parcial:** restrições, esclarecimento, ausência honesta de produto e limites clínicos são cobertos em suítes offline ([#28](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/28), [#35](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/35)). Falta consolidar a matriz adversarial de alergia, indisponibilidade e instruções para ignorar restrições anteriores exigida pelo aceite.

**Próximo aceite:** implementar e testar os itens ainda `[ ]` com dados do catálogo; confirmar em avaliação de cenários com LLM real em etapa distinta e opt-in.

## Fora de escopo

Previsão de vendas, personalização com histórico de compra real, recomendador de ML treinado, perfil permanente de cliente e automação agressiva de upsell.
