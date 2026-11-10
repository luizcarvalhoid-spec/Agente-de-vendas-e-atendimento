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

- [x] Implementar indexação simples de Markdown em memória (ex.: MiniSearch, busca BM25 ou score textual determinístico).
- [x] Dividir conhecimento em trechos pequenos com `sourceId`, `title` e `content` recuperáveis.
- [x] Criar `searchFaq(query, limit)` que devolve melhores trechos e pontuação; limitar tamanho de contexto enviado ao LLM.
- [x] Responder com “não encontrei essa política” quando os trechos não forem relevantes; não forçar recuperação fraca.
- [x] Testar sinônimos, acentos, consultas parciais e consultas sem correspondência.

**Aceite:** consultas típicas retornam trechos corretos; respostas inexistentes são identificadas, sem embeddings nem vetor externo.  
**Commit:** `feat(rag): implement FAQ text retrieval`.

### Registro de execução — 08/11/2026

- A recuperação usa um índice lexical próprio criado uma vez a partir dos
  `FaqDocument` validados, sem dependências adicionais, embeddings, vetor ou
  leitura de disco por consulta.
- Cada uma das 25 FAQs permanece uma unidade recuperável. O resultado preserva
  `sourceId`, título, categoria, classificação `fictional-demo` e a resposta
  integral limitada pelo schema editorial.
- A normalização trata caixa, acentos, pontuação e números. Stopwords, ruído
  editorial e aliases estreitos são explícitos; não há stemming, busca difusa
  ou correspondência por prefixo.
- O score combina IDF, peso maior para título, bônus de bigramas e cobertura
  ponderada. Termos informativos ausentes do corpus reduzem a cobertura, e um
  termo genérico isolado não produz fonte. O score ordena correspondências, mas
  não representa probabilidade ou confiança estatística.
- Empates são resolvidos por score, evidência no título e `sourceId`. Consultas
  vazias, compostas apenas por stopwords, maiores que 300 caracteres ou sem
  evidência suficiente retornam lista vazia.
- Os testes específicos cobrem 11 consultas positivas, as 5 consultas
  desconhecidas versionadas, 5 negativas adicionais com sobreposição lexical,
  fallback parcial, metadados, cláusulas condicionais e negativas, estabilidade
  de score, empates, limites, repetição de termos e consulta semelhante a caminho.

Validações executadas:

- `validate:faq`: 25 documentos aprovados na distribuição `4/4/5/5/4/3`;
- testes específicos de recuperação: 9/9;
- suíte completa do backend: 151/151;
- typecheck e build do backend aprovados;
- `git diff --check` aprovado.

A suíte completa precisou ser repetida fora do sandbox para permitir testes
preexistentes que criam links simbólicos e renomeiam fixtures temporárias no
Windows. Não foram implementados endpoint, ferramenta `search_faq`, singleton
global, inicialização no servidor, OpenRouter, agente ou UI.

## 4.3 — Tool `search_faq`

- [x] Expor a recuperação ao orquestrador como ferramenta com entrada validada (`query`, `limit?`).
- [x] Retornar snippets com identificador de fonte, sem instruções executáveis vindas do conteúdo.
- [x] Instruir o agente a fundamentar política no retorno da ferramenta, sem inventar prazos, devoluções ou rastreamento.
- [x] Preparar exibição opcional “Fonte: política de entrega” na UI, sem links falsos.

**Aceite:** o agente futuro recebe apenas trechos pertinentes e metadados verificáveis; ferramenta pode ser testada isoladamente.  
**Commit:** `feat(agent): add FAQ lookup tool`.

### Registro de execução — 08/11/2026

- `createSearchFaqTool(faqSearchIndex)` recebe somente a porta de busca por
  injeção e expõe nome, descrição, schema Zod estrito e `execute`. Não carrega
  arquivos, não cria singleton e não conhece HTTP, OpenRouter ou runtime de agente.
- A entrada exige `query` de 1 a 300 caracteres após `trim`; `limit` aceita
  inteiros de 1 a 5 e usa padrão 3. Não há coerção, e campos desconhecidos são
  rejeitados como `INVALID_ARGUMENTS` antes de consultar o índice.
