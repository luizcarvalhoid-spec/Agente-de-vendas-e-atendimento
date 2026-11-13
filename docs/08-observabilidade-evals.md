# 08 — Observabilidade e avaliações (Evals)

**Objetivo:** demonstrar capacidade de medir custo, qualidade e confiabilidade de um agente, além de exibir a interface de chat.  
**Depende de:** fases 05–07.

## 8.1 — Telemetria segura por requisição

- [ ] Gerar `requestId` por chamada e coletar: modelo, latência, status, ferramentas acionadas, número de chamadas, tokens de entrada/saída **quando retornados** e custo estimado **quando calculável**.
- [ ] Registrar falhas e timeouts sem armazenar API key, texto integral de conversas ou dados pessoais.
- [ ] Implementar buffer em memória ou arquivo local ignorado pelo Git para a demonstração; persistência durável **não é obrigatória**.
- [ ] Separar medidas reais de valores estimados, inclusive quando o provedor não retorna usage.

**Aceite:** ao conversar, uma execução exibe traces mínimos verificáveis, sem expor segredos.  
**Commit:** `feat(agent): capture safe request telemetry`.

## 8.2 — Página técnica de observabilidade

- [ ] Criar `/demo/observabilidade` ou página equivalente com últimas requisições, latência, tools, resultado e token usage.
- [ ] Exibir estados vazios, erro e ausência de métricas de custo; não fabricar dados ao vivo.
- [ ] Em demo pública **sem autenticação**, não exibir prompts privados, IPs, histórico de clientes ou logs de visitantes; usar dados agregados, simulados claramente rotulados ou limitar acesso local.
- [ ] Criar link discreto para o painel no README, deixando claro que é uma visão técnica e não uma conta administrativa.

**Aceite:** painel mostra um exemplo real em ambiente local e não expõe informações de outros visitantes se publicado.  
**Commit:** `feat(web): add agent observability view`.

## 8.3 — Testes determinísticos com mocks

- [x] Testar schema de produtos, restrições, ranking, FAQ, carrinho, erros do chat e validação do backend.
- [x] Mockar OpenRouter: CI não depende de chave nem gasta tokens.
- [x] Criar casos de ferramenta inexistente, ciclo acima do limite, resposta inválida, produto indisponível e preço não confiável vindo do LLM.
- [x] Garantir que cada teste tenha expectativa objetiva, evitando comparar textos livres palavra por palavra.

**Aceite:** suíte automatizada passa offline e sinaliza regressões funcionais.  
**Commit:** `test: cover deterministic agent flows`.

## 8.4 — Conjunto de avaliações qualitativas

- [ ] Criar cerca de **30 cenários** versionados: anticaspa genérico, perfil completo, sensibilidade, orçamento, comparação, carrinho, FAQ, falta de fonte, tentativas de manipular prompt e falhas de API.
- [ ] Para cada cenário, registrar condições iniciais, comportamento esperado e verificações: produto permitido, exclusões, ferramenta certa, justificativa, ausência de invenções.
- [ ] Construir script manual ou semiautomatizado para executar cenários reais com OpenRouter em ambiente controlado.
- [ ] Consolidar taxa de acerto **medida**, casos falhos, modelo avaliado, data e limitações; não prometer 100% de acerto.
- [ ] Separar testes determinísticos (CI) de evals com LLM (manuais/opt-in por custo e variabilidade).

**Aceite:** relatório reproduzível mostra o que foi testado, critérios e resultados reais, inclusive falhas.  
**Commit:** `test(evals): add sales assistant scenarios`.

## 8.5 — Evidências para portfólio

- [ ] Salvar capturas de tela do painel **sem dados sensíveis** e amostras de fluxos reais.
- [ ] Documentar metodologia e limitações, não só números bonitos.
- [ ] Escolher 2–3 casos representativos para vídeo e README.

**Aceite:** há demonstração técnica do funcionamento e não apenas afirmação de que a IA “é inteligente”.  
**Commit:** `docs: publish agent evaluation approach`.

## Auditoria de progresso (12/11/2026)

- **8.1 parcial:** o [PR #22](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/22) incluiu eventos operacionais sanitizados, limites e reconciliação de uso. Não equivale à telemetria consultável exigida por 8.1; os itens permanecem pendentes para aceite.
- **8.2 não entregue:** painel técnico ainda não implementado.
- **8.3 coberta offline:** as suítes para contratos, catálogo, FAQ, falhas, ferramentas, carrinho e jornada usam modelos/transportes falsos. O [PR #28](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/28) registrou 378 testes backend e 129 frontend aprovados; o [PR #35](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/35) registrou 439 testes backend aprovados. São resultados de momentos diferentes, não somáveis.
- **8.4 em preparação:** há [12 cenários de MVP](../Backend/test/fixtures/mvp-journey-cases.json) e [15 jornadas de humanização](./agent-humanization-evaluation.md), ambos offline e com objetivos diferentes. Não declarar 27 casos únicos nem avaliação real de LLM. Falta dataset consolidado de cerca de 30 casos com `id`, `input`, estado inicial e verificações objetivas; uma rubrica (incluindo eventual nota de 1 a 10), executor controlado, modelo/data, custos e relatório de acertos/falhas reais.
- **8.5 pendente:** evidências de uso real, capturas e vídeo não foram registradas como concluídas.

**Próxima tarefa sugerida:** construir a especificação do dataset e a rubrica de notas **antes** de automatizar a execução, para que um `eval.py` futuro não transforme similaridade textual ou impressões subjetivas em nota sem critério. Executar modelos reais somente com autorização de custo e sem credenciais em artefatos versionados.
