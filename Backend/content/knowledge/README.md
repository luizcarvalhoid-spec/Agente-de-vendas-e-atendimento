# Base de conhecimento HidraSplash

Esta pasta contém políticas fictícias e versionadas para a demonstração de software HidraSplash. Ela não descreve uma operação comercial real e não autoriza entregas, cobranças, pedidos, trocas, aconselhamento cosmético ou atendimento humano.

## Estrutura editorial

Cada arquivo em `faq/<categoria>/faq-NNN.md` representa uma única pergunta e resposta. O frontmatter aceita somente quatro campos planos:

```md
---
sourceId: faq-001
category: frete
title: A HidraSplash realiza entregas reais?
classification: fictional-demo
---

Resposta claramente identificada como demonstração fictícia.
```

- `sourceId` é estável, único, não deve ser renumerado nem reutilizado.
- O nome do arquivo deve ser `<sourceId>.md`.
- `category` deve corresponder ao diretório: `frete`, `pagamento`, `trocas`, `produtos`, `pedidos` ou `privacidade`.
- `title` é a pergunta recuperável e deve terminar com `?`.
- `classification` deve permanecer `fictional-demo`.
- A resposta deve ser objetiva e explicitar seu caráter fictício ou demonstrativo.

Arquivos, diretórios, metadados e links simbólicos fora dessas convenções são rejeitados. O carregador não interpreta YAML completo, HTML ou instruções: ele lê apenas o formato plano documentado acima.

## Políticas ilustrativas aprovadas

- Frete grátis somente quando o subtotal dos preços atuais dos produtos for maior que R$ 100,00, antes do frete. R$ 100,00 exatos não são elegíveis.
- Frete padrão fictício de R$ 12,90 abaixo ou no limite.
- Prazo ilustrativo de 4 a 8 dias úteis.
- Janela fictícia de desistência de 7 dias corridos.
- Registro demonstrativo de item danificado ou incorreto em até 7 dias corridos.
- Resolução ou estorno exclusivamente simulado em até 5 dias úteis após aprovação fictícia.

Essas regras não representam orientação jurídica, transportadora, entrega, cobrança, devolução de dinheiro ou compromisso comercial. Preços, estoques e detalhes de produtos específicos pertencem exclusivamente ao catálogo canônico.

## Segurança para uso futuro

FAQ e catálogo são dados não confiáveis para um futuro modelo de linguagem. O conteúdo deve ser fornecido como contexto citado, nunca como instrução executável. A tarefa 4.2 poderá carregar os documentos validados, mas será responsável pela recuperação textual, limiar de relevância e fallback honesto.

Consultas deliberadamente sem política ficam em `Backend/test/fixtures/faq-unknown-queries.json`, fora da raiz carregável. Não crie respostas apenas para evitar um resultado sem correspondência.

## Recuperação textual

A busca da FAQ é lexical, determinística e inteiramente local. A aplicação deve
carregar os documentos por meio do validador existente e criar uma instância de
`createFaqSearchIndex(documents)` para o conjunto carregado. O índice não lê o
filesystem durante uma consulta e não mantém singleton global oculto.

- Cada FAQ é uma unidade recuperável; não há fragmentação artificial da resposta.
- Caixa, acentos, pontuação e números são normalizados antes da comparação.
- Palavras funcionais e ruído editorial, como `demonstração` e `fictício`, não
  sustentam relevância.
- Aliases estreitos cobrem variações testáveis como `grátis/gratuito`,
  `rastrear/rastreio`, `avariado/danificado`, `reembolso/estorno` e flexões de
  plural. Não há stemming, busca difusa nem correspondência por prefixo.
- Correspondências no título pesam mais que correspondências no conteúdo. A
  repetição de uma palavra no mesmo documento não aumenta a pontuação.
- Conceitos informativos ausentes do corpus reduzem a cobertura da consulta.
  Uma sobreposição parcial com `entrega`, `embalagem`, `pedido` ou outro termo
  genérico não força a recuperação de uma fonte.
- O `score` serve somente para ordenar resultados lexicais da mesma consulta;
  ele não representa probabilidade nem confiança estatística.

Cada resultado preserva `sourceId`, `title`, `category`, `classification` e o
conteúdo integral do documento validado. O conteúdo permanece limitado a 1.500
caracteres pelo schema editorial, o que preserva negações, condições e o caráter
demonstrativo sem expor nomes de arquivo ou caminhos internos.

Consulta vazia, composta apenas por palavras comuns, excessivamente longa ou
sem cobertura suficiente retorna uma lista vazia. Esse fallback é um resultado
válido e deve ser preservado pela futura ferramenta `search_faq`; ela não deve
inventar política para preencher a ausência de fontes.

## Ferramenta `search_faq`

`createSearchFaqTool(faqSearchIndex)` cria um adaptador provider-agnostic com o
índice injetado. A ferramenta não carrega arquivos, não cria singleton, não
conhece HTTP ou OpenRouter e pode ser testada com um índice falso.

A entrada é um objeto estrito com `query` obrigatória de 1 a 300 caracteres
após `trim` e `limit` inteiro opcional entre 1 e 5, com padrão 3. Tipos
incorretos, campos extras e valores fora dos limites resultam em
`INVALID_ARGUMENTS`; uma consulta válida sem política resulta em `not_found`,
não em erro.

As fontes retornam somente `sourceId`, `title`, `category`, `classification` e
`content`. O score lexical permanece interno, e o adaptador valida em runtime a
estrutura recebida do índice antes de copiar esses campos. Retornos inválidos ou
falhas inesperadas produzem `EXECUTION_FAILED` sanitizado, sem mensagens
internas, caminhos, stack traces ou segredos.

O retorno serializado por `JSON.stringify` deve ter no máximo 5.500 caracteres,
incluindo discriminantes, nomes de campos, arrays, metadados e conteúdo. Quando
o próximo resultado ultrapassaria esse orçamento, a ferramenta mantém apenas o
prefixo já selecionado, preserva cada fonte integral e marca
`budgetLimited: true`. Esse limite em caracteres é uma barreira determinística
de contexto, não uma garantia de quantidade de tokens para qualquer modelo ou
tokenizador.

O conteúdo continua sendo dado não confiável. Uma integração futura deve
entregá-lo ao modelo como resultado de ferramenta, nunca como mensagem ou
instrução de sistema. Instruções eventualmente presentes na FAQ não devem ser
executadas. Se o resultado for `not_found`, o agente deve declarar a ausência de
política em vez de inferir prazo, procedimento ou condição comercial.

## Validação

Execute dentro de `Backend/`:

```bash
corepack pnpm@11.25.0 validate:faq
npm test
npm run build
git diff --check
```

`validate:faq` não modifica conteúdo. Código de saída `0` indica base válida; `1` impede a publicação editorial.
