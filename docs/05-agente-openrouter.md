# 05 — Agente conversacional com OpenRouter

**Objetivo:** trocar a resposta simulada por um agente de vendas consultivas com API real, contexto limitado e ferramentas.  
**Depende de:** fases 02 e 04. **Ponto de substituição:** `Frontend/src/Pages/ChatbotButton.tsx` na fase 06.

## 5.1 — Cliente OpenRouter seguro no backend

- [ ] Integrar API OpenRouter **somente no backend**, com chave de ambiente e modelo configurável.
- [ ] Escolher e registrar um modelo com suporte confirmado a **tool/function calling**; testar sua compatibilidade antes de depender dele.
- [ ] Definir timeouts, limites de tokens/resposta, tratamento de `429`, `5xx`, indisponibilidade e cancelamento.
- [ ] Não registrar Authorization, prompt completo com segredos ou informações pessoais em logs.
- [ ] Criar testes com cliente HTTP mockado; chamada real apenas em smoke test manual com chave própria.

**Aceite:** API real retorna resposta pelo servidor, e nenhum segredo fica em artefato do Vite ou controle de versão.  
**Commit:** `feat(agent): integrate OpenRouter client`.

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

#### Modelos verificados em 09/11/2026

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
nenhum sucesso foi simulado. Os checkboxes permanecem para validação técnica e
manual após a revisão do PR.

## 5.2 — Prompt e política consultiva

- [ ] Definir papel: consultor de cosméticos da HidraSplash, cordial e objetivo, com português brasileiro.
- [ ] Fazer perguntas **adaptativas**, uma de cada vez quando útil: necessidade, tipo de cabelo/couro cabeludo, sensibilidade, orçamento e preferência.
- [ ] Aproveitar dados já fornecidos; não repetir perguntas respondidas nem usar roteiro rígido.
- [ ] Recomendar somente produtos reais do catálogo e não inventar estoque, preço, ingrediente ou benefício.
- [ ] Evitar diagnósticos médicos, curas garantidas e afirmações sem suporte; diante de sinais clínicos, orientar procurar profissional.
- [ ] Declarar que é demonstração fictícia quando apropriado.

**Aceite:** em simulações, uma entrada genérica (“preciso de shampoo anticaspa”) leva a perguntas pertinentes; entrada completa permite recomendação direta.  
**Commit:** `feat(agent): define consultative sales behavior`.

### Registro técnico da 5.2

A política provider-agnostic está documentada em
[05.2 — Política consultiva do agente](./05.2-consultative-policy.md). A fonte
determinística define hierarquia de confiança, entrevista adaptativa,
fundamentação por catálogo/FAQ, fallback e limites clínicos sem codificar
produtos ou preços na mensagem permanente.

O golden set contém 15 cenários esperados e separa validação estática,
simulação controlada futura e avaliação manual com modelo real. Os testes desta
etapa não chamam OpenRouter e não alegam provar obediência de um LLM. A
integração da política, ferramentas e resultados no ciclo de execução permanece
na tarefa 5.3.

## 5.3 — Ferramentas e ciclo de execução

- [ ] Implementar ferramentas `search_products`, `get_product_details`, `search_faq` com esquemas Zod claros.
- [ ] Criar ciclo controlado: LLM decide tool → backend valida → executa → acrescenta retorno → LLM finaliza.
- [ ] Limitar a quantidade de iterações/chamadas por requisição, tamanho dos argumentos e resultados.
- [ ] Filtrar por restrições duras **no backend** (preço máximo, ingredientes incompatíveis declarados, estoque), depois classificar pertinência.
- [ ] Testar tool inexistente, argumento inválido, zero resultados e timeout sem crash.

**Aceite:** tool calling real é observável nos logs de desenvolvimento, sem consultas arbitrárias ao banco/arquivos.  
**Commit:** `feat(agent): add bounded tool orchestration`.

## 5.4 — Contrato de `POST /api/chat`

- [ ] Definir entrada validada com mensagem do usuário, `sessionId` opcional, histórico recente limitado e contexto de carrinho **sanitizado** (IDs/quantidades, nunca preços enviados pelo cliente como autoridade).
- [ ] Definir saída estruturada: `message`, `type` (`text | recommendation | comparison`), `productIds?`, `reason?`, `sourceIds?` e `requestId`.
- [ ] Backend resolve IDs em objetos de catálogo e valida imagens, preços e estoque **antes** de devolver cartões ao frontend.
- [ ] Diferenciar mensagem de texto de recomendação; não deixar o modelo produzir URLs de checkout ou números de cartão.
- [ ] Criar testes de schema para entrada/saída e erros padronizados.

**Aceite:** contrato documentado por exemplos e validado; produtos exibidos sempre vêm do catálogo.  
**Commit:** `feat(api): expose structured chat endpoint`.

## 5.5 — Falhas e custo controlado

- [ ] Limitar tamanho da mensagem, histórico enviado, resposta e chamadas por sessão; aplicar rate limiting básico na API.
- [ ] Criar mensagens de fallback (“Não consegui consultar o catálogo agora. Tente novamente.”) sem inventar informações.
- [ ] Tratar API key ausente e modelo não compatível com tools como configuração inválida, de forma explícita.
- [ ] Registrar duração e uso de tokens quando fornecidos, sem persistir dados pessoais.

**Aceite:** falhas previsíveis não travam o chat nem vazam detalhes técnicos.  
**Commit:** `fix(agent): handle failures and usage limits`.

## Fora de escopo

Múltiplos agentes, memory service externo, filas, fine-tuning, scraping, web browsing e transações financeiras.
