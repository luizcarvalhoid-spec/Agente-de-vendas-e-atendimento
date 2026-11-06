# ADR-001 — Backend modular monolítico com Fastify e TypeScript

**Status:** Aceito

**Data:** 06/11/2026

## Contexto

A HidraSplash precisa de uma API pequena para catálogo, FAQ, agente e telemetria. O projeto é demonstrativo, sem autenticação, pagamentos reais ou requisitos de escala distribuída. O frontend React existente deve permanecer independente, e as credenciais futuras não podem chegar ao navegador.

## Alternativas consideradas

1. Fastify em um único serviço organizado por finalidade.
2. Express com organização e contratos definidos manualmente.
3. NestJS com módulos e injeção de dependência.
4. Microsserviços ou funções serverless separadas.

## Decisão

Adotar um único serviço Node.js e TypeScript com Fastify 5:

- `Frontend/` e `Backend/` permanecem pacotes independentes, sem workspace ou orquestração na raiz;
- a composição da aplicação fica separada da abertura da porta;
- rotas e módulos são organizados por finalidade somente quando surgirem;
- testes usam `node:test` e `fastify.inject()`;
- CORS aceita somente origens locais explícitas nesta etapa;
- segredos permanecem exclusivamente no backend nas etapas futuras.

## Consequências

### Positivas

- Poucas dependências e inicialização simples.
- Testes rápidos sem servidor HTTP real para cada caso.
- Estrutura suficiente para catálogo, FAQ, agente e telemetria.
- Menor risco de expor chaves no bundle do frontend.

### Negativas

- O serviço escala como uma unidade.
- Não há injeção de dependência ou scaffolding automático.
- A lista CORS inicial será substituída pela configuração de ambiente validada na tarefa 1.3.

## Fora de escopo

Autenticação, multi-tenancy, banco remoto, Docker, filas, microsserviços, gateway de API, painel administrativo e infraestrutura serverless.
