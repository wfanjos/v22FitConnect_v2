# V22 Fit Connect

App de treinos de musculação que conecta aluno e professor: o aluno cria a própria série ou segue a série criada pelo professor, registra os treinos (inclusive offline) e acompanha a evolução. App mobile (Expo/React Native), site web do professor + painel admin (React + Vite), backend em Supabase. Marca V22, com logo e mascote baseados na harpia.

## Como trabalhar neste repositório

- **Nunca inventar informação.** Se faltar um detalhe de regra de negócio, comportamento de tela, texto ou dado, pare e pergunte — não assuma um valor "razoável" e siga em frente.
- **Fontes da verdade** (ler antes de decidir qualquer coisa; não duplicar o conteúdo delas aqui):
  - `docs/planejamento-app.md` — regras de negócio, stack, legal, limites dos serviços grátis. A seção "Em aberto" lista o que ainda não foi decidido: não preencha sozinho.
  - `docs/telas.md` — ~130 telas com códigos (`E` entrada · `AL` aluno · `TR` treino · `PR` professor · `C` compartilhadas · `W` web do professor · `AD` admin · `LP` landing). Cite o código da tela no código/commit quando fizer sentido. "Pontos a confirmar" no fim do arquivo são pendências.
  - `docs/modelo-dados.md` — ~45 tabelas, convenções (uuid v7, `sync_seq`, exclusão lógica, kg no banco), RLS e sincronização offline.
  - `docs/fases.md` — fases 0–13 com marcos, estrutura do repositório e checklist "Antes de começar a fase 0".
- **Ordem de desenvolvimento**: seguir `docs/fases.md`. Primeiro o aluno sozinho (offline e cronômetros), depois o professor por cima. Uma fase só fecha com os testes dela passando.
- **Sempre avaliar a LGPD** ao mexer em dados pessoais ou de saúde. Anamnese, avaliações e fotos de evolução são dados sensíveis: só o próprio aluno e professores com `share_health = true` no vínculo ativo podem ler.
- **Perguntas ao usuário**: em rodadas, com opções concretas (descrever o conteúdo real, não rótulos genéricos). Ao explicar ferramentas ou conceitos, usar linguagem simples: o que é, para que serve, custo e recomendação.
- **Registrar decisões**: toda resposta do usuário que decide algo entra logo em seguida no doc correspondente em `docs/`.
- **Custo zero**: todas as ferramentas precisam ser gratuitas. Antes de sugerir algo pago, apontar o custo e uma alternativa grátis.

## Git

- Commits direto na `main` (sem branch/PR), **só quando o usuário pedir**.
- Push para `origin` (github.com/wfanjos/v22FitConnect_v2) só quando o usuário pedir.
- GitHub Actions roda lint, checagem de tipos e testes a cada push (a configurar na fase 0).

## Stack

- **App**: Expo (React Native) + TypeScript, Android e iOS (iOS só vai para a App Store quando a taxa anual da Apple for paga). Versão mínima: padrão do Expo.
- **Web**: React + Vite (área do professor + admin), responsivo com foco no computador.
- **Backend**: Supabase (Postgres, Auth, Storage, Edge Functions). Projeto **"V22 Fit Connect"**, ref `bherdjbwfftejezagmlr`, região `sa-east-1` (São Paulo), plano grátis.
- **Offline**: SQLite puro (`expo-sqlite`) com sincronização própria (sem PowerSync/WatermelonDB). Motor de sincronização é da fase 0, testado pesado antes de qualquer tela depender dele.
- **Login**: e-mail/senha, Google e Apple.
- **Idiomas**: PT/EN/ES, segue o aparelho (fora desses, inglês), com troca manual. Nenhum texto visível direto no código.
- **Monitoramento**: Sentry (erros) e PostHog (uso), ambos no plano grátis.
- **Testes**: Jest + Testing Library (unidade/componentes), testes SQL de RLS (rodam no GitHub Actions num banco temporário, sem tocar na nuvem), Maestro (ponta a ponta).

## Supabase

