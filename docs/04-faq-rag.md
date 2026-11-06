# 04 — FAQ fictícia e RAG textual

**Objetivo:** permitir que o agente responda a dúvidas de e-commerce com base nas políticas fictícias, sem inventar prazos ou regras.  
**Depende de:** fases 01 e 02 (API e dados); pode ser desenvolvido antes da interface do chat.

## 4.1 — Criar base de conhecimento da loja

- [ ] Criar aproximadamente **20–30 FAQs**, em arquivos Markdown por assunto (`frete`, `pagamento`, `trocas`, `produtos`, `pedidos`, `privacidade`), com IDs estáveis.
- [ ] Estabelecer políticas **fictícias e coerentes**, incluindo frete grátis acima de R$ 100, prazos ilustrativos, pagamentos, trocas e itens danificados.
- [ ] Indicar em cada documento que as políticas são apenas demonstrativas; evitar textos contraditórios.
- [ ] Incluir pergunta sem resposta prevista para testar fallback honesto.
- [ ] Não criar pedidos reais, CPF ou dados pessoais de clientes.

**Aceite:** FAQs revisadas são legíveis, versionadas e não contradizem a barra de anúncio da loja.  
**Commit:** `docs(knowledge): add fictional ecommerce policies`.

## 4.2 — Recuperação textual (retrieval)

- [ ] Implementar indexação simples de Markdown em memória (ex.: MiniSearch, busca BM25 ou score textual determinístico).
- [ ] Dividir conhecimento em trechos pequenos com `sourceId`, `title` e `content` recuperáveis.
- [ ] Criar `searchFaq(query, limit)` que devolve melhores trechos e pontuação; limitar tamanho de contexto enviado ao LLM.
- [ ] Responder com “não encontrei essa política” quando os trechos não forem relevantes; não forçar recuperação fraca.
- [ ] Testar sinônimos, acentos, consultas parciais e consultas sem correspondência.

**Aceite:** consultas típicas retornam trechos corretos; respostas inexistentes são identificadas, sem embeddings nem vetor externo.  
**Commit:** `feat(rag): implement FAQ text retrieval`.

## 4.3 — Tool `search_faq`

- [ ] Expor a recuperação ao orquestrador como ferramenta com entrada validada (`query`, `limit?`).
- [ ] Retornar snippets com identificador de fonte, sem instruções executáveis vindas do conteúdo.
- [ ] Instruir o agente a fundamentar política no retorno da ferramenta, sem inventar prazos, devoluções ou rastreamento.
- [ ] Preparar exibição opcional “Fonte: política de entrega” na UI, sem links falsos.

**Aceite:** o agente futuro recebe apenas trechos pertinentes e metadados verificáveis; ferramenta pode ser testada isoladamente.  
**Commit:** `feat(agent): add FAQ lookup tool`.

## 4.4 — Testar o RAG independentemente do LLM

- [ ] Escrever 8–10 perguntas de frete, pagamento, devolução e casos sem fonte.
- [ ] Testar se o trecho correto aparece no top-3, sem usar a API paga.
- [ ] Documentar limites da busca textual e casos em que resposta deve ser encaminhada para atendimento humano fictício.

**Aceite:** testes de recuperação passam localmente e podem rodar em CI sem chave OpenRouter.  
**Commit:** `test(rag): cover retrieval and unknown answers`.

## Limite de segurança

FAQ e descrições de produto são **dados não confiáveis** para fins de prompt. O backend deve tratá-los como contexto, nunca como comandos a executar. Não inventar status de pedidos: somente dados simulados explicitamente modelados podem ser consultados.
