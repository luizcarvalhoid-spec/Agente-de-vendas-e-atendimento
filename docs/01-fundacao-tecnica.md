# 01 — Fundação técnica e contratos

**Objetivo:** organizar a base atual e preparar um backend pequeno, testável, com dados e chaves fora do navegador.  
**Depende de:** [diagnóstico 00](./00-estado-atual.md). **Entrega:** frontend atual preservado + API mínima funcionando.

## 1.1 — Auditoria e baseline local

- [x] Inspecionar árvore atual, scripts, imports e componentes; verificar se existe backend em outro caminho.
- [x] Executar e registrar resultado de `Frontend`: instalação, lint, build e execução local.
- [x] Identificar ações apenas visuais (busca, filtros, carrinho, chat) sem implementá-las nesta seção.
- [x] Corrigir apenas erros bloqueantes de build; evitar refatoração estética não solicitada.

**Aceite:** frontend inicia e o estado atual (funciona/não funciona) está documentado em uma nota de PR ou issue, com evidência dos comandos.  
**Sugestão de commit:** `chore: establish frontend development baseline`.

### Registro do baseline — 06/11/2026

**Status:** concluída; verificações técnicas e inspeção visual manual aprovadas.

**Ambiente e estrutura**

- Branch `main` no commit `066a6bd`, alinhada a `origin/main` antes das alterações da tarefa.
- Node.js `v24.18.0`.
- `Backend/` existe, mas está vazio; não foi encontrado backend em outro caminho.
- O lockfile usa o formato `9.0`. O estado local de `node_modules` registra `pnpm@11.25.0`, versão usada na instalação congelada sem alterar `package.json` ou o lockfile.
- `docs/` já estava como diretório não rastreado e foi preservado.

**Comandos e resultados**

| Comando | Resultado |
| --- | --- |
| `corepack pnpm@11.25.0 install --frozen-lockfile` | Sucesso; dependências já estavam atualizadas, concluído com pnpm 11.25.0. |
| `npm run lint` | Sucesso após adicionar a configuração ausente do ESLint; zero erros e zero avisos. |
| `npm run build` | Sucesso; TypeScript e Vite compilaram 1.519 módulos em aproximadamente 30 segundos. |
| `npm run dev -- --host 127.0.0.1 --port 4173 --strictPort` | Sucesso; Vite ficou pronto em menos de 1 segundo. |

O lint inicialmente encerrava com código 2 porque o projeto não possuía arquivo de configuração. Foi criado `Frontend/.eslintrc.cjs`, compatível com ESLint 8.57.1 e com os plugins já declarados, sem instalar ou atualizar dependências.

**Ações somente visuais identificadas (não implementadas nesta tarefa)**

- A busca altera apenas o estado local do texto; o botão não executa pesquisa.
- Os filtros mantêm “Todos” visualmente selecionado e não filtram os produtos.
- “Ver mais produtos” não possui ação.
- O contador do carrinho permanece fixo em `2`; conta e carrinho não navegam.
- O card e “Adicionar ao Carrinho” não possuem ação.
- Abrir, minimizar, fechar e enviar no chat funcionam localmente, mas a resposta do bot continua simulada por `setTimeout` e texto fixo.

**Inspeção visual manual**

O navegador integrado não conseguiu acessar o servidor local e retornou `net::ERR_CONNECTION_TIMED_OUT`. Uma requisição HTTP direta a `127.0.0.1` também foi bloqueada pelo isolamento entre os ambientes, mesmo após a tentativa autorizada fora do sandbox. A validação foi concluída manualmente pelo responsável em 06/11/2026, sem problemas bloqueantes:

- [x] Em aproximadamente 1440 px, confirmar cabeçalho, barra de anúncio, quatro colunas de produtos e chat sem sobreposição.
- [x] Em aproximadamente 768 px, confirmar duas colunas e filtros com rolagem horizontal utilizável.
- [x] Em aproximadamente 375 px, confirmar uma coluna, ausência de rolagem horizontal da página e chat contido na viewport.
- [x] Confirmar que logo, ícone de destaque, avatar do chat e as oito imagens de produto carregam sem 404.
- [x] Abrir, minimizar e fechar o chat; enviar uma mensagem e confirmar a resposta simulada e o indicador de digitação.
- [x] Confirmar que busca, filtros, conta, carrinho, cards e “Ver mais produtos” permanecem sem comportamento funcional, conforme o baseline.

