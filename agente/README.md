# Agente HidraSplash

O agente HidraSplash é o componente demonstrativo de atendimento e vendas
consultivas do e-commerce fictício. Ele combina um modelo configurado via
OpenRouter com regras determinísticas do backend, ferramentas de catálogo e uma
base FAQ lexical. O modelo não é autoridade para preço, estoque, produto,
política ou elegibilidade: esses dados precisam ser confirmados pelas fontes
canônicas antes de aparecerem na resposta pública.

Os documentos gerais das fases permanecem no roadmap:

- [Fase 04 — FAQ fictícia e RAG](../docs/04-faq-rag.md)
- [Fase 05 — Agente com OpenRouter e ferramentas](../docs/05-agente-openrouter.md)

## Arquitetura e fluxo

1. `POST /api/chat` valida mensagem, histórico, carrinho e preferências com
   contrato estrito.
2. O planejamento de grounding classifica a consulta como conversa livre,
   produto, FAQ ou ambos.
3. A política consultiva decide se há informação suficiente ou se uma pergunta
   de esclarecimento é necessária.
4. O orquestrador limitado chama o modelo e executa somente ferramentas
   registradas, com argumentos e resultados validados.
5. O backend reconstrói produtos, fontes e mensagens públicas a partir de dados
   autorizados; texto livre do modelo não cria cartões nem fontes.
6. Admissão, timeout, cancelamento, orçamento de uso e eventos operacionais
   protegem cada execução.

Pontos principais no backend:

- [serviço de chat](../Backend/src/agent/chat-service.ts)
- [planejador de grounding](../Backend/src/agent/chat-grounding-planner.ts)
- [política consultiva permanente](../Backend/src/agent/consultative-agent-policy.ts)
- [orquestrador de ferramentas](../Backend/src/agent/tool-orchestrator.ts)
- [cliente OpenRouter](../Backend/src/agent/openrouter/openrouter-client.ts)
- [rota HTTP de chat](../Backend/src/routes/chat.ts)

## OpenRouter e política consultiva

A integração OpenRouter existe somente no backend. Chave, modelo, timeout e
limites são configurações de servidor; nada disso deve ser enviado ao Vite ou
aceito do cliente. O cliente limita requisição e resposta, lê respostas de modo
incremental, preserva cancelamento e converte falhas do provedor em categorias
internas sanitizadas. Não há retries automáticos.

A política consultiva pede preferências que realmente diferenciem candidatos,
preserva restrições atuais e estabelece limites clínicos. Orçamento isolado não
justifica escolher o primeiro produto, e dados sintéticos de formulação não
comprovam segurança, eficácia ou adequação médica.

Documentação especializada:

- [Política consultiva](./docs/05.2-consultative-policy.md)
- [Ferramentas e orquestração](./docs/05.3-tool-orchestration.md)
- [Contrato da API de chat](./docs/05.4-chat-api.md)
- [Resiliência e uso operacional](./docs/05.5-agent-resilience.md)

## Ferramentas

O registry disponibiliza três ferramentas provider-agnostic:

- `search_products`: busca e ordena candidatos do catálogo dentro dos filtros e
  das restrições confiáveis da execução;
- `get_product_details`: consulta detalhes canônicos de um produto, sem tornar
  automaticamente o item elegível para recomendação;
- `search_faq`: recupera políticas demonstrativas validadas e retorna apenas
  campos autorizados, sem score ou caminhos internos.

As factories e contratos ficam em
[Backend/src/agent/tools](../Backend/src/agent/tools/). O orquestrador impõe
limites de chamadas, valida resultados em runtime, preserva IDs de tool calling
e trata conteúdo recuperado como dado não confiável, nunca como instrução de
sistema.

## RAG lexical e fontes

O RAG usa um índice lexical próprio, determinístico e em memória, sem
embeddings, banco vetorial ou serviço externo. A normalização cobre caixa,
acentos e pontuação; stopwords, sinônimos estreitos, cobertura e peso maior de
título reduzem correspondências genéricas. Cada FAQ curta permanece uma unidade
recuperável.

- [25 documentos FAQ em Markdown](../Backend/content/knowledge/)
- [contrato editorial da base](../Backend/content/knowledge/README.md)
- [carregador validado](../Backend/src/knowledge/faq-content-loader.ts)
- [índice lexical](../Backend/src/knowledge/faq-search.ts)
- [avaliação independente do RAG](./docs/04.4-rag-evaluation.md)

Consultas sem política suficiente retornam ausência de fonte. O agente não deve
inventar prazo, procedimento, transação ou encaminhamento interno. `sourceId` e
classificação vêm exclusivamente dos documentos carregados e validados.

## Grounding, limites e observabilidade

Recomendações e comparações exigem produtos elegíveis e autorizados pelo
resultado estrutural das ferramentas. Referências ambíguas não selecionam itens
do ranking, e IDs escritos livremente pelo modelo não são aceitos. Perguntas de
política exigem fontes FAQ válidas; consultas mistas preservam separadamente os
estados de produto e FAQ.

O backend aplica rate limiting por origem e sessão, concorrência global e por
origem, timeout, cancelamento e reserva preventiva de uso. A reconciliação é
conservadora quando o transporte pode ter começado, inclusive se uma promessa
ignorar cancelamento. Eventos operacionais são sanitizados e não contêm prompt,
mensagem, histórico, credencial, IP, resultado integral de ferramenta ou dados
pessoais.

## Validação offline

Na pasta `Backend/`, os comandos principais são:

```powershell
pnpm validate:catalog
pnpm validate:faq
pnpm test
pnpm exec tsc -p tsconfig.json --noEmit
pnpm build
```

Os testes usam modelos, transportes e relógios falsos; a suíte não precisa de
credencial e não chama a OpenRouter. Casos específicos cobrem recuperação FAQ,
ferramentas, orquestração, contrato HTTP, cancelamento e controles de custo.

## Smoke manual e possível custo

O roteiro manual está em
[Backend/src/scripts/smoke-chat.ts](../Backend/src/scripts/smoke-chat.ts) e é
executado, a partir de `Backend/`, com `pnpm smoke:chat`. Ele exige confirmação
explícita, credencial local, modelo, preços informados pelo operador e teto
monetário. O script confere o orçamento antes de cada transporte, limita
execuções e chamadas e interrompe quando o uso está ausente ou inválido.

**O smoke pode gerar custos reais no provedor.** As estimativas do roteiro são
proteções locais, não representam cobrança final. Ele não é executado por
`pnpm test` nem pela validação documental.

## Limitações atuais

- Catálogo, políticas, preços, estoque e classificações são fictícios ou
  demonstrativos.
- Não existem pagamento, pedido, entrega, rastreamento, atendimento humano ou
  outra transação real.
- Os limites de admissão e uso são locais ao processo e reiniciam com a
  instância.
- A busca lexical depende de vocabulário e não oferece compreensão semântica
  geral.
- A implementação e os testes offline estão concluídos, mas o comportamento e
  o tool calling com um modelo real da OpenRouter ainda não foram comprovados
  por smoke documentado.
