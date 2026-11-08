# 04 — FAQ fictícia e RAG textual

**Objetivo:** permitir que o agente responda a dúvidas de e-commerce com base nas políticas fictícias, sem inventar prazos ou regras.  
**Depende de:** fases 01 e 02 (API e dados); pode ser desenvolvido antes da interface do chat.

## 4.1 — Criar base de conhecimento da loja

- [x] Criar aproximadamente **20–30 FAQs**, em arquivos Markdown por assunto (`frete`, `pagamento`, `trocas`, `produtos`, `pedidos`, `privacidade`), com IDs estáveis.
- [x] Estabelecer políticas **fictícias e coerentes**, incluindo frete grátis acima de R$ 100, prazos ilustrativos, pagamentos, trocas e itens danificados.
- [x] Indicar em cada documento que as políticas são apenas demonstrativas; evitar textos contraditórios.
- [x] Incluir pergunta sem resposta prevista para testar fallback honesto.
- [x] Não criar pedidos reais, CPF ou dados pessoais de clientes.

**Aceite:** FAQs revisadas são legíveis, versionadas e não contradizem a barra de anúncio da loja.  
**Commit:** `docs(knowledge): add fictional ecommerce policies`.

### Registro de execução — 08/11/2026

- A base contém 25 documentos, um por FAQ, distribuídos em frete `4`, pagamento `4`, trocas `5`, produtos `5`, pedidos `4` e privacidade `3`.
- Cada documento usa frontmatter plano e estrito com `sourceId`, `category`, `title` e `classification: fictional-demo`. IDs `faq-NNN` são únicos, ordenados e independentes da categoria para permitir recategorização sem quebrar referências.
- As políticas aprovadas mantêm frete grátis somente para subtotal maior que R$ 100,00, frete padrão fictício de R$ 12,90, prazo de 4 a 8 dias úteis e janelas demonstrativas de 7 dias corridos e 5 dias úteis.
- Todas as respostas afirmam seu caráter fictício ou demonstrativo. Não há produto, preço, estoque, transportadora, rastreamento, pagamento, atendimento humano ou dado pessoal concreto apresentado como real.
- Consultas deliberadamente sem política foram registradas fora da raiz carregável, como fixtures para o fallback futuro. Nenhuma resposta foi inventada para esses casos.
- O parser controlado rejeita metadados incompletos, duplicados ou desconhecidos, IDs e títulos duplicados, divergência de arquivo ou categoria, entradas inesperadas e links simbólicos. O carregamento é determinístico, independente de `cwd` e expõe somente erros sanitizados.
- O comando `validate:faq` reutiliza o padrão editorial do catálogo e retorna código `0` para a base válida ou `1` para erros, sem stack trace ou caminhos absolutos.

Validações executadas:

- instalação congelada com pnpm `11.25.0`, sem alteração do lockfile;
- `validate:faq`: 25 documentos aprovados na distribuição `4/4/5/5/4/3`;
- 15/15 testes do módulo de conhecimento e 142/142 testes do backend;
- typecheck, build do backend e `git diff --check` aprovados;
- testes temporários verificaram frontmatter inválido, duplicatas, divergências editoriais, arquivos inesperados, mensagens sanitizadas e escape por junction/symlink.

O Corepack precisou de acesso de rede fora do sandbox. Testes que criam links simbólicos ou junctions também foram repetidos fora do sandbox por restrições do Windows. Não foram implementados busca, ranking, tokenização, endpoint, ferramenta do agente ou integração OpenRouter.

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
