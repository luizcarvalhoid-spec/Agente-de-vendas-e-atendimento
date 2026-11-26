# 05 — Agente conversacional com OpenRouter

**Objetivo:** trocar a resposta simulada por um agente de vendas consultivas com API real, contexto limitado e ferramentas.  
**Depende de:** fases 02 e 04. **Ponto de substituição:** `Frontend/src/Pages/ChatbotButton.tsx` na fase 06.

## 5.1 — Cliente OpenRouter seguro no backend

- [x] Integrar API OpenRouter **somente no backend**, com chave de ambiente e modelo configurável.
- [x] Escolher e registrar um modelo com suporte confirmado a **tool/function calling**. A R4 confirmou `openai/gpt-6-luna` via OpenRouter (Azure) no cenário comercial de 26/11/2026.
- [x] Definir timeouts, limites de tokens/resposta, tratamento de `429`, `5xx`, indisponibilidade e cancelamento.
- [x] Não registrar Authorization, prompt completo com segredos ou informações pessoais em logs.
- [x] Criar testes com cliente HTTP mockado; chamada real apenas em smoke test manual com chave própria.

**Aceite:** API real retorna resposta pelo servidor, e nenhum segredo fica em artefato do Vite ou controle de versão.  
**Commit:** `feat(agent): integrate OpenRouter client`.

