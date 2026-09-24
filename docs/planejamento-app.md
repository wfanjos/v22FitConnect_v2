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
- Idiomas: português, inglês e espanhol. Segue o idioma do aparelho (fora de PT/EN/ES, usa inglês), com troca manual.
- Lançamento nas lojas: Brasil primeiro; outros países depois (GDPR e outras leis só então).
- Texto criado pelo usuário (séries, observações, exercícios próprios, bio) não é traduzido; exercício próprio só é traduzido se virar oficial.
- Faixa de preço do diretório na moeda do país do professor, sem conversão.
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

## Perfil do aluno

- Dados básicos: data de nascimento, sexo, peso e altura.
- Objetivo do treino.
- Anamnese/restrições (lesões, doenças, medicamentos, liberação médica): dado de saúde, sensível pela LGPD.
- Avaliação física com histórico (medidas, % de gordura, fotos de evolução).
- Idade mínima: 16 anos.
- Cadastro: nascimento (valida 16+), sexo, peso e altura obrigatórios; anamnese opcional, com aviso ao professor quando vazia.
- Avaliação física registrada pelo aluno e pelo professor; cada registro guarda o autor.
- Compartilhamento de anamnese/avaliação autorizado pelo aluno por professor (consentimento LGPD), revogável.
- Fotos de evolução no Supabase Storage, privadas e comprimidas (~150 KB); monitorar a cota de 1 GB.

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
- Prescrição: reps fixas ou faixa (8–12), até a falha, por tempo (cronômetro regressivo) e cardio (tempo, distância, intensidade).
- Intensidade: carga + cadência (ex.: 3-1-1-0). RPE/RIR e % de 1RM ficam fora da v1.
- Séries de aquecimento marcadas à parte; não contam para recordes nem gráfico de carga.
- Reuso: biblioteca de séries-modelo do professor e cópia da série de um aluno para outro (cada cópia fica independente).
- Unidade de carga: kg ou lb por usuário. Padrão kg; com o idioma em inglês, o padrão é lb (regra pode mudar em versões futuras).
- Série tem data de fim; vencida continua utilizável com aviso de "série vencida"; aviso 3 dias antes para aluno e professor.
- Aluno não edita série do professor, só registra a execução; séries do próprio aluno são livremente editáveis.

## Execução e progresso

- Cronômetro automático de exercício e descanso; fim do descanso com som e vibração.
- Registro por série e mini-série: tempo do exercício, tempo de descanso, carga, repetições, status (feito/pulado), substituição de exercício, observação livre.
- Série alterada pelo professor durante um treino offline: o treino termina na versão antiga (registro guarda a versão usada); nova versão vale no próximo treino, com aviso.
- Em segundo plano/tela bloqueada: notificação fixa com descanso restante e próximo exercício; alarme toca mesmo bloqueado (Live Activity iOS: v2).
- Treino não finalizado: auto-finaliza após 3 h, com fim na última série registrada; aluno pode ajustar.
- Treino retroativo e edição de treino concluído permitidos, marcados como "manual" (sem tempos de cronômetro); professor vê a marcação.
- v1: histórico de treinos, gráfico de evolução de carga, recordes pessoais (maior carga e maior carga por nº de repetições, incluindo mini-séries de drop-set/rest-pause).

- Tipo de carga por exercício: total, por lado, por halter ou máquina (gráficos não misturam).

## Motivação (v1)

- Sequência de semanas cumprindo a meta de treinos semanais. Meta definida pelo professor (ou pelo aluno, se sem professor); aluno não sobrescreve a do professor.
- Conquistas com as poses do mascote (primeiro treino, 50 treinos, novo recorde...).
- Tela de celebração com a harpia ao bater recorde pessoal.
- Resumo semanal/mensal compartilhável.
- Fim de treino: pergunta se quer tirar foto; abre a câmera, aplica o logo V22 + resumo do treino (duração, nº de exercícios, volume, recordes) e salva na galeria e/ou compartilha no Instagram. A foto não é salva no nosso servidor.

## Acompanhamento do professor (v1)

- Resumo de cada treino concluído (cargas, reps, observações).
- Painel de adesão: frequência por aluno, alunos parados há X dias, séries vencendo.
- Sem chat e sem comentários no treino na v1.

## Versão web do professor (v1)

- Tudo que o professor faz no app: séries, modelos, alunos, avaliações, resumo dos treinos e painel de adesão.
- Mesmo site React + Vite do painel admin, com áreas separadas por papel.

## Diretório de professores (v1)

- Busca pública de professores com pedido de vínculo, além do convite por código/link.
- Perfil público: bio, especialidades, cidade/bairro, academia, modalidade (presencial/online), faixa de preço (informativa, pagamento fora do app), Instagram/WhatsApp e seção de currículo. O professor escolhe o que aparece.
- Entrada opt-in; no Brasil exige CREF preenchido. Admin pode ocultar perfis.
- Busca por cidade/estado com filtros (especialidade, modalidade) e opção "perto de mim" por GPS (pede permissão de localização; professor informa o local de atendimento).
- Localização exibida: distância aproximada + bairro; abaixo de 200 m mostra "A menos de 200 metros". Endereço exato não aparece.
- Currículo em campos estruturados: formação, pós/especializações, certificações e experiências (instituição e ano).
- Pedido de vínculo pelo diretório: aluno envia com mensagem curta; professor aceita ou recusa; máx. 3 pedidos pendentes por aluno; expira em 7 dias.
- Avaliações/notas de professores: ficam para a fase da rede social.

