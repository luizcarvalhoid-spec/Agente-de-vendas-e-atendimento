# 05 — Agente conversacional com OpenRouter

**Objetivo:** trocar a resposta simulada por um agente de vendas consultivas com API real, contexto limitado e ferramentas.  
**Depende de:** fases 02 e 04. **Ponto de substituição:** `Frontend/src/Pages/ChatbotButton.tsx` na fase 06.

## 5.1 — Cliente OpenRouter seguro no backend

- [x] Integrar API OpenRouter **somente no backend**, com chave de ambiente e modelo configurável.
- [ ] Escolher e registrar um modelo com suporte confirmado a **tool/function calling**; testar sua compatibilidade antes de depender dele.
- [x] Definir timeouts, limites de tokens/resposta, tratamento de `429`, `5xx`, indisponibilidade e cancelamento.
- [x] Não registrar Authorization, prompt completo com segredos ou informações pessoais em logs.
- [x] Criar testes com cliente HTTP mockado; chamada real apenas em smoke test manual com chave própria.

**Aceite:** API real retorna resposta pelo servidor, e nenhum segredo fica em artefato do Vite ou controle de versão.  
**Commit:** `feat(agent): integrate OpenRouter client`.

**Status de entrega:** implementada e mesclada no PR #17. O cliente
backend-only, a configuração parametrizada, os limites, o cancelamento, a
sanitização, os testes offline e o script de smoke manual estão implementados.
O aceite operacional permanece pendente até uma chamada real com credencial
própria confirmar resposta do provedor e compatibilidade de tool calling do
modelo configurado.

### Registro técnico da 5.1

O cliente usa `fetch` nativo do Node.js 22, endpoint fixo
`https://openrouter.ai/api/v1/chat/completions`, transporte injetável e
validação Zod. A chave e o modelo são recebidos da configuração central na
criação da instância; o cliente não acessa `process.env`, não registra payloads
e não realiza retries automáticos. A tarefa 5.1 não registra o cliente no
servidor nem expõe rota HTTP.

Limites iniciais da aplicação:

- timeout padrão de 15 segundos e máximo configurável de 60 segundos;
- 512 tokens de saída por padrão e teto de 4.096;
- até 40 mensagens, 16 ferramentas e 100.000 bytes no payload serializado;
- até 20.000 caracteres por string de argumentos retornada;
- resposta HTTP de sucesso limitada a 250.000 bytes antes da validação.

Esses limites controlam memória, latência e custo, mas não substituem uma
contagem de tokens do contexto. O ciclo e o orçamento agregado do agente serão
tratados nas tarefas posteriores.

#### Modelos consultados no catálogo em 09/11/2026