**Status de entrega:** implementada e mesclada no PR #17. O cliente
backend-only, a configuração parametrizada, os limites, o cancelamento, a
sanitização, os testes offline e o script de smoke manual estão implementados.
A R4 confirmou a resposta do provedor e a compatibilidade de tool calling
para a configuração testada no terminal. [Resultado da R4](../Backend/evals/OPENROUTER_COMMERCIAL_EXPERIMENT.md#resultado-da-r4-em-26112026)

### Registro técnico da 5.1

O cliente usa `fetch` nativo do Node.js 22, endpoint fixo
`https://openrouter.ai/api/v1/chat/completions`, transporte injetável e
validação Zod. A chave e o modelo são recebidos da configuração central na
criação da instância. O cliente não acessa `process.env`, não registra payloads
e não realiza retries automáticos. A composição do cliente no servidor e a
rota HTTP foram entregues na 5.4.

Limites iniciais da aplicação:

- timeout padrão de 15 segundos e máximo configurável de 60 segundos;
- 512 tokens de saída por padrão e teto de 4.096;
- até 40 mensagens, 16 ferramentas e 100.000 bytes no payload serializado;
- até 20.000 caracteres por string de argumentos retornada;
- resposta HTTP de sucesso limitada a 250.000 bytes antes da validação.

Esses limites controlam memória, latência e custo. O ciclo limitado e o
orçamento agregado do agente são tratados nas tarefas 5.3 e 5.5.

#### Modelos consultados no catálogo em 09/11/2026

Os dados abaixo vieram do
[catálogo oficial da OpenRouter](https://openrouter.ai/api/v1/models). Preços
são em dólares por 1 milhão de tokens e podem mudar.

| Modelo | Entrada / saída | Contexto / saída máxima | Tools | Decisão |
| --- | ---: | ---: | --- | --- |
| `openai/gpt-4.1-mini` | US$ 0,40 / US$ 1,60 | 1.047.576 / 32.768 | `tools` e `tool_choice` | Modelo inicial sugerido; deve ser configurado em `OPENROUTER_MODEL`, nunca no cliente. |
| `google/gemini-3.1-flash-lite` | US$ 0,25 / US$ 1,50 | 1.048.576 / 65.536 | `tools` e `tool_choice` | Alternativa atual para avaliação de custo, latência e português brasileiro. |
| `google/gemini-2.5-flash-lite` | US$ 0,10 / US$ 0,40 | 1.048.576 / 65.535 | `tools` e `tool_choice` | Ainda constava no catálogo, sem expiração, apesar de avisos históricos divergentes sobre outubro de 2026; revalidar antes de cada adoção. |

O suporte declarado pelo catálogo orienta a escolha. A compatibilidade deve
ser verificada para cada combinação de modelo e rota que será adotada.

#### Smoke manual

Preencha `OPENROUTER_API_KEY` e `OPENROUTER_MODEL` no `.env` local do backend e
execute:

```bash
pnpm smoke:openrouter
```

O script realiza uma única chamada, com timeout de 10 segundos, no máximo 64
tokens e uma função fictícia `health_check` exigida por `tool_choice`. A função
não é executada. Os logs contêm somente estado sanitizado, modelo, motivo de
finalização, quantidade de chamadas e uso agregado quando disponível. Sem as
duas variáveis, o smoke informa que não foi executado e termina sem simular
sucesso. Ele não faz parte da suíte padrão nem do CI.

O aceite de tool calling registrado em 26/11/2026 veio da execução comercial
R4 pelo `ChatService` no terminal. [Resultado da R4](../Backend/evals/OPENROUTER_COMMERCIAL_EXPERIMENT.md#resultado-da-r4-em-26112026)

## 5.2 — Prompt e política consultiva

- [x] Definir papel: consultor de cosméticos da HidraSplash, cordial e objetivo, com português brasileiro.
- [x] Fazer perguntas **adaptativas**, uma de cada vez quando útil: necessidade, tipo de cabelo/couro cabeludo, sensibilidade, orçamento e preferência.
- [x] Aproveitar dados já fornecidos; não repetir perguntas respondidas nem usar roteiro rígido.
- [x] Recomendar somente produtos reais do catálogo e não inventar estoque, preço, ingrediente ou benefício.
- [x] Evitar diagnósticos médicos, curas garantidas e afirmações sem suporte; diante de sinais clínicos, orientar procurar profissional.
- [x] Declarar que é demonstração fictícia quando apropriado.

**Aceite:** em simulações, uma entrada genérica (“preciso de shampoo anticaspa”) leva a perguntas pertinentes; entrada completa permite recomendação direta.  
**Commit:** `feat(agent): define consultative sales behavior`.

**Status de entrega:** implementada e mesclada no PR #18. A política permanente
define persona consultiva, perguntas adaptativas, grounding, fallback e limites
clínicos. Os testes estáticos e os 15 cenários esperados estão versionados.
A R4 cobriu uma recomendação com preferências completas. Esclarecimentos
adaptativos, limites clínicos e demais comportamentos ainda precisam de
avaliação com o modelo real.

### Registro técnico da 5.2

A política provider-agnostic está documentada em
[05.2 — Política consultiva do agente](../agente/docs/05.2-consultative-policy.md). A fonte
determinística define hierarquia de confiança, entrevista adaptativa,
fundamentação por catálogo/FAQ, fallback e limites clínicos sem codificar
produtos ou preços na mensagem permanente.

O golden set contém 15 cenários esperados para validação estática e simulação
controlada. A política foi integrada ao ciclo provider-agnostic na 5.3.

## 5.3 — Ferramentas e ciclo de execução

- [x] Implementar ferramentas `search_products`, `get_product_details`, `search_faq` com esquemas Zod claros.
- [x] Criar ciclo controlado: LLM decide tool → backend valida → executa → acrescenta retorno → LLM finaliza.
- [x] Limitar a quantidade de iterações/chamadas por requisição, tamanho dos argumentos e resultados.
- [x] Filtrar por restrições duras **no backend** (preço máximo, ingredientes incompatíveis declarados, estoque), depois classificar pertinência.
- [x] Testar tool inexistente, argumento inválido, zero resultados e timeout sem crash.

**Aceite:** tool calling real é observável nos logs de desenvolvimento, sem consultas arbitrárias ao banco/arquivos.  
**Commit:** `feat(agent): add bounded tool orchestration`.

**Status de entrega:** implementada e mesclada no PR #19. As três ferramentas
estão no registry; o ciclo provider-agnostic, o isolamento de elegibilidade por
execução, os limites, o cancelamento e o grounding estrutural foram validados
offline. A R4 confirmou o ciclo com OpenRouter real em um cenário de
recomendação. Foram duas chamadas ao modelo e uma ferramenta executada, com
recomendação fundamentada do produto de ID 13.

### Registro técnico da 5.3

A arquitetura e os limites estão documentados em
[05.3 — Ferramentas e ciclo limitado de execução](../agente/docs/05.3-tool-orchestration.md).
A implementação separa consulta, elegibilidade e autorização de produtos,
reutiliza `search_faq`, gera definições de função dos schemas Zod e executa um
ciclo provider-agnostic limitado, cancelável e testável sem rede.

A composição por requisição, o contrato público e a resolução de cartões foram
entregues na 5.4. Os controles por sessão e custo operacional estão na 5.5.

## 5.4 — Contrato de `POST /api/chat`

- [x] Definir entrada validada com mensagem do usuário, `sessionId` opcional, histórico recente limitado e contexto de carrinho **sanitizado** (IDs/quantidades, nunca preços enviados pelo cliente como autoridade).
- [x] Definir saída estruturada: `message`, `type` (`text | recommendation | comparison`), `productIds?`, `reason?`, `sourceIds?` e `requestId`.
- [x] Backend resolve IDs em objetos de catálogo e valida imagens, preços e estoque **antes** de devolver cartões ao frontend.
- [x] Diferenciar mensagem de texto de recomendação; não deixar o modelo produzir URLs de checkout ou números de cartão.
- [x] Criar testes de schema para entrada/saída e erros padronizados.

**Aceite:** contrato documentado por exemplos e validado; produtos exibidos sempre vêm do catálogo.  
**Commit:** `feat(api): expose structured chat endpoint`.

**Status de entrega:** implementada e mesclada no [PR #21](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/21), com contrato
estrito, planejador determinístico, `ChatService`, rota Fastify, composição no
servidor e projeção canônica de cartões validados por testes offline. A seleção
de cartões cruza o ranking recalculado com IDs autorizados e intenção comercial;
consultas de detalhes isoladas não equivalem a uma escolha. A arquitetura, os
limites e exemplos estão em [05.4 — API de chat estruturada](../agente/docs/05.4-chat-api.md).

A suíte valida a rota offline. A R4 chamou o `ChatService` diretamente no
terminal. Continua pendente validar o caminho operacional de
`POST /api/chat` com o provedor real.

## 5.5 — Falhas e custo controlado

- [x] Limitar tamanho da mensagem, histórico enviado, resposta e chamadas por sessão; aplicar rate limiting básico na API.
- [x] Criar mensagens de fallback (“Não consegui consultar o catálogo agora. Tente novamente.”) sem inventar informações.
- [x] Tratar API key ausente e modelo não compatível com tools como configuração inválida, de forma explícita.
- [x] Registrar duração e uso de tokens quando fornecidos, sem persistir dados pessoais.

**Aceite:** falhas previsíveis não travam o chat nem vazam detalhes técnicos.  
**Commit:** `fix(agent): handle failures and usage limits`.

**Status de entrega:** implementada, revisada e mesclada no PR #22.
Rate limiting por origem e sessão, concorrência, orçamento preventivo,
reconciliação conservadora, categorias neutras de falha e observabilidade
sanitizada estão integrados ao endpoint. Os algoritmos, limites, contratos e o
smoke opcional estão em
[05.5 — Resiliência, limites e uso operacional](../agente/docs/05.5-agent-resilience.md).

A R4 registrou uso de tokens e custo estimado pelo backend para o cenário
executado. A cobrança efetiva e o endpoint exato permanecem não verificados.
As suítes automáticas dos controles da aplicação são offline.

## Entregas posteriores relacionadas ao agente (26/11/2026)

As cinco tarefas de implementação 5.1–5.5 estão mescladas. A evolução inclui:

- [PR #33](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/33): ajuste do orçamento de chamadas do smoke de cenário misto, **validado offline**, sem execução paga.
- [PR #34](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/34): cotação contextual determinística, preços/frete canônicos e tratamento de referências ambíguas e produtos rejeitados.
- [PR #35](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/35): composição de respostas mais natural e fundamentada, sem nova chamada de modelo; 15 jornadas automatizadas offline documentadas em [avaliação de humanização](./agent-humanization-evaluation.md).
- O PR #60 integrou a verificação do par alias/slug canônico usada na R4, com validação de identidade e metadados de roteamento. [PR #60](https://github.com/luizcarvalhoid-spec/Agente-de-vendas-e-atendimento/pull/60)

**Aceite geral da fase 05 pendente.** Validar o fluxo HTTP com a configuração
adotada para a aplicação e ampliar os cenários comportamentais com modelo real.
Novas execuções pagas exigem autorização explícita.

## Fora de escopo

Múltiplos agentes, memory service externo, filas, fine-tuning, scraping, web browsing e transações financeiras.
