# Avaliação offline da humanização do agente

## Escopo e método

A avaliação automatizada usa modelo falso, ferramentas reais em memória e catálogo/FAQs canônicos. Ela cobre 15 jornadas em `Backend/test/chat-humanization.test.ts` e verifica fatos, contratos, contexto e limites de segurança, sem depender somente de frases completas.

Os exemplos "antes" abaixo foram reconstruídos diretamente dos caminhos de composição existentes em `origin/main` no merge `be1ed3f`; eles são uma linha de base de código, não a saída de uma execução comparativa mantida na suíte. Os exemplos "depois" são saídas reais da nova composição, com seus fatos cobertos pelos testes offline.

Passar nos testes não comprova, por si só, naturalidade subjetiva. Essa avaliação continua reservada para inspeção manual futura.

## Exemplos representativos

### Recomendação com preferências completas

Antes — linha de base reconstruída, não executada na suíte:

> Com base nas preferências informadas e nos dados demonstrativos atuais, selecionei Shampoo Anticaspa Controle de Oleosidade Limão Siciliano & Hortelã. Confira o cartão com preço e estoque canônicos.

Depois — saída real coberta pelo cenário 1:

> Pelo que você me contou, eu escolheria Shampoo Anticaspa Controle de Oleosidade Limão Siciliano & Hortelã. Essa opção tem posicionamento comercial para couro cabeludo com tendência à oleosidade, combina com a preferência por frescor e custa R$ 48,90, dentro do limite de R$ 50,00. Os detalhes de preço e estoque estão no cartão.

O texto novo usa apenas compatibilidade, perfil sensorial, preço e orçamento validados. O cartão continua sendo a fonte estrutural de ID, preço e estoque.

### Frete e entrega real

Antes — linha de base reconstruída, não executada na suíte:

> Na demonstração, o frete grátis é ilustrado somente quando o subtotal [...] for maior que R$ 100,00. Um subtotal de R$ 100,00 exatos não recebe frete grátis [...]

Esse caminho devolvia o conteúdo literal da primeira FAQ e podia omitir o frete padrão e a ausência de entrega real.

Depois — saída real coberta pelo cenário 8:

> Para subtotais de até R$ 100,00, o frete demonstrativo fica em R$ 12,90. Acima de R$ 100,00, ele é grátis — R$ 100,00 exatos ainda paga o frete padrão. Como esta é uma simulação, nenhuma mercadoria é separada, despachada ou entregue de verdade.

O teste exige simultaneamente `faq-001`, `faq-002` e `faq-003`, preserva a fronteira de R$ 100,00 e rejeita o texto inventado pelo modelo.

## Cobertura das 15 jornadas

1. Preferências completas.
2. Informações insuficientes.
3. Indecisão entre dois produtos.
4. Alteração de orçamento.
5. Mudança de objetivo.
6. Pergunta sobre preço e estoque.
7. Pedido de justificativa.
8. Frete e entrega real.
9. Pergunta combinada de produto e FAQ.
10. Cotação contextual determinística.
11. Política não documentada.
12. Garantia clínica inexistente.
13. Retomada após vários turnos.
14. Rejeição da recomendação e pedido de alternativa.
15. Pergunta simples sem intenção de compra.

## Limitações remanescentes

- A variação textual é determinística de propósito; ela melhora a contextualização sem tentar simular criatividade irrestrita.
- FAQs fora das regras comerciais mais sensíveis recebem uma simplificação conservadora do texto canônico, não uma reescrita livre.
- O reconhecimento de preferências continua limitado ao vocabulário estruturado já suportado pelo backend.
- A qualidade subjetiva do tom deve ser validada manualmente no Chrome em etapa separada, sem chamadas pagas durante esta tarefa.