Os dados abaixo vieram do
[catálogo oficial da OpenRouter](https://openrouter.ai/api/v1/models). Preços
são em dólares por 1 milhão de tokens e podem mudar.

| Modelo | Entrada / saída | Contexto / saída máxima | Tools | Decisão |
| --- | ---: | ---: | --- | --- |
| `openai/gpt-4.1-mini` | US$ 0,40 / US$ 1,60 | 1.047.576 / 32.768 | `tools` e `tool_choice` | Modelo inicial sugerido; deve ser configurado em `OPENROUTER_MODEL`, nunca no cliente. |
| `google/gemini-3.1-flash-lite` | US$ 0,25 / US$ 1,50 | 1.048.576 / 65.536 | `tools` e `tool_choice` | Alternativa atual para avaliação de custo, latência e português brasileiro. |
| `google/gemini-2.5-flash-lite` | US$ 0,10 / US$ 0,40 | 1.048.576 / 65.535 | `tools` e `tool_choice` | Ainda constava no catálogo, sem expiração, apesar de avisos históricos divergentes sobre outubro de 2026; revalidar antes de cada adoção. |

Suporte declarado no catálogo não substitui o smoke manual. Para modelos que
serão usados com ferramentas, a compatibilidade deve ser testada com uma
função nomeada antes de habilitar o agente.

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

**Estado em 09/11/2026:** smoke real pendente por ausência de credencial local;
nenhum sucesso foi simulado. A implementação revisada não substitui a validação
manual da compatibilidade real do modelo com tool calling.

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
clínicos; os testes estáticos e os 15 cenários esperados estão versionados. O
aceite comportamental com um modelo real permanece pendente e não é comprovado
pelos testes determinísticos.

### Registro técnico da 5.2

A política provider-agnostic está documentada em
[05.2 — Política consultiva do agente](../agente/docs/05.2-consultative-policy.md). A fonte
determinística define hierarquia de confiança, entrevista adaptativa,
fundamentação por catálogo/FAQ, fallback e limites clínicos sem codificar
produtos ou preços na mensagem permanente.

O golden set contém 15 cenários esperados e separa validação estática,
simulação controlada e avaliação manual com modelo real. Os testes desta etapa
não chamam OpenRouter e não alegam provar obediência de um LLM. A política foi
integrada ao ciclo provider-agnostic na 5.3, ainda sem execução contra um modelo
real.

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
execução, os limites, o cancelamento e o grounding estrutural foram revisados e
aprovados por testes offline. O aceite operacional permanece pendente porque o
ciclo ainda não foi executado com OpenRouter real.

### Registro técnico da 5.3

A arquitetura e os limites estão documentados em
[05.3 — Ferramentas e ciclo limitado de execução](../agente/docs/05.3-tool-orchestration.md).
A implementação separa consulta, elegibilidade e autorização de produtos,
reutiliza `search_faq`, gera definições de função dos schemas Zod e executa um
ciclo provider-agnostic limitado, cancelável e testável sem rede.

A tarefa não registra o orquestrador no servidor nem cria endpoint. A
composição por requisição, o contrato público e a resolução de cartões ficam
reservados à 5.4; controles por sessão e custo operacional permanecem na 5.5.

## 5.4 — Contrato de `POST /api/chat`

- [x] Definir entrada validada com mensagem do usuário, `sessionId` opcional, histórico recente limitado e contexto de carrinho **sanitizado** (IDs/quantidades, nunca preços enviados pelo cliente como autoridade).
- [x] Definir saída estruturada: `message`, `type` (`text | recommendation | comparison`), `productIds?`, `reason?`, `sourceIds?` e `requestId`.
- [x] Backend resolve IDs em objetos de catálogo e valida imagens, preços e estoque **antes** de devolver cartões ao frontend.
- [x] Diferenciar mensagem de texto de recomendação; não deixar o modelo produzir URLs de checkout ou números de cartão.
- [x] Criar testes de schema para entrada/saída e erros padronizados.

**Aceite:** contrato documentado por exemplos e validado; produtos exibidos sempre vêm do catálogo.  
**Commit:** `feat(api): expose structured chat endpoint`.

**Status de entrega:** implementada na branch da tarefa 5.4, com contrato
estrito, planejador determinístico, `ChatService`, rota Fastify, composição no
servidor e projeção canônica de cartões validados por testes offline. A seleção
de cartões cruza o ranking recalculado com IDs autorizados e intenção comercial;
consultas de detalhes isoladas não equivalem a uma escolha. A arquitetura, os
limites e exemplos estão em [05.4 — API de chat estruturada](../agente/docs/05.4-chat-api.md).

O aceite operacional com OpenRouter real continua pendente. A suíte não usa
credencial, não faz chamadas pagas e não demonstra compatibilidade real de tool
calling nem comportamento do modelo configurado. Os controles de admissão,
concorrência e uso foram implementados na 5.5.

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

O aceite operacional da fase 05 permanece pendente: o smoke real não foi
executado, e não há comprovação de compatibilidade, comportamento, uso ou custo
do modelo configurado no OpenRouter. Os testes automáticos são exclusivamente
offline e não usam credenciais nem chamadas pagas.

## Fora de escopo

Múltiplos agentes, memory service externo, filas, fine-tuning, scraping, web browsing e transações financeiras.
