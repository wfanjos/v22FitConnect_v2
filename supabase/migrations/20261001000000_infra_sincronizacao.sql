-- Infraestrutura de sincronização offline (fase 0).
-- Não cria tabelas de negócio: elas nascem na fase da tela que as usa e chamam
-- public.preparar_tabela_sincronizada() para entrar na sincronização.
--
-- Regras (docs/modelo-dados.md, "Convenções" e "Sincronização offline"):
--   * toda tabela sincronizada tem id (uuid v7 gerado no aparelho), criado_em,
--     atualizado_em, excluido_em (exclusão lógica) e seq_sinc;
--   * o servidor é quem preenche atualizado_em e seq_sinc: o último a chegar vence;
--   * o aparelho baixa tudo com seq_sinc maior que o último recebido;
--   * o aparelho envia em lote; cada operação é validada pelo RLS da tabela;
--   * exclusão física não é permitida ao usuário: só excluido_em (a lápide chega aos aparelhos).

-- ---------------------------------------------------------------------------
-- Numeração global de sincronização
-- ---------------------------------------------------------------------------

create sequence public.sequencia_sinc as bigint;

-- Quanto tempo uma gravação precisa "esfriar" antes de ser entregue por sinc_baixar.
-- O número seq_sinc é tirado ao gravar, mas a linha só fica visível ao confirmar a transação.
-- Se entregássemos linhas recentes, uma transação lenta poderia confirmar depois e sua linha
-- (com número menor) ficaria para trás do cursor do aparelho para sempre. Pela API do Supabase
-- uma transação dura no máximo ~8 s (statement_timeout do papel authenticated); 15 s dá folga.
-- Custo: uma alteração leva até 15 s para chegar aos outros aparelhos.
create function public.sinc_janela_segura()
returns interval
language sql
stable
as $$ select interval '15 seconds' $$;

-- ---------------------------------------------------------------------------
-- Registro das tabelas que participam da sincronização
-- ---------------------------------------------------------------------------

create table public.tabelas_sincronizadas (
  nome text primary key,
  -- Colunas que ficam só no servidor (ex.: localização exata do professor):
  -- nunca descem para o aparelho, nunca são sobrescritas pelo envio e o usuário
  -- não consegue lê-las nem direto pela API (permissão por coluna).
  colunas_ocultas text[] not null default '{}',
  -- leitura_escrita: o aparelho cria e altera (campo a campo).
  -- somente_insercao: o aparelho só cria (histórico imutável, ex.: versões de série).
  -- somente_servidor: o aparelho só lê; quem grava são funções do servidor (vínculos, convites...).
  modo text not null default 'leitura_escrita'
    check (modo in ('leitura_escrita', 'somente_insercao', 'somente_servidor'))
);

alter table public.tabelas_sincronizadas enable row level security;

create policy leitura_autenticados on public.tabelas_sincronizadas
  for select to authenticated using (true);

revoke all on public.tabelas_sincronizadas from anon, authenticated;
grant select on public.tabelas_sincronizadas to authenticated;

-- ---------------------------------------------------------------------------
-- Operações já aplicadas (evita aplicar duas vezes um lote reenviado após falha de rede)
-- ---------------------------------------------------------------------------

create table public.sinc_operacoes (
  usuario_id uuid not null default auth.uid(),
  id_operacao uuid not null,
  aplicada_em timestamptz not null default now(),
  primary key (usuario_id, id_operacao)
);

alter table public.sinc_operacoes enable row level security;

create policy proprias_leitura on public.sinc_operacoes
  for select to authenticated using (usuario_id = auth.uid());

-- Só a função sinc_registrar_operacao (abaixo) grava aqui.
revoke all on public.sinc_operacoes from anon, authenticated;
grant select on public.sinc_operacoes to authenticated;

