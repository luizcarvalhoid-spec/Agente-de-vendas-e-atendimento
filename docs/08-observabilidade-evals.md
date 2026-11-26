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

- [ ] Ampliar os oito cenários iniciais para cerca de **30 cenários** versionados, seguindo a cobertura planejada. [Dataset inicial](../Backend/evals/datasets/README.md)
- [x] Registrar estado inicial, comportamento esperado por turno, assertions objetivas e critérios de revisão nos oito cenários iniciais. [Contrato de datasets](../Backend/evals/README.md)
- [x] Executar um primeiro teste comercial real e controlado com OpenRouter. A R4 aprovou um cenário pelo terminal. [Registro da R4](../Backend/evals/OPENROUTER_COMMERCIAL_EXPERIMENT.md#resultado-da-r4-em-26112026)
- [ ] Ampliar a avaliação real opt-in e registrar taxa de acerto medida, casos falhos, modelo, data e limitações. Registrar a revisão humana nas dimensões aplicáveis.
- [x] Separar a execução determinística offline de execuções opt-in com LLM real. [Executor offline](../Backend/evals/README.md#executor-offline-eval-03)

**Aceite:** relatório reproduzível mostra o que foi testado, critérios e resultados reais, inclusive falhas.  
**Commit:** `test(evals): add sales assistant scenarios`.

## 8.5 — Evidências para portfólio

- [ ] Salvar capturas de tela do painel **sem dados sensíveis** e amostras de fluxos reais.
- [ ] Documentar metodologia e limitações, não só números bonitos.
- [ ] Escolher 2–3 casos representativos para vídeo e README.

**Aceite:** há demonstração técnica do funcionamento e não apenas afirmação de que a IA “é inteligente”.  
**Commit:** `docs: publish agent evaluation approach`.

## Auditoria de progresso (26/11/2026)

- **8.1 parcial.** O backend emite eventos sanitizados e reconcilia uso. A R4 registrou uso e custo estimado no terminal. A telemetria consultável por requisição e o aceite completo da 8.1 seguem pendentes. [PR #22](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/22)
- **8.2 pendente.** O painel técnico ainda precisa ser implementado e validado.
- **8.3 coberta offline.** As suítes para contratos, catálogo, FAQ, falhas, ferramentas, carrinho e jornada usam modelos ou transportes falsos. Os 12 cenários de MVP e as 15 jornadas de humanização são suítes complementares aos datasets iniciais. [Cenários do MVP](../Backend/test/fixtures/mvp-journey-cases.json) · [Jornadas de humanização](./agent-humanization-evaluation.md)
- **8.4 parcial.** A infraestrutura está mesclada. A R4 aprovou um cenário comercial real com GPT-6 Luna via OpenRouter (Azure). O registro da rodada contém evidência técnica e comercial. A avaliação humana por dimensão permanece pendente. [Registro da R4](../Backend/evals/OPENROUTER_COMMERCIAL_EXPERIMENT.md#resultado-da-r4-em-26112026)
- **8.5 parcial.** O resultado sanitizado da R4 já está registrado. Capturas do painel, vídeo e seleção de casos para o portfólio seguem pendentes.

### EVAL-01 a EVAL-08 mescladas

| Etapa | Entrega |
| --- | --- |
| **EVAL-01** | Contrato versionado em Zod e loader JSON, com expectativas por turno e assertions tipadas. [PR #37](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/37) |
| **EVAL-02** | Oito cenários iniciais em quatro datasets universais e da HidraSplash. [PR #38](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/38) |
| **EVAL-03** | Executor determinístico offline multi-turno com traces sanitizados. [PR #39](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/39) |
| **EVAL-04** | Motor de assertions e pontuação objetiva de 1 a 10, com sinalização de evidência insuficiente. [PR #40](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/40) |
| **EVAL-05** | Relatórios objetivos offline em JSON e Markdown. [PR #41](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/41) |
| **EVAL-06** | Rubrica e fluxo local de revisão humana independente por dimensão, com fixtures sintéticas. [PR #42](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/42) · [Rubrica e revisão](../Backend/evals/HUMAN_REVIEW.md) |
| **EVAL-07** | Preflight, integração externa simulada e controles de autorização do canário protegido. O experimento comercial em terminal registrou a execução real da R4. [Integração simulada](../Backend/evals/EXTERNAL_EVAL.md) · [Canário protegido](../Backend/evals/OPENROUTER_LUNA_CANARY.md) · [PR #60](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/60) |
| **EVAL-08** | Quatro baselines objetivos versionados e comparação de regressões com checagem de compatibilidade. [PR #43](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/43) · [Baselines](../Backend/evals/BASELINES.md) |

Nos quatro baselines, **33 de 35 assertions passaram** e duas falhas conhecidas
do cenário de prompt injection foram preservadas. Esses números descrevem o
modelo determinístico offline. A R4 tem seu próprio resultado comercial
`passed` para um cenário, com endpoint exato e cobrança efetiva ainda não
verificados.

**Aceite geral da fase 08 pendente.** Falta ampliar a cobertura dos datasets e
das avaliações reais, registrar revisões humanas e concluir telemetria,
painel e evidências de portfólio.