## 1.2 — Criar backend Fastify e TypeScript

- [x] Criar `Backend/` sem substituir `Frontend/`.
- [x] Configurar TypeScript, Fastify, `tsx` para desenvolvimento e scripts `dev`, `build`, `start`, `test`.
- [x] Implementar `GET /api/health` retornando status e versão de demonstração.
- [x] Configurar CORS para a origem local do Vite, sem wildcard indiscriminado.
- [x] Separar módulos por finalidade (`catalog`, `faq`, `agent`, `telemetry` conforme surgirem), sem arquiteturas genéricas.

**Aceite:** API sobe localmente e `GET /api/health` retorna HTTP 200; backend compila.  
**Sugestão de commit:** `feat(api): bootstrap Fastify service`.

### Registro da entrega 1.2 — 06/11/2026

**Status:** concluída; implementação, testes automatizados, build e smoke test aprovados.

**Alterações e decisões**

- Criado backend independente em `Backend/`, sem alterações funcionais no frontend.
- Adotados Fastify 5, TypeScript com ESM `NodeNext` e `tsx` para desenvolvimento e testes.
- Separadas a composição da aplicação (`app.ts`) e a abertura da porta (`server.ts`) para permitir testes sem socket.
- Implementado `GET /api/health` com status, nome do serviço e versão explicitamente demonstrativa.
- CORS limitado a `http://localhost:5173` e `http://127.0.0.1:5173`, sem wildcard ou credenciais.
- Registrado o [ADR-001](./decisions/ADR-001-backend-modular-fastify.md) para a arquitetura modular monolítica.
- Autorizado somente o script de instalação do `esbuild`, dependência do `tsx`, por meio de `Backend/pnpm-workspace.yaml`.

**Dependências resolvidas no lockfile**

- Produção: `fastify@5.12.8` e `@fastify/cors@11.4.1`.
- Desenvolvimento: `typescript@5.9.3`, `tsx@4.23.15` e `@types/node@24.19.2`.

**Comandos e resultados**

| Comando | Resultado |
| --- | --- |
| `corepack pnpm@11.25.0 install --frozen-lockfile` | Sucesso; lockfile validado e `esbuild` construído com autorização restrita. |
| `npm test` | Sucesso; 4 testes passaram: contrato health, origem permitida, origem bloqueada e preflight CORS. |
| `npm run build` | Sucesso; TypeScript gerou `dist/server.js`. |
| Smoke test de `dist/server.js` em `127.0.0.1:3333` | Sucesso; HTTP 200 e JSON esperado, seguido do encerramento do processo. |

**Pendências deliberadas**

- Configuração validada de ambiente, Zod e padrão de erros permanecem na tarefa 1.3.
- Não foram adicionados autenticação, multi-tenancy, banco, Docker, microsserviços ou infraestrutura remota.

## 1.3 — Contratos e validação