create function public.sinc_registrar_operacao(p_id_operacao uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_linhas integer;
begin
  if auth.uid() is null then
    raise exception 'não autenticado' using errcode = '28000';
  end if;
  insert into public.sinc_operacoes (usuario_id, id_operacao)
  values (auth.uid(), p_id_operacao)
  on conflict do nothing;
  get diagnostics v_linhas = row_count;
  return v_linhas > 0;
end;
$$;

-- Limpeza periódica (agendar com pg_cron na fase de backup/LGPD). Uma operação reenviada depois
-- do prazo seria tratada como nova gravação (vale o último a chegar), sem outro dano.
create function public.sinc_limpar_operacoes(p_dias integer default 30)
returns bigint
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_removidas bigint;
begin
  delete from public.sinc_operacoes where aplicada_em < now() - make_interval(days => p_dias);
  get diagnostics v_removidas = row_count;
  return v_removidas;
end;
$$;

-- ---------------------------------------------------------------------------
-- Gatilho: carimbos preenchidos pelo servidor
-- ---------------------------------------------------------------------------

-- security definer: quem grava não precisa de permissão na sequência.
create function public.carimbar_sincronizacao()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    -- O aparelho pode informar a data em que criou o registro offline, mas nunca no futuro.
    new.criado_em := least(coalesce(new.criado_em, clock_timestamp()), clock_timestamp());
  else
    -- Identidade e data de criação nunca mudam.
    new.id := old.id;
    new.criado_em := old.criado_em;
  end if;
  new.atualizado_em := clock_timestamp();
  new.seq_sinc := nextval('public.sequencia_sinc');
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Habilita uma tabela de negócio na sincronização
-- Pode ser chamada de novo (por exemplo depois de adicionar colunas): é idempotente.
-- ---------------------------------------------------------------------------

create function public.preparar_tabela_sincronizada(
  p_tabela regclass,
  p_colunas_ocultas text[] default '{}',
  p_modo text default 'leitura_escrita'
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_nome text;
  v_falta text;
  v_coluna text;
  v_visiveis text;
begin
  if p_modo not in ('leitura_escrita', 'somente_insercao', 'somente_servidor') then
    raise exception 'modo inválido: %', p_modo;
  end if;

  select c.relname into v_nome
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where c.oid = p_tabela and n.nspname = 'public';
  if v_nome is null then
    raise exception 'a tabela % precisa estar no schema public', p_tabela;
  end if;

  select string_agg(t.col, ', ' order by t.ordem) into v_falta
    from unnest(array['id', 'criado_em', 'atualizado_em', 'excluido_em', 'seq_sinc'])
         with ordinality as t(col, ordem)
   where not exists (
     select 1 from pg_attribute
      where attrelid = p_tabela and attname = t.col and attnum > 0 and not attisdropped
   );
  if v_falta is not null then
    raise exception 'a tabela % não tem as colunas de sincronização: %', v_nome, v_falta;
  end if;

  if not exists (
    select 1 from pg_index i
     where i.indrelid = p_tabela and i.indisprimary
       and i.indnatts = 1
       and (select attname from pg_attribute
             where attrelid = p_tabela and attnum = i.indkey[0]) = 'id'
  ) then
    raise exception 'a tabela % precisa ter chave primária apenas em id', v_nome;
  end if;

  foreach v_coluna in array coalesce(p_colunas_ocultas, '{}') loop
    if not exists (
      select 1 from pg_attribute
       where attrelid = p_tabela and attname = v_coluna and attnum > 0 and not attisdropped
    ) then
      raise exception 'coluna oculta % não existe na tabela %', v_coluna, v_nome;
    end if;
    if v_coluna in ('id', 'criado_em', 'atualizado_em', 'excluido_em', 'seq_sinc') then
      raise exception 'a coluna de controle % não pode ser oculta', v_coluna;
    end if;
  end loop;

  execute format('alter table public.%I enable row level security', v_nome);

  execute format('drop trigger if exists carimbar_sincronizacao on public.%I', v_nome);
  execute format(
    'create trigger carimbar_sincronizacao before insert or update on public.%I '
    'for each row execute function public.carimbar_sincronizacao()',
    v_nome
  );

  execute format(
    'create index if not exists %I on public.%I (seq_sinc)',
    'ix_' || v_nome || '_seq_sinc', v_nome
  );

  -- Exclusão é lógica (excluido_em): o usuário não apaga linhas de verdade, senão a
  -- exclusão não chegaria aos outros aparelhos. Apagar de vez (ex.: exclusão de conta
  -- depois de 30 dias) é função do servidor.
  execute format('revoke delete on public.%I from anon, authenticated', v_nome);

  if p_modo = 'leitura_escrita' then
    execute format('grant insert, update on public.%I to authenticated', v_nome);
  elsif p_modo = 'somente_insercao' then
    execute format('revoke update on public.%I from anon, authenticated', v_nome);
    execute format('grant insert on public.%I to authenticated', v_nome);
  else
    execute format('revoke insert, update on public.%I from anon, authenticated', v_nome);
  end if;

  -- Colunas ocultas: o usuário perde a leitura delas (nem direto pela API). Sem colunas
  -- ocultas a leitura continua da tabela inteira (assim colunas novas não precisam de permissão).
  -- Com colunas ocultas, rode esta função de novo ao adicionar colunas à tabela.
  execute format('revoke select on public.%I from anon, authenticated', v_nome);
  if cardinality(coalesce(p_colunas_ocultas, '{}')) = 0 then
    execute format('grant select on public.%I to authenticated', v_nome);
  else
    select string_agg(format('%I', a.attname), ', ' order by a.attnum) into v_visiveis
      from pg_attribute a
     where a.attrelid = p_tabela and a.attnum > 0 and not a.attisdropped
       and a.attname <> all (p_colunas_ocultas);
    execute format('grant select (%s) on public.%I to authenticated', v_visiveis, v_nome);
  end if;

  insert into public.tabelas_sincronizadas (nome, colunas_ocultas, modo)
  values (v_nome, coalesce(p_colunas_ocultas, '{}'), p_modo)
  on conflict (nome) do update
    set colunas_ocultas = excluded.colunas_ocultas, modo = excluded.modo;
end;
$$;

-- ---------------------------------------------------------------------------
-- Envio em lote
--
-- p_operacoes: [{ "id_operacao": uuid, "tabela": text, "registro": {linha, completa ou parcial} }]
-- No máximo 200 por chamada. Aplicadas na ordem recebida (pais antes dos filhos).
-- Cada registro pode ser parcial: só as colunas enviadas são gravadas (campo a campo).
-- Cada operação é independente: uma que falha (RLS, chave estrangeira...) não derruba as outras.
-- Roda como o próprio usuário (security invoker): o RLS de cada tabela decide.
-- Devolve [{ "id_operacao", "ok", "duplicada"?, "codigo"?, "mensagem"? }, ...].
-- ---------------------------------------------------------------------------

create function public.sinc_enviar(p_operacoes jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_op jsonb;
  v_id uuid;
  v_tabela text;
  v_registro jsonb;
  v_ocultas text[];
  v_modo text;
  v_chaves text[];
  v_colunas text;
  v_atualizacoes text;
  v_linhas integer;
  v_resultados jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'não autenticado' using errcode = '28000';
  end if;
  if p_operacoes is null or jsonb_typeof(p_operacoes) <> 'array' then
    raise exception 'p_operacoes deve ser uma lista' using errcode = '22023';
  end if;
  if jsonb_array_length(p_operacoes) > 200 then
    raise exception 'no máximo 200 operações por chamada' using errcode = '22023';
  end if;

  for v_op in select value from jsonb_array_elements(p_operacoes) loop
    v_id := null;
    begin
      v_id := (v_op ->> 'id_operacao')::uuid;
      v_tabela := v_op ->> 'tabela';
      v_registro := v_op -> 'registro';

      if v_id is null or v_tabela is null or jsonb_typeof(v_registro) is distinct from 'object' then
        raise exception 'operação inválida' using errcode = '22023';
      end if;

      -- Dois reenvios simultâneos da mesma operação esperam um pelo outro.
      perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || v_id::text, 0));

      if exists (
        select 1 from public.sinc_operacoes
         where usuario_id = auth.uid() and id_operacao = v_id
      ) then
        v_resultados := v_resultados || jsonb_build_object(
          'id_operacao', v_id, 'ok', true, 'duplicada', true
        );
        continue;
      end if;

      select t.colunas_ocultas, t.modo into v_ocultas, v_modo
        from public.tabelas_sincronizadas t
       where t.nome = v_tabela;
      if not found then
        raise exception 'tabela não sincronizada: %', v_tabela using errcode = '42P01';
      end if;
      if v_modo = 'somente_servidor' then
        raise exception 'tabela somente leitura para o aparelho: %', v_tabela using errcode = '42501';
      end if;

      if v_registro ->> 'id' is null then
        raise exception 'registro sem id' using errcode = '22023';
      end if;

      -- Só as colunas enviadas, menos as que o servidor controla (seq_sinc, atualizado_em)
      -- e as ocultas. Assim um app de versão antiga, que não conhece uma coluna nova,
      -- não a apaga ao salvar, e uma exclusão pode mandar só {id, excluido_em}.
      select array_agg(a.attname order by a.attnum)
        into v_chaves
        from pg_attribute a
       where a.attrelid = format('public.%I', v_tabela)::regclass
         and a.attnum > 0 and not a.attisdropped
         and a.attname <> all (v_ocultas)
         and a.attname not in ('seq_sinc', 'atualizado_em')
         and v_registro ? a.attname;

      v_linhas := 0;
      if v_modo = 'leitura_escrita' then
        select string_agg(format('%1$I = r.%1$I', c), ', ')
          into v_atualizacoes
          from unnest(v_chaves) as c
         where c not in ('id', 'criado_em');

        -- 1) tenta atualizar o registro que já existe e que o usuário pode ver
        execute format(
          'update public.%1$I t set %2$s from jsonb_populate_record(null::public.%1$I, $1) r where t.id = r.id',
          v_tabela, coalesce(v_atualizacoes, 'id = t.id')
        ) using v_registro;
        get diagnostics v_linhas = row_count;
      end if;

      -- 2) se não existe, cria com as colunas enviadas (as demais usam o valor padrão)
      if v_linhas = 0 then
        select string_agg(format('%I', c), ', ') into v_colunas from unnest(v_chaves) as c;
        execute format(
          'insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I, $1)',
          v_tabela, v_colunas
        ) using v_registro;
      end if;

      perform public.sinc_registrar_operacao(v_id);
      v_resultados := v_resultados || jsonb_build_object('id_operacao', v_id, 'ok', true);
    exception when others then
      v_resultados := v_resultados || jsonb_build_object(
        'id_operacao', v_id, 'ok', false, 'codigo', sqlstate, 'mensagem', sqlerrm
      );
    end;
  end loop;

  return v_resultados;
