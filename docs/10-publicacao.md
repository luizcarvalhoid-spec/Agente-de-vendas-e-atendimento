# 10 — Publicação no GitHub e LinkedIn

**Objetivo:** apresentar não só uma interface de chat, mas o problema resolvido, decisões de engenharia e demonstração verificável.  
**Depende de:** fase 09. O repositório **já é público**; esta fase refere-se ao lançamento documentado e à divulgação, não à primeira publicação.

## 10.1 — README profissional na raiz

- [ ] Criar `README.md` na raiz com título, problema, proposta, principais funcionalidades e aviso de projeto fictício.
- [ ] Adicionar screenshots do catálogo, chat recomendando produto e observabilidade, com textos alternativos.
- [ ] Documentar arquitetura pequena (frontend, backend, catálogo, RAG, tool calling, OpenRouter) e decisões de escopo.
- [ ] Incluir requisitos, comandos de instalação, `.env.example`, testes, execução local e troubleshooting.
- [ ] Incluir links para `docs/README.md` e fases do roadmap, com progresso real (não marcar incompletos como concluídos).
- [ ] Registrar limitações conhecidas e responsabilidades: sem pagamentos, pedidos ou aconselhamento médico real.

**Aceite:** alguém com Node e chave própria consegue reproduzir o demo seguindo o README.  
**Commit:** `docs: add complete project README`.

## 10.2 — Evidências visuais e narrativa

- [ ] Criar vídeo curto de 60–120 s: necessidade → perguntas → ferramenta → produto recomendado → carrinho → painel técnico.
- [ ] Capturar screenshots legíveis em desktop e mobile e ocultar qualquer segredo ou dado pessoal.
- [ ] Escrever 3 decisões técnicas com justificativa (ex.: Git-based CMS, RAG textual, tool calling com validações).
- [ ] Explicar objetivamente o que foi **implementado e testado** e o que é **fictício/simulado**.
- [ ] Se citar resultados de evals, usar somente números medidos e declarar modelo, dataset e condições.

**Aceite:** vídeo e imagens demonstram funcionamento real, sem simular capacidades que não existem.  
**Commit:** `docs: add demo assets and engineering notes`.

## 10.3 — Checklist de GitHub

- [ ] Revisar `git status`, histórico de commits, arquivos grandes e `.gitignore`.
- [ ] Abrir PR final ou revisar branch antes de fazer merge em `main`.
- [ ] Conferir links, licença (se decidir publicar código aberto), descrição e topics do repositório.
- [ ] Marcar tarefas completas nesta pasta; manter pendências honestas e criar seção de melhorias futuras.
- [ ] Criar tag/release `v1.0.0-portfolio` **somente quando o MVP demonstrável e a documentação estiverem prontos**.
- [ ] Fixar o repositório no perfil do GitHub se fizer sentido para o portfólio.

**Aceite:** repositório público tem README, código reproduzível e evidência de uso real.  
**Commit:** `chore: prepare portfolio release`.

## 10.4 — Publicar no LinkedIn

- [ ] Preparar post com problema, solução, stack, 3 desafios técnicos e demonstração; não exagerar funcionalidades.
- [ ] Inserir link direto do repositório e do demo (se existir), além do vídeo ou screenshots.
- [ ] Destacar a diferença entre chat genérico e agente com perguntas adaptativas, RAG e tool calling validado.
- [ ] Revisar português, legibilidade do vídeo, nomes das tecnologias e acessibilidade das imagens.
- [ ] Publicar o post e salvar seu URL no README ou em uma nota da release.

**Aceite:** post está publicado e aponta para um repositório que explica e demonstra a solução.

## 10.5 — Pós-publicação (curto e opcional)

- [ ] Registrar feedbacks úteis em GitHub Issues com escopo e prioridade claros.
- [ ] Corrigir problemas que impedem executar o projeto.
- [ ] Adicionar ao README aprendizados e melhorias futuras sem redefinir escopo do MVP.

## Sugestão de estrutura do post (não publicar sem revisão)

1. **Problema:** chatbots comuns recomendam produtos cedo demais ou inventam informações.
2. **Solução:** assistente consultivo para cosméticos com perguntas contextuais, catálogo estruturado e FAQ recuperada via RAG.
3. **Engenharia:** React/Vite + TypeScript, API Node/Fastify, OpenRouter, tool calling, validação e testes.
4. **Demonstração:** vídeo de um pedido real dentro do cenário fictício.
5. **Resultados reais:** somente métricas medidas; citar limitações.
6. **CTA:** link GitHub e convite a feedback técnico.
