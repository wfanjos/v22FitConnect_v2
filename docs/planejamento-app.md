# V22 Fit Connect — Planejamento do app

Decisões tomadas até agora no planejamento.

## Visão geral

- App mobile de criação de séries de musculação: o aluno cria sua série ou vê a série criada pelo professor.
- Restrição: todas as ferramentas precisam ser gratuitas. O app será grátis; custos só depois de monetizar.
- Modelo de negócio: gratuito por enquanto; forma de cobrança futura ainda não definida.

## Plataforma e stack

- App: React Native (Android e iOS). Painel admin web: React + Vite.
- Backend: Supabase.
- Offline: SQLite puro (expo-sqlite), com sincronização própria (sem PowerSync/WatermelonDB).
- Login: e-mail/senha, Google e Apple.
- Idiomas: português, inglês e espanhol.
- iOS desenvolvido junto com Android, mas publicado na App Store só quando a taxa anual da Apple for paga.

## Usuários e vínculo aluno–professor

- App único, mesmo login para aluno e professor, com telas/navegação diferentes por papel.
- Professor pode alternar para "modo aluno" no mesmo login e se vincular a outros professores como aluno.
- Vínculo por convite (código ou link), expira em ~7 dias, uso único (um convite por aluno).
- Aluno e professor podem enviar convite e desfazer o vínculo.
- Aluno pode ter vários professores; cada professor só vê as séries e registros que ele criou/atribuiu.
- Ao desvincular: séries daquele professor somem para o aluno; histórico de execução (gráficos e recordes) fica com o aluno; professor mantém acesso só leitura ao que já existia; exercícios criados pelo ex-professor continuam abrindo o guia no histórico do aluno.
- Perfil do professor: nome, foto e CREF.
- CREF obrigatório só para professor que escolhe "Brasil" no cadastro; nos demais países, registro profissional opcional.
- Validação do CREF só de formato (`CREF NNNNNN-G/UF` ou `CREF NNNNNN-P/UF`), sem checagem de existência (não há API oficial).

## Base de exercícios

- Importar do Free Exercise DB (domínio público/Unlicense), não do wger (CC-BY-SA).
- Tradução PT/ES feita pelo Claude em lotes, revisada no painel admin.
- Músculo principal, secundários, grupo corporal, equipamento e nível já vêm do Free Exercise DB.
- Descrição e execução geradas por IA como rascunho, em fila de revisão; só aparecem no guia depois de revisadas (sem revisão, campo vazio, sem rótulo de pendência).
- Guia do exercício: nome, variações do nome, músculo principal, secundários, descrição, execução e animação alternando imagem inicial/final (sem fotos estáticas separadas, sem vídeo).
- Vídeo próprio dos exercícios: v2.
- Autocomplete offline: ignora acento/maiúscula, tolerante a erro de digitação, busca nas variações do nome, ordena pelos exercícios mais usados pelo usuário.
- Professor e aluno podem criar exercícios fora da base:
  - do aluno: privado por padrão; pode liberar para um professor ver e/ou editar;
  - do professor: visível só para alunos com série que usa o exercício.
- Todo exercício criado por usuário entra na fila de análise (sem avisar o criador; consta nos termos de uso), com filtro de repetidos por similaridade de texto e contagem de ocorrências.
- Variações de nome: sugestão por IA revisada + nomes digitados pelos usuários ao criar exercícios.

## Séries de treino

- Organizadas por letra (A/B/C...) ou dia da semana, à escolha do professor.
- Estrutura em blocos (bi-set, tri-set); tipos de série: normal, drop-set, rest-pause.
- Professor define o tempo de descanso de cada exercício.
- Série tem data de fim; vencida continua utilizável com aviso de "série vencida"; aviso 3 dias antes para aluno e professor.
- Aluno não edita série do professor, só registra a execução; séries do próprio aluno são livremente editáveis.

## Execução e progresso

- Cronômetro automático de exercício e descanso; fim do descanso com som e vibração.
- Registro por série e mini-série: tempo do exercício, tempo de descanso, carga, repetições, status (feito/pulado), substituição de exercício, observação livre.
- v1: histórico de treinos, gráfico de evolução de carga, recordes pessoais (maior carga e maior carga por nº de repetições, incluindo mini-séries de drop-set/rest-pause).

## Notificações (v1)

- Fim do descanso (som/vibração).
- Professor avisado quando o aluno conclui um treino.
- Aluno avisado ao receber nova série.
- Aluno e professor avisados quando a série está a 3 dias de vencer.
- Push: Expo Push.

## Painel admin web

- Curadoria da base oficial de exercícios.
- Fila de análise dos exercícios criados por usuários (duplicados por similaridade, contagem).
- Tradução PT/ES revisada antes de um exercício virar oficial.

## Requisitos legais

- Exclusão de conta dentro do app.
- Termos de uso e política de privacidade cobrindo: análise dos exercícios criados por usuários, cessão de uso desse conteúdo para a base oficial e uso desses dados (redação final revisada por advogado).

## Limites dos serviços gratuitos a monitorar

- Supabase free: 500 MB de banco, 1 GB de arquivos, 50 mil usuários ativos/mês, pausa após 7 dias de inatividade.
- Expo/EAS free: 30 builds/mês (até 15 iOS), EAS Update para até 1.000 usuários ativos/mês.

## Em aberto

- Formato oficial e validação do número de CREF ainda não confirmados em detalhe.