- **Um único projeto na nuvem**, usado do desenvolvimento até a produção definitiva. Não criar segundo projeto nem sugerir Supabase local/Docker (o usuário testa em 2+ celulares reais). A outra vaga grátis da conta é do projeto "Nossas Compras" — nunca mexer nele.
- Migrations sempre versionadas em `supabase/migrations/`. Regras que protegem dados ficam no banco (RLS em todas as tabelas; operações sensíveis como aceitar convite, desvincular e excluir conta em funções no servidor), não só no app.
- Antes do beta, os dados de teste da nuvem são limpos.
- Limites grátis a vigiar: 500 MB de banco, 1 GB de arquivos, 50 mil usuários ativos/mês, pausa após 7 dias sem uso.

## Estrutura do repositório (planejada — ver `docs/fases.md`)

```
apps/mobile      App Expo (React Native)
apps/web         Site React + Vite (área do professor + admin)
packages/core    Regras compartilhadas: tipos, cálculos (volume, recordes, sequência), validações, conversão kg/lb
packages/i18n    Textos PT/EN/ES
packages/ui      Tokens de design (cores, espaçamentos, tipografia)
supabase/        Migrations, políticas RLS, funções, seeds e testes do banco
landing/         Landing page estática
```

## Onde estão as coisas hoje

- `docs/` — especificação (ver "Fontes da verdade" acima).
- `docs/mockups/index.html` — mockups em HTML (abrir no navegador), com alternância claro/escuro. Rodada 1: base visual + 15 telas principais (cada uma identificada pelo código de `docs/telas.md`). Publicado em https://claude.ai/artifact/63XCPKgm3LcFxLD5kj3SYu. As demais telas ganham mockup em rodadas futuras, por fase.
- `assets/brand/` — logo, símbolo, SVGs, PNGs transparentes e arquivos prontos para o Expo em `assets/brand/expo/` (ícone, ícone adaptativo, splash, favicon). Ver `assets/brand/README.md`.
- `assets/brand/mascote/` e `docs/mascote/prompts.md` — mascote (harpia) e prompts para novas poses.

## Direção visual (resumo — fonte: `docs/mockups/index.html`)

Tema escuro e claro, seguindo o sistema com troca manual. Fontes: **Archivo** (títulos e números, largura expandida) + **Figtree** (texto). Ícones: **Lucide** (contorno). Cartão "Treino de hoje": vinho no tema escuro, marinho no claro.

| Token | Tema escuro | Tema claro |
|---|---|---|
| Fundo (`bg`) | `#040C19` | `#F5EFE3` |
| Superfície (`surface`) | `#0B172A` | `#FFFCF6` |
| Superfície 2 | `#132440` | `#ECE4D3` |
| Linha | `#1D2E4B` | `#DED4C0` |
| Texto | `#EFE8D8` | `#0A2143` |
| Texto secundário | `#8E9AB1` | `#5B6781` |
| Destaque (vermelho harpia) | `#C8323D` | `#AF2530` |
| Destaque pressionado | `#A92631` | `#921C27` |
| Texto sobre destaque | `#FFF6EA` | `#FFF8EE` |

Nenhuma cor, raio ou espaçamento direto em componente: tudo vem dos tokens (`packages/ui`, a criar na fase 0).

## Navegação principal

- **Aluno**: 5 abas — Início · Séries · Progresso · Professores · Perfil.
- **Professor**: 4 abas — Painel · Alunos · Modelos · Perfil. Chave "Usar como aluno" no Perfil troca para as abas do aluno, com faixa no topo.
- **Treino em execução (TR)**: tela cheia, fora das abas, botões grandes.
- **Tablet**: lista e detalhe lado a lado.

## Pronto quando

Telas da fase feitas em PT/EN/ES, tema claro e escuro, tablet, fonte do sistema respeitada e testes passando.

## Skills e agentes do projeto (`.claude/`)

- Skill `nova-tela` — processo para implementar uma tela a partir do mockup e da especificação.
- Skills `frontend-design` e `vercel-react-best-practices` — referência de design e de performance React.
- Agente `revisor-codigo` — revisa (sem editar) contra a especificação, mockups, tokens, LGPD e RLS. Usar antes de considerar uma tela/tabela/regra pronta.
- Agente `agente-teste` — escreve e roda testes baseados na especificação.

## Status atual

Especificação da v1 completa e mockups da rodada 1 prontos. Projeto Supabase criado em 2026-09-28 (vazio). Próximo passo: **fase 0 (fundação + motor de sincronização)**. Contas: Expo `Wfanjos`, Sentry org `dosanjos`, PostHog região EU. Login Google: cliente Web configurado no Supabase; clientes Android/iOS na fase 1. Apple na fase 13.