- [x] Escolher a forma simples de compartilhar contratos: tipos espelhados e documentados ou `shared/` somente se necessário.
- [x] Instalar Zod no backend para validar entradas da API, dados dos produtos e saída das ferramentas.
- [x] Definir padrão JSON para erros (`code`, `message`) e status HTTP.
- [x] Definir configuração central de ambiente (`PORT`, `FRONTEND_ORIGIN`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`) sem valores reais versionados.
- [x] Criar `Backend/.env.example` e revisar `.gitignore` para `.env`, `.env.*` (exceto exemplos), logs, `node_modules` e `dist`.

**Aceite:** variáveis obrigatórias são validadas; nenhuma chave vai para `VITE_*` ou bundle do navegador; exemplos permitem configurar o projeto.  
**Sugestão de commit:** `chore(api): add contracts and env validation`.

### Registro da entrega 1.3 — 06/11/2026

**Status:** concluída; contratos atuais, configuração, erros, testes, build e smoke tests aprovados.

**Alterações e decisões**

- Adicionado `zod@4.6.7` somente ao backend e atualizado `engines.node` para `>=22`.
- Mantidos contratos no backend, com tipos inferidos dos schemas Zod; não foi criado pacote `shared/` nem alterado o frontend.
- Criados os contratos atuais `HealthResponse` e `ApiError`; schemas de catálogo, FAQ e ferramentas serão criados apenas com seus respectivos módulos.
- `buildApp()` agora exige `AppConfig` por injeção explícita e não lê `process.env` durante imports.
- `PORT` e `FRONTEND_ORIGIN` possuem padrões locais validados. As variáveis OpenRouter são opcionais nesta fase, mas precisam ser fornecidas em conjunto.
- `FRONTEND_ORIGIN` aceita somente uma origem HTTP/HTTPS, sem caminho, query, fragmento ou credenciais.
- Padronizadas respostas `{ code, message }` para validação (400), rota inexistente (404), outros erros 4xx e erros internos (500).
- Mensagens de Zod, Fastify e exceções inesperadas não são devolvidas ao cliente.
- Criado `Backend/.env.example` sem valores reais e ampliado `.gitignore` para variações de `.env` e logs, preservando arquivos de exemplo.
- Não foi criado novo ADR: as mudanças implementam a independência e a arquitetura modular já aceitas no ADR-001.

**Comandos e resultados**

| Comando | Resultado |
| --- | --- |
| `corepack pnpm@11.25.0 install --frozen-lockfile` | Sucesso após atualizar o lockfile com Zod. |
| `npm test` | Sucesso; typecheck e 22 testes passaram, incluindo os 4 testes anteriores. |
| `npm run build` | Sucesso; TypeScript gerou o backend compilado em `dist/`. |
| Smoke test de `dist/server.js` sem credenciais OpenRouter | Sucesso; HTTP 200 e JSON esperado em `127.0.0.1:3333`. |
| Startup com configuração OpenRouter incompleta | Bloqueado com código 1; mensagem sanitizada e valor secreto sentinela ausente da saída. |

**Pendências deliberadas**

- O frontend espelhará somente o contrato mínimo necessário quando o cliente HTTP for criado na tarefa 1.4.
- Schemas de produtos, FAQ e ferramentas serão implementados junto aos dados e endpoints reais de suas etapas.
- A chave e o modelo OpenRouter só se tornarão obrigatórios quando a integração real for implementada, sem expor segredos no navegador.

## 1.4 — Integração de desenvolvimento

- [x] Criar cliente HTTP mínimo no frontend com URL da API via `VITE_API_URL` (somente endereço público, nunca segredo).
- [x] Exibir estado amigável se a API estiver indisponível em um teste isolado; não integrar ainda o chat.
- [x] Registrar comandos de inicialização do frontend e backend em documentação curta.
- [x] Fazer teste local de requisição `Frontend → Backend /api/health`.

**Aceite:** integração HTTP funciona localmente, sem backend exposto no bundle como segredo, e passos de execução são reproduzíveis.  
**Sugestão de commit:** `chore: connect frontend to API base URL`.

### Execução local

Use Node.js `>=22` e pnpm `11.25.0` via Corepack. Os pacotes continuam independentes e devem ser instalados e iniciados em terminais separados.

1. Em `Backend/`, copie `.env.example` para `.env`, execute `corepack pnpm@11.25.0 install --frozen-lockfile` e `npm run dev`.
2. Em `Frontend/`, copie `.env.example` para `.env`, execute `corepack pnpm@11.25.0 install --frozen-lockfile` e `npm run dev -- --host localhost --port 5173 --strictPort`.
3. Abra `http://localhost:5173` e confirme o indicador “API disponível”. O health check pode ser consultado diretamente em `http://127.0.0.1:3333/api/health`.

`VITE_API_URL=http://127.0.0.1:3333` é o endereço público acessado pelo navegador. `FRONTEND_ORIGIN=http://localhost:5173` é a origem que o backend autoriza no CORS. Se o Vite for aberto em `http://127.0.0.1:5173`, altere também `FRONTEND_ORIGIN` para esse valor exato. Mudanças em `.env` exigem reiniciar o respectivo servidor, e o backend deve ser iniciado dentro de `Backend/` porque carrega `.env` relativamente ao diretório de execução.

Em caso de “API indisponível”, confirme se os dois processos estão ativos, se a porta 3333 responde, se `VITE_API_URL` contém apenas uma origem HTTP/HTTPS e se a origem exibida pelo Vite coincide exatamente com `FRONTEND_ORIGIN`. O uso de `--strictPort` impede que uma porta alternativa cause falha de CORS silenciosa.

### Registro da entrega 1.4 — 06/11/2026

**Status:** concluída; integração, verificações automatizadas, smoke test e inspeção visual assistida aprovados.

**Alterações e decisões**

- Criado cliente baseado no `fetch` nativo, sem dependências adicionais, com tratamento separado de configuração, rede, status HTTP e resposta incompatível.
- Espelhados somente os contratos atuais `HealthResponse` e `ApiError`, com validação manual do JSON recebido; o frontend não importa código do backend.
- `VITE_API_URL` aceita somente uma origem HTTP/HTTPS sem credenciais, caminho, query ou fragmento. Ausência ou valor inválido produz o estado “API indisponível” sem interromper a vitrine.
- O diagnóstico é renderizado por `App.tsx` apenas quando `import.meta.env.DEV` é verdadeiro, usa `pointer-events: none` e permanece isolado de `CategoryPage.tsx` e do chat.
- A consulta possui timeout de 5 segundos e cleanup com `AbortController`; desmontagens do `StrictMode` não atualizam estado nem geram falso erro visual.
- `Frontend/.env.example` contém somente o endereço público da API. Nenhuma variável privada ou credencial foi adicionada ao frontend.
- Não foi criado novo ADR: a solução aplica a independência entre os pacotes definida no ADR-001.

**Verificações automatizadas**

| Comando ou verificação | Resultado |
| --- | --- |
| Instalação congelada em `Frontend/` e `Backend/` | Sucesso com pnpm 11.25.0; lockfiles permaneceram inalterados. |
| `tsc -p tsconfig.app.json --noEmit` | Sucesso no frontend. |
| `npm run lint` em `Frontend/` | Sucesso; zero erros e avisos. |
| `npm run build` em `Frontend/` | Sucesso; Vite compilou 1.522 módulos. |
| `npm test` em `Backend/` | Sucesso; os 22 testes existentes passaram. |
| `npm run build` em `Backend/` | Sucesso. |
| Smoke HTTP real com origem `http://localhost:5173` | HTTP 200, contrato esperado e `Access-Control-Allow-Origin` correto. |
| Varredura de arquivos e bundle | Nenhuma credencial encontrada; o diagnóstico de desenvolvimento não aparece no bundle de produção. |

**Verificações manuais assistidas no navegador**

- Com `VITE_API_URL` ausente e a API parada, a vitrine continuou funcional e exibiu “API indisponível”.
- Com frontend e backend ativos, a requisição real chegou a `/api/health` com HTTP 200 e o indicador exibiu “API disponível”.
- Em viewport móvel de 375 × 812, não houve rolagem horizontal nem sobreposição entre diagnóstico e chat; o diagnóstico permaneceu sem interceptar eventos.
- A interface existente, os oito produtos, filtros, imagens e botão do chat permaneceram visíveis nos estados disponível e indisponível.

**Observação do ambiente**

A porta 5173 estava ocupada durante a inspeção e o processo responsável não foi alterado. A validação visual foi executada temporariamente em `127.0.0.1:4173`, com `FRONTEND_ORIGIN` correspondente; o smoke de CORS também validou separadamente a origem documentada `http://localhost:5173`.

## Fora de escopo

Docker, microserviços, autenticação, orquestração, monorepo complexo e banco remoto. Preserve os arquivos, nomes e estilos existentes quando não houver justificativa funcional para alterá-los.
