# 07 — Diferenciais de vendas consultivas

**Objetivo:** diferenciar o projeto de um chatbot com resposta genérica, demonstrando seleção justificável e contexto comercial.  
**Depende de:** MVP (01–06). Evite técnicas de persuasão agressiva e recomendações incompatíveis com o cliente.

## 7.1 — Rankeamento explicável

- [ ] Definir regras simples de compatibilidade: restrições eliminatórias (ingrediente, faixa de preço, estoque) e sinais de preferência (categoria, objetivo, tipo de cabelo).
- [ ] Implementar classificação determinística dos candidatos no backend (score/fatores legíveis), com LLM responsável pela explicação natural.
- [ ] Retornar ao agente **motivos e limites da recomendação**; evitar alegar uma pontuação clínica.
- [ ] Testar mudanças de perfil: alterar necessidade deve alterar candidatos/ranking quando fizer sentido.

**Aceite:** é possível explicar por dados do catálogo por que A supera B, sem depender de afirmações inventadas.  
**Commit:** `feat(recommendation): add explainable ranking`.

## 7.2 — Comparação de produtos

- [ ] Criar ferramenta ou operação `compare_products` limitada a 2–3 IDs existentes.
- [ ] Comparar indicação, benefícios, ingredientes, restrições, preço e disponibilidade usando dados do catálogo.
- [ ] Renderizar resposta textual e, se útil, cartões lado a lado no chat (mobile: empilhados).
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
- [ ] Garantir que filtro por restrição seja aplicado pelo código, e não apenas pelo prompt.
- [ ] Fazer o agente pedir esclarecimento quando faltar dado crítico; não insistir indefinidamente.
- [ ] Permitir resposta “Não encontrei um produto adequado” com orientação neutra.
- [ ] Evitar diagnósticos e promessas de cura, especialmente para caspa intensa ou queda capilar.

**Aceite:** testes mostram que nenhum produto incompatível é recomendado, mesmo quando o usuário solicita explicitamente ignorar a restrição anterior.  
**Commit:** `feat(agent): enforce purchase constraints`.

## Fora de escopo

Previsão de vendas, personalização com histórico de compra real, recomendador de ML treinado, perfil permanente de cliente e automação agressiva de upsell.
