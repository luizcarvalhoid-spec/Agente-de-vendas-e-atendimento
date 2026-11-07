# Fluxo editorial do catálogo HidraSplash

Este diretório é o CMS leve do projeto demonstrativo. Não existe painel administrativo, banco de dados, upload HTTP ou integração com estoque real. As alterações são feitas em arquivos, validadas localmente, revisadas no Git e carregadas pela API quando o backend inicia.

## Arquivos e responsabilidades

- `products.json`: fonte canônica dos produtos servidos pela API e consultados internamente pelo backend.
- `images/`: arquivos efetivamente referenciados pelos produtos.
- `image-manifest.json`: registro de proveniência e hashes das 27 imagens do catálogo inicial. O manifesto ajuda a auditar a migração original, mas não substitui `products.json` nem alimenta a API.
- `commercial-products.json`: inventário editorial intermediário preservado como histórico; não é fonte de produção.

A validação atual confirma schema, extensão permitida, existência do arquivo, tipo de entrada no sistema de arquivos e isolamento dentro da raiz do catálogo. Ela não faz análise integral do conteúdo binário, qualidade visual, direitos autorais ou correspondência entre a foto e uma formulação.

## Adicionar um produto

1. Trabalhe em uma branch dedicada criada a partir da `main` atualizada.
2. Copie uma imagem real para `images/`. Use JPG, PNG ou WebP, nome estável em lowercase com hífens e um arquivo físico — não use symlink ou junction.
3. Abra `products.json` e copie a estrutura de um produto da mesma área de aplicação e categoria. Produtos capilares e corporais possuem campos de compatibilidade diferentes.
4. Escolha um `id` inteiro positivo ainda não utilizado. Para inclusão normal, use o próximo ID disponível; não renumere produtos existentes.
5. Escolha um `slug` único em lowercase kebab-case. O slug é usado pela URL de detalhes e deve permanecer estável.
6. Ajuste identidade, categoria, subcategoria, descrições, preço, estoque, variante, tags, indicações e benefícios. Não deixe strings vazias ou listas obrigatórias vazias.
7. Aponte `image` e, quando necessário, `images` para caminhos relativos dentro deste diretório, por exemplo `images/novo-produto.jpg`.
8. Revise preço original, rating e reviews conforme as regras do schema. Rating e reviews devem ser omitidos ou informados juntos.

## Classificação, formulação e segurança

Todo produto publicado neste catálogo demonstrativo deve manter:

```json
{
  "dataClassification": {
    "commercial": "fictional-demo",
    "compatibility": "commercial-positioning",
    "formulation": "synthetic-test-data",
    "safety": "not-evaluated"
  }
}
```

- Preços, estoques, perfis e alegações comerciais são fictícios para demonstração de software.
- Ingredientes estruturados são dados sintéticos de teste e não representam a formulação fotografada.
- Não use ingredientes sintéticos para afirmar segurança, compatibilidade com alergias ou eficácia clínica.
- `restrictions: []` e `contraindications: []` significam somente que nenhuma informação específica foi registrada; não comprovam ausência de risco.
- Modos de uso devem ser gerais e conservadores, sem frequência ou tempo de contato que dependam de avaliação da formulação.
- Kits continuam sendo um único produto comercial. Cada componente deve possuir formulação sintética, modo de uso e avisos próprios; não agregue ingredientes em uma fórmula única.

Se as informações não puderem ser publicadas sem alegação enganosa, não use placeholder em `products.json`. Mantenha o registro fora do catálogo canônico até a revisão editorial.

## Validar e revisar

Execute os comandos dentro de `Backend/`:

```bash
corepack pnpm@11.25.0 install --frozen-lockfile
pnpm validate:catalog
npm test
npm run build
git diff --check
```

`pnpm validate:catalog` lê somente `products.json`, usa os mesmos schemas e validação física do startup e não modifica arquivos. Código de saída `0` indica sucesso; código `1` indica que o catálogo não deve ser publicado.

Antes de solicitar revisão:

```bash
git status --short
git diff -- content/catalog
```

Arquivos novos ainda não rastreados não aparecem no `git diff` comum; confira-os também com `git status --short`.

Confirme que apenas o produto, suas imagens autorizadas e a documentação necessária foram alterados. Não versione `.env`, logs, `node_modules`, `dist` ou material editorial local.

Alguns testes protegem deliberadamente a composição aprovada de 27 produtos, a distribuição 14/5/4/4 e as seis alternativas anticaspa. Uma expansão permanente exige revisão consciente dessas expectativas e dos registros editoriais; não altere contagens apenas para fazer a suíte passar. O teste de extensibilidade usa um catálogo temporário com um produto 28 e não modifica esta base.

## Publicar no ambiente demonstrativo

Depois de revisão, commit, Pull Request e merge, reinicie o backend. O startup relê `products.json`, reconstrói os índices e disponibiliza o produto em `GET /api/products` e `GET /api/products/:slug`. Nenhum componente React precisa ser editado quando a vitrine estiver consumindo a API na tarefa 3.2.

Este fluxo é adequado ao portfólio HidraSplash. Ele não substitui PIM, ERP, revisão regulatória, controle de acesso, auditoria comercial ou gestão de estoque de uma operação real.
