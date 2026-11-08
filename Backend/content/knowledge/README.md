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

## Validação

Execute dentro de `Backend/`:

```bash
corepack pnpm@11.25.0 validate:faq
npm test
npm run build
git diff --check
```

`validate:faq` não modifica conteúdo. Código de saída `0` indica base válida; `1` impede a publicação editorial.
