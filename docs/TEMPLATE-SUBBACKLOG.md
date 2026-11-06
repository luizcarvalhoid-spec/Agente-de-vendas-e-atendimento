# TEMPLATE — Sub-backlog N.M (copiar e adaptar)

> **Não execute este arquivo como tarefa.** Copie a estrutura para `## N.M` no arquivo da fase correspondente ou crie `docs/03.5-nome-da-descoberta.md` e adicione link na fase. Não renumere backlogs já executados.

# N.M — Título claro e verificável

**Origem:** escopo planejado / bug encontrado / oportunidade surgida em teste.  
**Motivo:** por que essa tarefa é necessária agora?  
**Prioridade:** essencial / diferencial / opcional.  
**Depende de:** N.M ou arquivo/contrato anterior.  
**Arquivos prováveis:** listar caminhos após inspecionar o código (sem presumir que existem).  
**Não fazer:** mudanças fora do escopo, refatoração ampla, dependências desnecessárias.

## Contexto / resultado esperado

Escreva 2–4 frases descrevendo um comportamento que o usuário ou desenvolvedor pode observar e testar.

## Checklist de implementação

- [ ] Tarefa 1, com ação e escopo concretos.
- [ ] Tarefa 2, com ação e escopo concretos.
- [ ] Tarefa 3, incluindo estados de erro/vazio quando aplicável.
- [ ] Atualizar testes/contratos/documentação afetados.

## Critérios de aceite

- [ ] Cenário feliz: **dado X, quando Y, então Z**.
- [ ] Cenário de erro: **dado X inválido/indisponível, então ocorre W sem falha silenciosa**.
- [ ] Build/lint/testes relevantes executados, resultados registrados.
- [ ] Revisão manual feita, sem segredo exposto e sem regressão visível.

## Notas de execução

- **Decisões:** (preencher)
- **Bloqueios:** (preencher)
- **Arquivos alterados:** (preencher após implementar)
- **Testes executados:** (preencher)
- **Commit/PR/Issue:** (colar link depois)

## Prompt sugerido para Codex

```text
Leia docs/README.md, docs/00-estado-atual.md e este sub-backlog.
Inspecione primeiro os arquivos reais. Implemente apenas N.M, com menor
alteração coerente possível. Preserve a UI existente e a stack definida.
Não adicione autenticação, multi-tenant, pagamento real ou serviços externos
não previstos. Execute os testes relevantes. Ao terminar, liste alterações,
resultados de testes e pendências. Não marque checkboxes, commite ou faça push
sem minha revisão.
```
