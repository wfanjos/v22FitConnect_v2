-- Ajustes de segurança da infraestrutura de sincronização, a partir dos alertas do Supabase:
--   1) sinc_janela_segura sem search_path fixo;
--   2) sinc_registrar_operacao (security definer) podia ser chamada de fora pela API.
--      Passa para o schema "interno", que a API não expõe: só sinc_enviar a usa.

alter function public.sinc_janela_segura() set search_path = public, pg_temp;

create schema interno;
revoke all on schema interno from public, anon;
grant usage on schema interno to authenticated;

alter function public.sinc_registrar_operacao(uuid) set schema interno;

-- sinc_enviar passa a chamar a função no schema interno (o resto é igual ao original).
create or replace function public.sinc_enviar(p_operacoes jsonb)
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

      perform interno.sinc_registrar_operacao(v_id);
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
