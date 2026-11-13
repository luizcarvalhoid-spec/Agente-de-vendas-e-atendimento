# Dataset inicial de avaliação

Esta entrega adiciona oito especificações comportamentais para o futuro
executor offline. Carregar um arquivo com sucesso comprova somente a integridade
estrutural do dataset; não comprova que o agente atende às expectativas.

## Organização e cobertura

| Dataset | Cenário | Comportamento principal |
| --- | --- | --- |
| `universal/core.v1.json` | `universal.core.incomplete-need.001` | Uma pergunta consultiva para necessidade incompleta |
| `universal/core.v1.json` | `universal.core.informational-no-pressure.001` | Resposta informativa sem pressão de compra |
| `universal/safety.v1.json` | `universal.safety.prompt-injection.001` | Resistência a exfiltração de prompt e segredos |
| `universal/safety.v1.json` | `universal.safety.adverse-reaction.001` | Limite clínico e ausência de recomendação comercial |
| `stores/hidrasplash/recommendations.v1.json` | `hidrasplash.recommendation.oily-refreshing-budget.001` | Recomendação canônica por perfil, sensorial e orçamento |
| `stores/hidrasplash/recommendations.v1.json` | `hidrasplash.recommendation.rejection-ingredient.001` | Rejeição e restrição de ingrediente simultâneas |
| `stores/hidrasplash/conversations.v1.json` | `hidrasplash.conversation.budget-change.001` | Substituição de orçamento em conversa multi-turno |
| `stores/hidrasplash/conversations.v1.json` | `hidrasplash.conversation.shipping-boundary.001` | Frete em R$ 100,00 e operação fictícia fundamentados em FAQ |

Os datasets universais não contêm produto, preço, ID, fonte ou política da
HidraSplash. Os datasets da loja referenciam apenas o catálogo e as FAQs
canônicas. Quando mais de uma fonte de frete é aceitável, a assertion define um
conjunto permitido e exige apenas a fonte necessária para a fronteira avaliada.

## Critérios

Assertions objetivas cobrem tipos de resposta, limites de perguntas, IDs
canônicos, cards, restrições de ingrediente, fontes e domínios de grounding. Elas
não comparam mensagens completas. Naturalidade, clareza consultiva e avaliações
semânticas de segurança permanecem subjetivas e `not_evaluated`.

## Preparação para a EVAL-03

O backend já oferece os pontos de extensão necessários sem interface gráfica:

- `AgentModelPort` permite injetar um modelo falso sem rede;
- `createMvpDeterministicModel` já cobre recomendação, FAQ e ferramentas reais;
- os testes de `chat-service` e `chat-humanization` usam queue models para roteiros
  controlados;
- `ChatService`, catálogo, FAQ e ferramentas podem continuar reais no modo
  offline.

Os queue models atuais são helpers privados e o modelo do MVP reconhece mensagens
específicas. A EVAL-03 deverá decidir entre extrair um helper TypeScript comum ou
propor um contrato declarativo versionado para passos do modelo. Nenhum novo
formato de plano foi introduzido nesta entrega; qualquer formato persistido deve
ser especificado e aprovado antes de ser adicionado.

## Cobertura ainda ausente

Ainda não há casos de comparação, carrinho, mudança de categoria, múltiplas FAQs,
privacidade detalhada, informação insuficiente após vários turnos, indisponibilidade
operacional, produto removido ou sem estoque, ambiguidades de contexto e variações
linguísticas dos mesmos comportamentos.

## Expansão planejada

O conjunto deve crescer para aproximadamente 30 cenários em lotes revisáveis:

1. variações e bordas dos oito comportamentos iniciais;
2. comparação, carrinho, contexto e mudanças de objetivo;
3. grounding combinado de produto e FAQ, falhas seguras e indisponibilidade;
4. privacidade, novas tentativas de injeção e situações clínicas;
5. amostra balanceada para avaliação humana de naturalidade e qualidade
   consultiva.

Essa expansão pertence a tarefas futuras e não inicia a EVAL-03.
