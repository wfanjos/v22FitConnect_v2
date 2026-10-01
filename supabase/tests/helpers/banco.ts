import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Linha = Record<string, any>;

export type Sessao = {
  query: (sql: string, params?: unknown[]) => Promise<Linha[]>;
  /** Executa e devolve a mensagem de erro do Postgres em vez de lançar. */
  erro: (sql: string, params?: unknown[]) => Promise<string>;
  rpc: (funcao: string, ...args: unknown[]) => Promise<any>;
};

export type Banco = {
  db: PGlite;
  /** Administrador (ignora RLS), para preparar e conferir dados. */
  admin: Sessao;
  /** Usuário autenticado do Supabase (papel `authenticated`, auth.uid() = id). */
  como: (usuarioId: string) => Sessao;
  /** Visitante sem login (papel `anon`). */
  anonimo: Sessao;
  fechar: () => Promise<void>;
};

// Imita o que o Supabase já traz pronto: papéis, auth.uid() e permissões padrão do schema public.
const PRELUDIO = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(
      coalesce(
        current_setting('request.jwt.claim.sub', true),
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
      ),
      ''
    )::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

const PASTA_MIGRATIONS = join(__dirname, '..', '..', 'migrations');

export const migrations = () =>
  readdirSync(PASTA_MIGRATIONS)
    .filter((nome) => nome.endsWith('.sql'))
    .sort()
    .map((nome) => ({ nome, sql: readFileSync(join(PASTA_MIGRATIONS, nome), 'utf8') }));

function sessao(db: PGlite, papel: string, usuarioId: string | null): Sessao {
  const executar = async (sql: string, params: unknown[] = []) => {
    await db.exec(`set role ${papel}`);
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [usuarioId ?? '']);
    try {
      // Sem parâmetros aceita vários comandos de uma vez (devolve as linhas do último).
      if (params.length === 0) {
        const resultados = await db.exec(sql);
        return (resultados[resultados.length - 1]?.rows ?? []) as Linha[];
      }
      return (await db.query<Linha>(sql, params)).rows;
    } finally {
      await db.exec('reset role');
      await db.exec(`select set_config('request.jwt.claim.sub', '', false)`);
    }
  };
  return {
    query: executar,
    erro: async (sql, params) => {
      try {
        await executar(sql, params);
        return '';
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },
    rpc: async (funcao, ...args) => {
      const marcadores = args.map((_, i) => `$${i + 1}`).join(', ');
      const linhas = await executar(`select public.${funcao}(${marcadores}) as r`, args);
      return linhas[0]?.r;
    },
  };
}

// Tabelas que só existem nos testes (as tabelas de negócio nascem nas fases das telas).
export const TABELAS_DE_TESTE = `
  create table public.teste_itens (
    id uuid primary key,
    dono_id uuid not null,
    nome text,
    valor integer,
    criado_em timestamptz not null default now(),
    atualizado_em timestamptz not null default now(),
    excluido_em timestamptz,
    seq_sinc bigint not null default 0
  );
  select public.preparar_tabela_sincronizada('public.teste_itens');
  create policy dono_tudo on public.teste_itens for all to authenticated
    using (dono_id = auth.uid()) with check (dono_id = auth.uid());

  create table public.teste_filhos (
    id uuid primary key,
    item_id uuid not null references public.teste_itens(id),
    dono_id uuid not null,
    nome text,
    criado_em timestamptz not null default now(),
    atualizado_em timestamptz not null default now(),
    excluido_em timestamptz,
    seq_sinc bigint not null default 0
  );
  select public.preparar_tabela_sincronizada('public.teste_filhos');
  create policy dono_tudo on public.teste_filhos for all to authenticated
    using (dono_id = auth.uid()) with check (dono_id = auth.uid());

  create table public.teste_segredos (
    id uuid primary key,
    dono_id uuid not null,
    nome text,
    segredo text,
    criado_em timestamptz not null default now(),
    atualizado_em timestamptz not null default now(),
    excluido_em timestamptz,
    seq_sinc bigint not null default 0
  );
  select public.preparar_tabela_sincronizada('public.teste_segredos', array['segredo']);
  create policy dono_tudo on public.teste_segredos for all to authenticated
    using (dono_id = auth.uid()) with check (dono_id = auth.uid());

  -- RLS ligado e nenhuma política: ninguém lê nem grava.
  create table public.teste_sem_politica (
    id uuid primary key,
    criado_em timestamptz not null default now(),
    atualizado_em timestamptz not null default now(),
    excluido_em timestamptz,
    seq_sinc bigint not null default 0
  );
  select public.preparar_tabela_sincronizada('public.teste_sem_politica');

  -- Existe, mas não foi registrada na sincronização.
  create table public.teste_nao_registrada (id uuid primary key, dono_id uuid);
  alter table public.teste_nao_registrada enable row level security;
  create policy dono_tudo on public.teste_nao_registrada for all to authenticated
    using (dono_id = auth.uid()) with check (dono_id = auth.uid());
`;

export async function criarBanco(
  opcoes: { comTabelasDeTeste?: boolean; janelaSegura?: string } = {},
): Promise<Banco> {
  const db = new PGlite();
  await db.exec(PRELUDIO);
  for (const { sql } of migrations()) await db.exec(sql);
  // Nos testes o download é imediato; os testes da janela de segurança informam o valor real.
  const janela = opcoes.janelaSegura ?? '0 seconds';
  await db.exec(
    `create or replace function public.sinc_janela_segura() returns interval language sql stable as $$ select interval '${janela}' $$`,
  );
  if (opcoes.comTabelasDeTeste ?? true) await db.exec(TABELAS_DE_TESTE);
  return {
    db,
    admin: sessao(db, 'postgres', null),
    como: (usuarioId) => sessao(db, 'authenticated', usuarioId),
    anonimo: sessao(db, 'anon', null),
    fechar: () => db.close(),
  };
}

// uuids fixos para os testes ficarem legíveis
export const ANA = '00000000-0000-4000-8000-00000000000a';
export const BRUNO = '00000000-0000-4000-8000-00000000000b';

export const uuid = (n: number) => `018f0000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;

export const operacao = (
  n: number,
  tabela: string,
  registro: Record<string, unknown>,
  idOperacao = uuid(1000 + n),
) => ({ id_operacao: idOperacao, tabela, registro });