end;
$$;

-- ---------------------------------------------------------------------------
-- Download incremental
--
-- Devolve até p_limite linhas (máx. 1000) com seq_sinc maior que p_depois_de, em ordem,
-- incluindo as excluídas logicamente. Só vem o que o RLS permite ler e sem as colunas ocultas.
-- Para na primeira linha mais recente que sinc_janela_segura(): o aparelho nunca avança o
-- cursor além de uma linha que ainda pode ter vizinhas com número menor sem confirmar.
-- ---------------------------------------------------------------------------

create function public.sinc_baixar(
  p_tabela text,
  p_depois_de bigint default 0,
  p_limite integer default 500
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_ocultas text[];
  v_colunas text;
  v_linhas jsonb;
begin
  if auth.uid() is null then
    raise exception 'não autenticado' using errcode = '28000';
  end if;

  select t.colunas_ocultas into v_ocultas
    from public.tabelas_sincronizadas t
   where t.nome = p_tabela;
  if not found then
    raise exception 'tabela não sincronizada: %', p_tabela using errcode = '42P01';
  end if;

  select string_agg(format('%I', a.attname), ', ' order by a.attnum)
    into v_colunas
    from pg_attribute a
   where a.attrelid = format('public.%I', p_tabela)::regclass
     and a.attnum > 0 and not a.attisdropped
     and a.attname <> all (v_ocultas);

  p_limite := least(greatest(coalesce(p_limite, 500), 1), 1000);

  execute format(
    'with pagina as ( '
    '  select %2$s from public.%1$I where seq_sinc > $1 order by seq_sinc limit $2 '
    '), corte as ( '
    '  select min(seq_sinc) as seq from pagina where atualizado_em >= clock_timestamp() - $3 '
    ') '
    'select coalesce(jsonb_agg(to_jsonb(p) order by p.seq_sinc), ''[]''::jsonb) '
    'from pagina p cross join corte c where c.seq is null or p.seq_sinc < c.seq',
    p_tabela, v_colunas
  ) into v_linhas using coalesce(p_depois_de, 0), p_limite, public.sinc_janela_segura();

  return v_linhas;
end;
$$;

-- ---------------------------------------------------------------------------
-- Download de várias tabelas numa chamada só (economiza tráfego e requisições)
--
-- p_cursores: { "tabela": ultimo_seq_sinc_recebido, ... } (no máximo 100 tabelas)
-- Devolve { "dados": { "tabela": [linhas] }, "mais": ["tabela", ...] }
--   * tabelas sem novidade nem aparecem em "dados" (resposta vazia = ~25 bytes);
--   * "mais" lista as tabelas que podem ter mais linhas: o aparelho pergunta de novo só por elas;
--   * cada tabela segue as regras de sinc_baixar (RLS, colunas ocultas, janela segura);
--   * no máximo ~2000 linhas por chamada; as tabelas que ficarem de fora vão em "mais".
-- ---------------------------------------------------------------------------

create function public.sinc_baixar_tudo(p_cursores jsonb, p_limite integer default 500)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tabela text;
  v_cursor jsonb;
  v_linhas jsonb;
  v_limite integer;
  v_qtd integer;
  v_total integer := 0;
  v_dados jsonb := '{}'::jsonb;
  v_mais jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'não autenticado' using errcode = '28000';
  end if;
  if jsonb_typeof(p_cursores) is distinct from 'object' then
    raise exception 'p_cursores deve ser um objeto {tabela: cursor}' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_object_keys(p_cursores)) > 100 then
    raise exception 'no máximo 100 tabelas por chamada' using errcode = '22023';
  end if;

  v_limite := least(greatest(coalesce(p_limite, 500), 1), 1000);

  for v_tabela, v_cursor in select key, value from jsonb_each(p_cursores) loop
    if v_total >= 2000 then
      v_mais := v_mais || to_jsonb(v_tabela);
      continue;
    end if;

    v_linhas := public.sinc_baixar(
      v_tabela,
      coalesce(case when jsonb_typeof(v_cursor) = 'number' then (v_cursor #>> '{}')::bigint end, 0),
      v_limite
    );
    v_qtd := jsonb_array_length(v_linhas);
    if v_qtd > 0 then
      v_dados := v_dados || jsonb_build_object(v_tabela, v_linhas);
      v_total := v_total + v_qtd;
    end if;
    if v_qtd >= v_limite then
      v_mais := v_mais || to_jsonb(v_tabela);
    end if;
  end loop;

  return jsonb_build_object('dados', v_dados, 'mais', v_mais);
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissões das funções: só usuários autenticados
-- ---------------------------------------------------------------------------

revoke all on function public.sinc_janela_segura() from public, anon;
grant execute on function public.sinc_janela_segura() to authenticated;
revoke all on function public.carimbar_sincronizacao() from public, anon, authenticated;
revoke all on function public.preparar_tabela_sincronizada(regclass, text[], text) from public, anon, authenticated;
revoke all on function public.sinc_registrar_operacao(uuid) from public, anon, authenticated;
revoke all on function public.sinc_limpar_operacoes(integer) from public, anon, authenticated;
revoke all on function public.sinc_enviar(jsonb) from public, anon;
revoke all on function public.sinc_baixar(text, bigint, integer) from public, anon;
revoke all on function public.sinc_baixar_tudo(jsonb, integer) from public, anon;

grant execute on function public.sinc_enviar(jsonb) to authenticated;
grant execute on function public.sinc_baixar(text, bigint, integer) to authenticated;
grant execute on function public.sinc_baixar_tudo(jsonb, integer) to authenticated;
-- sinc_enviar roda como o usuário e chama sinc_registrar_operacao (security definer):
grant execute on function public.sinc_registrar_operacao(uuid) to authenticated;

-- Ninguém além do servidor mexe na sequência.
revoke all on sequence public.sequencia_sinc from public, anon, authenticated;
