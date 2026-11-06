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

## 5.2 — Prompt e política consultiva

- [ ] Definir papel: consultor de cosméticos da HidraSplash, cordial e objetivo, com português brasileiro.
- [ ] Fazer perguntas **adaptativas**, uma de cada vez quando útil: necessidade, tipo de cabelo/couro cabeludo, sensibilidade, orçamento e preferência.
- [ ] Aproveitar dados já fornecidos; não repetir perguntas respondidas nem usar roteiro rígido.
- [ ] Recomendar somente produtos reais do catálogo e não inventar estoque, preço, ingrediente ou benefício.
- [ ] Evitar diagnósticos médicos, curas garantidas e afirmações sem suporte; diante de sinais clínicos, orientar procurar profissional.
- [ ] Declarar que é demonstração fictícia quando apropriado.

**Aceite:** em simulações, uma entrada genérica (“preciso de shampoo anticaspa”) leva a perguntas pertinentes; entrada completa permite recomendação direta.  
**Commit:** `feat(agent): define consultative sales behavior`.

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
