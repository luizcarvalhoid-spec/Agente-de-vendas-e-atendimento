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

- [ ] Escolher a forma simples de compartilhar contratos: tipos espelhados e documentados ou `shared/` somente se necessário.
- [ ] Instalar Zod no backend para validar entradas da API, dados dos produtos e saída das ferramentas.
- [ ] Definir padrão JSON para erros (`code`, `message`) e status HTTP.
- [ ] Definir configuração central de ambiente (`PORT`, `FRONTEND_ORIGIN`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`) sem valores reais versionados.
- [ ] Criar `Backend/.env.example` e revisar `.gitignore` para `.env`, `.env.*` (exceto exemplos), logs, `node_modules` e `dist`.

**Aceite:** variáveis obrigatórias são validadas; nenhuma chave vai para `VITE_*` ou bundle do navegador; exemplos permitem configurar o projeto.  
**Sugestão de commit:** `chore(api): add contracts and env validation`.

## 1.4 — Integração de desenvolvimento

- [ ] Criar cliente HTTP mínimo no frontend com URL da API via `VITE_API_URL` (somente endereço público, nunca segredo).
- [ ] Exibir estado amigável se a API estiver indisponível em um teste isolado; não integrar ainda o chat.
- [ ] Registrar comandos de inicialização do frontend e backend em documentação curta.
- [ ] Fazer teste local de requisição `Frontend → Backend /api/health`.

**Aceite:** integração HTTP funciona localmente, sem backend exposto no bundle como segredo, e passos de execução são reproduzíveis.  
**Sugestão de commit:** `chore: connect frontend to API base URL`.

## Fora de escopo

Docker, microserviços, autenticação, orquestração, monorepo complexo e banco remoto. Preserve os arquivos, nomes e estilos existentes quando não houver justificativa funcional para alterá-los.
