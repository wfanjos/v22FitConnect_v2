---
name: nova-tela
description: Use ao implementar uma tela nova (ou refazer uma existente) do app V22 Fit Connect a partir da especificação em docs/telas.md e do mockup em docs/mockups/index.html. Aciona em pedidos como "implementa a tela AL-01", "cria a tela de Login", "constrói o mockup do treino".
---

# Nova tela — V22 Fit Connect

Processo obrigatório para transformar uma tela da especificação em uma tela de verdade, sem inventar nada que ainda não foi decidido. Siga os passos nesta ordem; não pule etapas mesmo que a tela pareça simples.

## 0. Identifique a tela

Toda tela tem um código em `docs/telas.md` (`E` entrada · `AL` aluno · `TR` treino · `PR` professor · `C` compartilhadas · `W` web do professor · `AD` admin · `LP` landing). Confirme qual é. Se o pedido for ambíguo ou não corresponder a nenhum código, **pare e pergunte** — não implemente a tela "que parece mais provável".

Confira também em `docs/fases.md` se a tela pertence à fase atual. Se for de uma fase futura (ou depender de algo ainda não pronto, como o motor de sincronização), avise antes de começar.

## 1. Encontre o mockup

Os mockups ficam em `docs/mockups/index.html` (um único HTML com as telas agrupadas, cada uma identificada pelo código). Abra e examine a tela correspondente antes de escrever código, nos dois temas (claro e escuro): layout, textos, hierarquia, estados mostrados.

Se a tela ainda não tem mockup, **não implemente de cabeça**. Avise que falta o mockup e proponha fazê-lo primeiro (os mockups são feitos em rodadas, por fase).

## 2. Leia a especificação que governa a tela

1. A linha da tela em `docs/telas.md` (conteúdo) e as notas da seção dela (ex.: "Tela cheia, fora das abas, botões grandes" no `TR`).
2. As regras relacionadas em `docs/planejamento-app.md` — leia a seção inteira, não só a frase que parece relevante.
3. As tabelas envolvidas em `docs/modelo-dados.md`: colunas, RLS, se a tabela vai para o SQLite (offline) ou é só online.
4. Atenção especial a: campos obrigatórios vs. opcionais, erros e casos de borda, quem pode ver/editar o quê, e comportamento offline.

## 3. Regra inegociável: nunca inventar informação

Se faltar um detalhe que não está na especificação nem é visualmente óbvio no mockup (uma mensagem de erro, um limite numérico, o texto de um aviso legal, o comportamento sem internet) — **pare e pergunte ao usuário**. Não escolha "o que parece razoável", nem para detalhes pequenos. Depois da resposta, registre a decisão no doc correspondente em `docs/`.

## 4. Reaproveite os padrões já estabelecidos

Antes de criar um componente, procure um equivalente nos componentes base (botão, campo, cartão, lista, estado vazio com mascote) e nas telas irmãs. Padrões recorrentes:

- **Tela com abas**: aluno (Início · Séries · Progresso · Professores · Perfil) ou professor (Painel · Alunos · Modelos · Perfil); faixa no topo quando o professor está no modo aluno.
- **Treino em execução (TR)**: tela cheia, fora das abas, botões grandes para usar com mão suada ou luva.
- **Tablet**: lista à esquerda, detalhe à direita.
- **Web (W/AD)**: responsivo, foco no computador.

Se a tela não se encaixa em nenhum padrão existente, avise antes de criar um novo.

## 5. Tokens, textos e ícones

- Cores, raios, espaçamentos e tipografia vêm dos tokens em `packages/ui`. Nunca hex, `borderRadius` ou `padding` "no olho". Se faltar um token, proponha-o antes de usar.
- Fontes: Archivo (títulos e números) e Figtree (texto), como no mockup.
- Ícones Lucide (contorno), sem emoji.
- Nenhum texto visível direto no código: tudo pelo i18n, com PT (texto exato do mockup), EN e ES preenchidos. Texto criado pelo usuário não é traduzido.

## 6. Implemente

- Reproduza todos os elementos do mockup e todo o conteúdo listado em `docs/telas.md`.
- Estados: carregando, vazio (com mascote quando previsto), erro e offline.
- Acessibilidade: `accessibilityLabel`/`accessibilityRole` em botões só-ícone e campos; respeitar a fonte grande do sistema sem quebrar a tela.
- Ligue a tela à navegação. Se não estiver claro de onde ela vem e para onde vai, confira o fluxo em `docs/telas.md` e, se ainda faltar, pergunte.

## 7. Checagem de LGPD e acesso

Se a tela lê ou grava dado pessoal ou de saúde (anamnese, avaliações, fotos), confira que a regra de acesso bate com `docs/modelo-dados.md` (dados de saúde só para o próprio aluno e professor com `share_health = true` no vínculo ativo). Qualquer dado novo não previsto deve ser sinalizado ao usuário, não implementado em silêncio.

## 8. Critérios de pronto e fechamento

A tela só está pronta com: PT/EN/ES, tema claro e escuro, tablet, fonte do sistema e testes passando. Rode o agente `agente-teste` e depois o `revisor-codigo`.

Ao terminar, resuma em poucas linhas: código da tela, mockup e seções da especificação usados, e qualquer pendência que ficou para o usuário responder.