- A saída distingue `found`, `not_found`, `INVALID_ARGUMENTS` e
  `EXECUTION_FAILED`. Fontes retornam somente `sourceId`, título, categoria,
  classificação `fictional-demo` e conteúdo; o score lexical permanece interno.
- Resultados do índice são validados em runtime com os schemas FAQ. Estruturas
  incompletas, propriedades extras, classificações inválidas, scores não finitos,
  excesso de resultados e falhas inesperadas produzem erro sanitizado.
- O orçamento máximo de 5.500 caracteres mede o JSON completo serializado,
  incluindo estrutura, nomes de campos e conteúdo. A ferramenta mantém um
  prefixo ordenado de fontes completas e só marca `budgetLimited` quando uma
  fonte relevante é efetivamente omitida. Caracteres não representam garantia
  de tokens para um modelo ou tokenizador.
- O conteúdo FAQ é documentado como dado não confiável: a integração futura deve
  enviá-lo como resultado de ferramenta, nunca como instrução de sistema, e deve
  preservar `not_found` sem inventar política, prazo ou procedimento.

Validações executadas:

- `validate:faq`: 25 documentos aprovados na distribuição `4/4/5/5/4/3`;
- testes específicos da ferramenta: 12/12 com índice falso e índice real;
- suíte completa do backend: 163/163;
- typecheck e build do backend aprovados;
- `git diff --check` aprovado.

A suíte completa foi executada fora do sandbox devido aos testes preexistentes
que criam links simbólicos e renomeiam fixtures temporárias no Windows. Não foram
implementados orquestrador, ciclo de tool calling, endpoint, OpenRouter, frontend
ou alterações de catálogo e FAQs.

## 4.4 — Testar o RAG independentemente do LLM

- [x] Escrever 8–10 perguntas de frete, pagamento, devolução e casos sem fonte.
- [x] Testar se o trecho correto aparece no top-3, sem usar a API paga.
- [x] Documentar limites da busca textual e casos em que resposta deve ser encaminhada para atendimento humano fictício.

**Aceite:** testes de recuperação passam localmente e podem rodar em CI sem chave OpenRouter.  
**Commit:** `test(rag): cover retrieval and unknown answers`.

**Relatório:** [Avaliação independente do RAG textual](../agente/docs/04.4-rag-evaluation.md).

### Registro de execução — 08/11/2026

- O golden set versionado contém 10 perguntas definidas pelas políticas: 7 com
  fonte documentada e 3 com condições inexistentes. As 5 consultas desconhecidas
  anteriores são reutilizadas como regressão adicional, sem duplicação.
- Recall@3 e Top-1 atingiram `7/7`; as 8 consultas sem política tiveram `0`
  falsos positivos e `8/8` rejeições corretas. A integridade das fontes foi
  `7/7`, com metadados e conteúdo idênticos aos documentos canônicos.
- A ferramenta canônica retornou `found` nos 7 casos cobertos e `not_found` nos
  3 casos principais sem política. Não expôs score, URL, caminho ou nome físico,
  preservou as fontes completas e manteve o JSON abaixo de 5.500 caracteres; o
  maior retorno observado teve 490 caracteres.
- Nenhum caso falhou. O algoritmo, a ferramenta, as FAQs e o catálogo não foram
  alterados para obter os resultados.
- O relatório documenta dependência de vocabulário, ausência de compreensão
  semântica ampla, limites de generalização e encaminhamento externo apropriado
  para questões clínicas, sem prometer atendimento humano HidraSplash.

Validações executadas:

- testes específicos da avaliação: 4/4;
- `validate:faq`: 25 documentos aprovados na distribuição `4/4/5/5/4/3`;
- suíte completa do backend: 167/167;
- typecheck e build do backend aprovados;
- `git diff --check` aprovado.

A suíte completa foi executada fora do sandbox devido aos testes preexistentes
que criam links simbólicos e renomeiam fixtures temporárias no Windows. Toda a
avaliação foi local e não utilizou chave OpenRouter, LLM, embedding, banco
vetorial ou serviço pago.

## Limite de segurança

FAQ e descrições de produto são **dados não confiáveis** para fins de prompt. O backend deve tratá-los como contexto, nunca como comandos a executar. Não inventar status de pedidos: somente dados simulados explicitamente modelados podem ser consultados.