## Notificações (v1)

- Fim do descanso (som/vibração).
- Professor avisado quando o aluno conclui um treino.
- Aluno avisado ao receber nova série.
- Aluno e professor avisados quando a série está a 3 dias de vencer.
- Lembrete de treino (aluno escolhe dias e horário).
- Convite de vínculo aceito (avisa quem enviou).
- Todas as notificações podem ser desativadas nas configurações.
- Push: Expo Push.

## Painel admin web

- Curadoria da base oficial de exercícios.
- Fila de análise dos exercícios criados por usuários (duplicados por similaridade, contagem).
- Tradução PT/ES revisada antes de um exercício virar oficial.
- Painel inicial: usuários (cadastros, ativos, retenção), uso (treinos, séries, vínculos), cotas grátis com alerta aos 80% e filas pendentes.
- Ações sobre contas: suspender/banir (motivo registrado, usuário avisado), selo "CREF verificado" (conferência manual no CONFEF) e push em massa para todos ou um grupo. Tela de visualização dos dados da conta não incluída.
- Log de ações dos administradores (quem fez o quê e quando).
- Conteúdo global (FAQ, exercícios oficiais, textos): revisor edita rascunho, admin publica.
- Limite de alunos por professor configurável (ilimitado na v1; pronto para a mensalidade).
- Acesso com papéis (admin, revisor de conteúdo); na v1 só há um usuário admin.

## Moderação, suporte e segurança (v1)

- Denunciar perfil (fila no admin), bloquear usuário (bloqueia pedidos e convites) e filtro de palavras em bio, currículo e mensagens.
- Suporte: FAQ no app (3 idiomas, editável no admin) e formulário "fale conosco / reportar problema" com print opcional, caindo no admin.
- Verificação de e-mail obrigatória no cadastro por e-mail/senha.
- Biometria opcional para abrir o app.
- 2FA (app autenticador, TOTP) obrigatório para contas de admin e revisor, com códigos de recuperação.
- Importação de histórico de outros apps: fora da v1.

## Dispositivos e acessibilidade (v1)

- Tablet com layout próprio em colunas (lista + detalhe lado a lado).
- Site web (professor/admin) responsivo, com foco no computador.
- Respeita o tamanho de fonte do sistema sem quebrar as telas.
- Tela de treino com botões grandes, para usar sem precisão (mão suada, luva).
- Versão mínima: padrão do Expo (≈ Android 7+ / iOS 15+).

## Aparência e monitoramento

- Tema claro e escuro: segue o sistema, com troca manual pelo usuário.
- Crashes/erros: Sentry (plano grátis) no app e no admin.
- Analytics: PostHog (plano grátis), citado na política de privacidade.

## Requisitos legais

- Exclusão de conta dentro do app.
- Exclusão: conta desativada por 30 dias (pode reativar), depois tudo é apagado; históricos vistos pelo professor são anonimizados.
- Exercícios do usuário que viraram oficiais ficam na base, sem autoria.
- Exportar meus dados pelo app (perfil, treinos, avaliações, fotos + CSV dos treinos), atendendo a portabilidade da LGPD.
- Backup próprio semanal do banco via GitHub Actions para armazenamento privado, mantendo as últimas 4 cópias (o Supabase free não tem backup restaurável).
- Professor que exclui a conta: as séries dos alunos viram cópia editável do aluno, com a nota "criada por ex-professor"; o histórico fica intacto.
- Termos de uso e política de privacidade cobrindo: análise dos exercícios criados por usuários, cessão de uso desse conteúdo para a base oficial e uso desses dados (redação final revisada por advogado).

## Lançamento

- Beta fechado: 5–10 professores conhecidos e seus alunos, por algumas semanas, via teste interno do Google Play e TestFlight; feedback pelo formulário do app.
- Landing page simples (marca, mascote, links das lojas, termos, privacidade, suporte) em hospedagem grátis.
- Domínio: ainda não comprado (.com.br ~R$ 40/ano no Registro.br); usar também no link de convite e no e-mail de suporte.
- Conta Google Play (US$ 25): ainda não criada. Conta pessoal nova exige 12 testadores por 14 dias antes de publicar; o beta fechado cobre isso.

## Limites dos serviços gratuitos a monitorar

- Supabase free: 500 MB de banco, 1 GB de arquivos, 50 mil usuários ativos/mês, pausa após 7 dias de inatividade.
- Expo/EAS free: 30 builds/mês (até 15 iOS), EAS Update para até 1.000 usuários ativos/mês.

## Em aberto

- Formato oficial e validação do número de CREF ainda não confirmados em detalhe.
