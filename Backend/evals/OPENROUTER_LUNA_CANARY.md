# Primeiro canário comercial GPT-6 Luna via OpenRouter

**NO-GO para execução real.** O [manifesto candidato](canary/gpt-6-luna-openrouter-candidate.v1.json)
vincula `openai/gpt-6-luna` a um único cenário fictício, com fingerprint próprio.
A preparação reutiliza o cliente OpenRouter, o preflight, a reserva local e o
ensaio em memória da EVAL-07B. O cenário técnico universal e a integração
direta OpenAI da EVAL-07C continuam disponíveis pelos seus fluxos existentes.

## Compatibilidade documental e privacidade

Consulta pública de 24/11/2026 às 15:30 em São Paulo, pelo ID exato do modelo.
As tarifas abaixo são em USD por milhão de tokens. A elegibilidade ZDR da
tabela indica presença na lista pública ZDR consultada. [Catálogo de endpoints
do modelo](https://openrouter.ai/api/v1/models/openai/gpt-6-luna/endpoints) ·
[Lista pública ZDR](https://openrouter.ai/api/v1/endpoints/zdr) ·
[Página do modelo](https://openrouter.ai/openai/gpt-6-luna)

| Identificador público | Serviço | Entrada | Saída | ZDR observado |
| --- | --- | ---: | ---: | --- |
| `azure` (global no catálogo) | Standard | 0,10 | 0,50 | Sim, com `safety_retention: false` |
| `amazon-bedrock/global` | Standard | 0,10 | 0,50 | Ausente da lista para o modelo |
| `openai` | Standard | 0,10 | 0,50 | Ausente da lista para o modelo |
| `openai/flex` | Flex | 0,05 | 0,25 | Ausente da lista para o modelo |
| `openai/fast` | Fast | 0,20 | 1,00 | Ausente da lista para o modelo |

O endpoint publicado como Azure global anuncia `max_completion_tokens`,
`tools`, `tool_choice` com `auto` e `reasoning_effort`. O GPT-6 Luna exige
`reasoning_effort: "none"` para ferramentas em Chat Completions. O cliente
envia essa configuração e `service_tier: "default"` (Standard) na configuração
de avaliação do candidato, com as ferramentas e a escolha definidas pelo
ChatService. O ensaio valida a serialização local. A aplicação dos parâmetros
na rota real ainda precisa de evidência. [Referência do GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) ·
[Contrato de Chat Completions do OpenRouter](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion)

| Evidência | Exigência para a rodada futura |
| --- | --- |
| Modelo retornado | Comparar o ID literal com `openai/gpt-6-luna` em cada resposta. O ensaio usa identidades sintéticas. |
| Família permitida | Restringir `provider.order` e `provider.only` a `azure`, sem fallback. O seletor base também pode aceitar variantes. |
| Endpoint exato | Pendente. O retorno de família ou nome de exibição e a marcação da rota selecionada não comprovam a identidade do endpoint. Nenhum UUID de catálogo foi adotado como seletor. |
| Política de dados | Exigir `zdr: true`, `data_collection: "deny"`, `require_parameters: true` e `allow_fallbacks: false`. Conferir ZDR only e ausência de Safety Retention na política efetiva da conta ou do guardrail. |

Se a única seleção comprovável continuar sendo por família, a política
proposta limita a rodada a Azure Standard, exclusivamente com a mensagem e o
catálogo fictícios deste cenário. Antes de aceitar esse escopo, o operador
deve aprová-lo especificamente, verificar a privacidade e as tarifas de todas
as variantes efetivamente elegíveis e definir evidência observável suficiente
para confirmar a família. O validador atual mantém a comparação literal de
identidade e interrompe com identidade ausente, divergente ou ambígua,
inclusive se o retorno trouxer apenas um nome de exibição divergente como
`Azure`. [Seleção de provedores](https://openrouter.ai/docs/guides/routing/provider-selection) ·
[Metadados de roteamento](https://openrouter.ai/docs/guides/routing/routers/router-metadata) ·
[Política ZDR](https://openrouter.ai/docs/guides/features/zdr)

## Reserva e conferência financeira

Uma execução futura, com até duas chamadas de 20.000 tokens estimados de
entrada e 512 de saída por chamada, totaliza um teto local de 41.024 tokens.
O timeout efetivo é de 15 segundos. O candidato usa
`https://openrouter.ai/api/v1/chat/completions` sem streaming, retry
automático, fallback entre modelos ou persistência de transcrição.

Para a tarifa Standard publicada do Azure global, a reserva documental é
`2 × 1,25 × (20.000 × 0,10 + 512 × 0,50) / 1.000.000 = USD 0,00564`
(USD 0,00282 por chamada). A página do modelo também lista preços regionais
Azure de USD 0,11/0,55 e USD 0,12/0,60. A reserva Standard depende da rota e
das condições de cobrança. Por exemplo, o catálogo global informa
USD 0,125/M para escrita de cache, o que daria USD 0,002756 por chamada se
toda a entrada fosse faturada a essa tarifa e o preço de saída fosse o
Standard. O preço operacional permanece pendente, inclusive a conferência
de variantes, tarifas e aplicabilidade de cache. [Página do modelo](https://openrouter.ai/openai/gpt-6-luna) ·
[Catálogo de endpoints do modelo](https://openrouter.ai/api/v1/models/openai/gpt-6-luna/endpoints)

Antes de uma execução autorizada, o operador deve conferir um teto de
USD 1,00 na chave dedicada, sem reset automático (`limitReset: null`, se
disponível), saldo suficiente para a reserva confirmada e recarga automática
desativada, salvo autorização separada. Se o saldo disponível ou o teto
efetivo não cobrir a reserva, manter NO-GO. Após a única rodada, reconciliar
os tokens informados e o custo registrado na Activity do OpenRouter com a
reserva local, inclusive em caso de falha. O teto de USD 1,00 cobre consumo
e a preparação não inclui compra de créditos. [Criação de chaves](https://openrouter.ai/docs/api/api-reference/api-keys/create-keys) ·
[Controles de gastos](https://openrouter.ai/docs/guides/best-practices/spend-controls) ·
[Painel de atividade](https://openrouter.ai/activity)

## Preflight e gate operacional

O manifesto é um rascunho sem `pricing` e `sourceRevision`. O preflight
retorna `configuration_incomplete`, sem fingerprint de manifesto, reserva
operacional ou permissão de rede. A validação offline carrega o dataset,
confere seu fingerprint e executa o ensaio comercial por transporte em
memória. Um manifesto sintético fica restrito ao teste.

| Controle existente da EVAL-07B | Pendência para operação |
| --- | --- |
| Manifesto, dataset e atestações | Fixar revisão completa, confirmar tarifa, escopo, política de dados e identidade, então calcular um novo fingerprint do manifesto. |
| Integridade de runtime, checkout, lockfile e dependências | Usar o código da revisão aprovada no próprio checkout validado e dependências próprias. Prevenir alterações concorrentes durante a execução. |
| Autoridade confiável, assinatura Ed25519 e uso único persistente | Aprovação específica, com validade e hashes vinculados ao runtime, e armazenamento privado e persistente para consumo exclusivo. |
| Limite externo, reserva e credencial | Validar o teto e o saldo na conta. Vincular uma credencial exclusiva ao experimento apenas em etapa autorizada. |
| Bloqueio de live | `LIVE_EXECUTION_DISABLED` permanece obrigatório. Qualquer mudança depende de revisão futura separada. |

O Ubuntu WSL2 permite ensaiar localmente a integridade com um checkout no
filesystem Linux, conta sem sudo e dependências próprias. Uma eventual
operação pagante depende de demonstrar isolamento do processo e do checkout
contra alterações pelo host ou por outros processos, armazenamento
persistente protegido, injeção de credencial restrita e egresso limitado.
Esses controles operacionais ainda não foram comprovados no WSL2. Nenhuma
VM, credencial, aprovação operacional ou inferência faz parte desta etapa.

## Uma rodada comercial futura

> Olá! Estou procurando um shampoo anticaspa, mas não sei qual escolher. Vocês podem me ajudar?

Iniciar sem histórico, preferências ou carrinho, usando o [dataset
comercial](datasets/stores/hidrasplash/luna-commercial-canary.v1.json) e o
catálogo canônico. Esperar uma pergunta útil sobre o couro cabeludo antes de
recomendar. A consulta ao catálogo é permitida quando necessária. Observar
ferramentas efetivamente executadas, IDs de produtos e limites técnicos. A
revisão humana deve verificar qualidade da pergunta, linguagem natural em
português, ausência de benefícios inventados e respeito aos limites clínicos
e comerciais. Encerrar após a primeira resposta ao usuário ou qualquer
condição de parada do manifesto. O ensaio sintético verifica o fluxo local
com uma busca real no catálogo, sem medir o desempenho do Luna.
