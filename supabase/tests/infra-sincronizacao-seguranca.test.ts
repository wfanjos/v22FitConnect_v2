import { ANA, BRUNO, criarBanco, operacao, uuid, type Banco } from './helpers/banco';

const item = (n: number, dono = ANA, extra: Record<string, unknown> = {}) => ({
  id: uuid(n),
  dono_id: dono,
  nome: `item ${n}`,
  valor: n,
  ...extra,
});

describe('janela de segurança do download (transações lentas)', () => {
  let banco: Banco;

  beforeAll(async () => {
    banco = await criarBanco({ janelaSegura: '15 seconds' });
  });
  afterAll(async () => {
    await banco.fechar();
  });
  beforeEach(async () => {
    await banco.admin.query(
      'truncate public.teste_itens, public.teste_filhos, public.sinc_operacoes',
    );
  });

  /** Envelhece uma linha sem passar pelo gatilho (como se tivesse sido gravada há 1 minuto). */
  const envelhecer = async (n: number) => {
    await banco.admin.query(
      `alter table public.teste_itens disable trigger carimbar_sincronizacao`,
    );
    await banco.admin.query(
      `update public.teste_itens set atualizado_em = now() - interval '1 minute' where id = $1`,
      [uuid(n)],
    );
    await banco.admin.query(`alter table public.teste_itens enable trigger carimbar_sincronizacao`);
  };

  const baixar = (depoisDe = 0, limite = 100) =>
    banco.como(ANA).rpc('sinc_baixar', 'teste_itens', depoisDe, limite);

  it('o banco deste grupo usa a janela real de 15 segundos', async () => {
    const [{ j }] = await banco.admin.query(
      `select extract(epoch from public.sinc_janela_segura()) as j`,
    );
    expect(Number(j)).toBe(15);
  });

  it('a migration original define 15 segundos', async () => {
    const { migrations } = await import('./helpers/banco');
    const sql = migrations()
      .map((m) => m.sql)
      .join('\n');
    expect(sql).toMatch(/select interval '15 seconds'/);
  });

  it('linha recém-gravada não é entregue ainda; a antiga é', async () => {
    const s = banco.como(ANA);
    await s.rpc('sinc_enviar', JSON.stringify([operacao(1, 'teste_itens', item(1))]));
    await s.rpc('sinc_enviar', JSON.stringify([operacao(2, 'teste_itens', item(2))]));
    expect(await baixar()).toEqual([]); // as duas são recentes
    await envelhecer(1);
    expect((await baixar()).map((l: any) => l.id)).toEqual([uuid(1)]);
  });

  it('para na primeira linha recente: nada depois dela é entregue, mesmo que já esteja antigo', async () => {
    const s = banco.como(ANA);
    for (const n of [1, 2, 3]) {
      await s.rpc('sinc_enviar', JSON.stringify([operacao(n, 'teste_itens', item(n))]));
    }
    await envelhecer(1);
    await envelhecer(3); // a 2 continua recente, entre as duas antigas
    // A 3 não pode passar na frente da 2: se o aparelho avançasse o cursor até a 3 e a 2
    // confirmasse depois, a 2 ficaria para trás para sempre.
    expect((await baixar()).map((l: any) => l.id)).toEqual([uuid(1)]);
  });

  it('o cursor devolvido nunca passa de uma linha ainda não segura', async () => {
    const s = banco.como(ANA);
    for (const n of [1, 2, 3, 4]) {
      await s.rpc('sinc_enviar', JSON.stringify([operacao(n, 'teste_itens', item(n))]));
    }
    await envelhecer(1);
    await envelhecer(2);
    const primeira = await baixar();
    const ultimoSeq = Number(primeira[primeira.length - 1].seq_sinc);
    expect(primeira.map((l: any) => l.id)).toEqual([uuid(1), uuid(2)]);
    // Quando o resto esfria, a continuação a partir do cursor traz o que faltava.
    await envelhecer(3);
    await envelhecer(4);
    expect((await baixar(ultimoSeq)).map((l: any) => l.id)).toEqual([uuid(3), uuid(4)]);
  });

  it('passada a janela, tudo é entregue', async () => {
    await banco.como(ANA).rpc('sinc_enviar', JSON.stringify([operacao(1, 'teste_itens', item(1))]));
    expect(await baixar()).toEqual([]);
    await banco.admin.query(
      `create or replace function public.sinc_janela_segura() returns interval language sql stable as $$ select interval '0 seconds' $$`,
    );
    expect(await baixar()).toHaveLength(1);
    await banco.admin.query(
      `create or replace function public.sinc_janela_segura() returns interval language sql stable as $$ select interval '15 seconds' $$`,
    );
  });

  it('a janela vale por consulta de cada usuário: linhas de outro usuário (invisíveis) não seguram as dele', async () => {
    await banco
      .como(BRUNO)
      .rpc('sinc_enviar', JSON.stringify([operacao(1, 'teste_itens', item(1, BRUNO))]));
    await banco.como(ANA).rpc('sinc_enviar', JSON.stringify([operacao(2, 'teste_itens', item(2))]));
    await envelhecer(2);
    expect((await baixar()).map((l: any) => l.id)).toEqual([uuid(2)]);
  });
});

describe('função interna fora da API', () => {
  let banco: Banco;
  beforeAll(async () => {
    banco = await criarBanco();
  });
  afterAll(async () => {
    await banco.fechar();
  });

  it('sinc_registrar_operacao não existe mais no schema public (que a API expõe)', async () => {
    const [{ publica, interna }] = await banco.admin.query(
      `select to_regprocedure('public.sinc_registrar_operacao(uuid)') as publica,
              to_regprocedure('interno.sinc_registrar_operacao(uuid)') as interna`,
    );
    expect(publica).toBeNull();
    expect(interna).not.toBeNull();
  });

  it('o schema interno só aceita usuários autenticados, e a função segue sendo do servidor (definer)', async () => {
    const [linha] = await banco.admin.query(
      `select has_schema_privilege('authenticated', 'interno', 'usage') as auth_usa,
              has_schema_privilege('anon', 'interno', 'usage') as anon_usa,
              prosecdef
         from pg_proc where oid = 'interno.sinc_registrar_operacao(uuid)'::regprocedure`,
    );
    expect(linha).toMatchObject({ auth_usa: true, anon_usa: false, prosecdef: true });
  });

  it('sinc_enviar continua registrando as operações pelo schema interno', async () => {
    const r = await banco
      .como(ANA)
      .rpc('sinc_enviar', JSON.stringify([operacao(1, 'teste_itens', item(1), uuid(9100))]));
    expect(r[0].ok).toBe(true);
    const [{ n }] = await banco.admin.query(`select count(*)::int as n from public.sinc_operacoes`);
    expect(n).toBe(1);
  });

  it('sinc_janela_segura tem search_path fixo (alerta do Supabase)', async () => {
    // O auxiliar de teste recria a função só para fixar a janela; a migration de ajuste fixa o caminho.
    const { migrations } = await import('./helpers/banco');
    const sql = migrations()
      .map((m) => m.sql)
      .join(String.fromCharCode(10));
    expect(sql).toMatch(
      /alter function public\.sinc_janela_segura\(\) set search_path = public, pg_temp/,
    );
  });
});

describe('segurança da infraestrutura', () => {
  let banco: Banco;

  beforeAll(async () => {
    banco = await criarBanco();
    await banco.admin.query(`
      create table public.teste_historico (
        id uuid primary key, dono_id uuid not null, texto text,
        criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
        excluido_em timestamptz, seq_sinc bigint not null default 0
      );
      select public.preparar_tabela_sincronizada('public.teste_historico', '{}', 'somente_insercao');
      create policy dono_tudo on public.teste_historico for all to authenticated
        using (dono_id = auth.uid()) with check (dono_id = auth.uid());

      create table public.teste_vinculos (
        id uuid primary key, dono_id uuid not null, texto text,
        criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
        excluido_em timestamptz, seq_sinc bigint not null default 0
      );
      select public.preparar_tabela_sincronizada('public.teste_vinculos', '{}', 'somente_servidor');
      create policy dono_le on public.teste_vinculos for select to authenticated using (dono_id = auth.uid());
      create policy dono_grava on public.teste_vinculos for all to authenticated
        using (dono_id = auth.uid()) with check (dono_id = auth.uid());
    `);
  });
  afterAll(async () => {
    await banco.fechar();
  });
  beforeEach(async () => {
    await banco.admin.query(
      'truncate public.teste_itens, public.teste_filhos, public.teste_segredos, public.teste_historico, public.teste_vinculos, public.sinc_operacoes',
    );
  });

  describe('exclusão física', () => {
    it('usuário e visitante não apagam linhas de tabelas sincronizadas', async () => {
      await banco.admin.query(`insert into public.teste_itens (id, dono_id) values ($1, $2)`, [
        uuid(1),
        ANA,
      ]);
      expect(
        await banco.como(ANA).erro(`delete from public.teste_itens where id = $1`, [uuid(1)]),
      ).toMatch(/permission denied/);
      expect(await banco.anonimo.erro(`delete from public.teste_itens`)).toMatch(
        /permission denied/,
      );
      const [{ n }] = await banco.admin.query(`select count(*)::int as n from public.teste_itens`);
      expect(n).toBe(1);
    });

    it('o servidor (administrador) consegue apagar de vez, por exemplo na exclusão de conta', async () => {
      await banco.admin.query(`insert into public.teste_itens (id, dono_id) values ($1, $2)`, [
        uuid(1),
        ANA,
      ]);
      await banco.admin.query(`delete from public.teste_itens where id = $1`, [uuid(1)]);
      const [{ n }] = await banco.admin.query(`select count(*)::int as n from public.teste_itens`);
      expect(n).toBe(0);
    });

    it('a exclusão lógica continua funcionando pelo envio', async () => {
      const s = banco.como(ANA);
      await s.rpc('sinc_enviar', JSON.stringify([operacao(1, 'teste_itens', item(1))]));
      const r = await s.rpc(
        'sinc_enviar',
        JSON.stringify([
          operacao(2, 'teste_itens', { id: uuid(1), excluido_em: '2026-10-01T10:00:00Z' }),
        ]),
      );
      expect(r[0].ok).toBe(true);
    });
  });

  describe('modos da tabela', () => {
    it('somente_insercao: cria, mas não altera (nem pelo envio nem direto)', async () => {
      const s = banco.como(ANA);
      const criar = await s.rpc(
        'sinc_enviar',
        JSON.stringify([
          operacao(1, 'teste_historico', { id: uuid(1), dono_id: ANA, texto: 'original' }),
        ]),
      );
      expect(criar[0].ok).toBe(true);

      const alterar = await s.rpc(
        'sinc_enviar',
        JSON.stringify([
          operacao(2, 'teste_historico', { id: uuid(1), dono_id: ANA, texto: 'adulterado' }),
        ]),
      );
      expect(alterar[0].ok).toBe(false);
      expect(await s.erro(`update public.teste_historico set texto = 'x'`)).toMatch(
        /permission denied/,
      );
      const [linha] = await banco.admin.query(`select texto from public.teste_historico`);
      expect(linha.texto).toBe('original');
    });

    it('somente_insercao: nem excluir logicamente depois de criada', async () => {
      const s = banco.como(ANA);
      await s.rpc(
        'sinc_enviar',
        JSON.stringify([operacao(1, 'teste_historico', { id: uuid(1), dono_id: ANA, texto: 'a' })]),
      );
      const r = await s.rpc(
        'sinc_enviar',
        JSON.stringify([
          operacao(2, 'teste_historico', { id: uuid(1), excluido_em: '2026-10-01T10:00:00Z' }),
        ]),
      );
      expect(r[0].ok).toBe(false);
      const [linha] = await banco.admin.query(`select excluido_em from public.teste_historico`);
      expect(linha.excluido_em).toBeNull();
    });

    it('somente_servidor: o aparelho lê, mas não grava (a escrita é por função do servidor)', async () => {
      await banco.admin.query(
        `insert into public.teste_vinculos (id, dono_id, texto) values ($1, $2, 'vínculo ativo')`,
        [uuid(1), ANA],
      );
      const s = banco.como(ANA);
      const r = await s.rpc(
        'sinc_enviar',
        JSON.stringify([
          operacao(1, 'teste_vinculos', { id: uuid(2), dono_id: ANA, texto: 'forjado' }),
          operacao(2, 'teste_vinculos', { id: uuid(1), texto: 'alterado' }),
        ]),
      );
      expect(r.map((x: any) => [x.ok, x.codigo])).toEqual([
        [false, '42501'],
        [false, '42501'],
      ]);
      expect(
        await s.erro(`insert into public.teste_vinculos (id, dono_id) values ($1, $2)`, [
          uuid(3),
          ANA,
        ]),
      ).toMatch(/permission denied/);
      expect(
        (await s.rpc('sinc_baixar', 'teste_vinculos', 0, 10)).map((l: any) => l.texto),
      ).toEqual(['vínculo ativo']);
    });

    it('modo inválido é recusado', async () => {
      expect(
        await banco.admin.erro(
          `select public.preparar_tabela_sincronizada('public.teste_itens', '{}', 'qualquer')`,
        ),
      ).toMatch(/modo inválido/);
    });

    it('preparar de novo pode trocar o modo e o registro acompanha', async () => {
      await banco.admin.query(
        `select public.preparar_tabela_sincronizada('public.teste_historico', '{}', 'leitura_escrita')`,
      );
      let [linha] = await banco.admin.query(
        `select modo from public.tabelas_sincronizadas where nome = 'teste_historico'`,
      );
      expect(linha.modo).toBe('leitura_escrita');
      expect(await banco.como(ANA).erro(`update public.teste_historico set texto = 'x'`)).toBe('');
      await banco.admin.query(
        `select public.preparar_tabela_sincronizada('public.teste_historico', '{}', 'somente_insercao')`,
      );
      [linha] = await banco.admin.query(
        `select modo from public.tabelas_sincronizadas where nome = 'teste_historico'`,
      );
      expect(linha.modo).toBe('somente_insercao');
      expect(await banco.como(ANA).erro(`update public.teste_historico set texto = 'x'`)).toMatch(
        /permission denied/,
      );
    });
  });

  describe('colunas ocultas', () => {
    beforeEach(async () => {
      await banco.admin.query(
        `insert into public.teste_segredos (id, dono_id, nome, segredo) values ($1, $2, 'a', 'so-no-servidor')`,
        [uuid(1), ANA],
      );
    });

    it('o usuário não lê a coluna oculta nem direto pela API', async () => {
      const s = banco.como(ANA);
      expect(await s.erro(`select segredo from public.teste_segredos`)).toMatch(
        /permission denied/,
      );
      expect(await s.erro(`select * from public.teste_segredos`)).toMatch(/permission denied/);
      expect(
        await s.erro(`select nome from public.teste_segredos where segredo = 'so-no-servidor'`),
      ).toMatch(/permission denied/);
      expect(await s.query(`select nome from public.teste_segredos`)).toEqual([{ nome: 'a' }]);
      expect(await banco.anonimo.erro(`select nome from public.teste_segredos`)).toMatch(
        /permission denied/,
      );
    });

    it('o administrador (servidor) continua lendo e gravando a coluna', async () => {
      await banco.admin.query(`update public.teste_segredos set segredo = 'novo'`);
      const [linha] = await banco.admin.query(`select segredo from public.teste_segredos`);
      expect(linha.segredo).toBe('novo');
    });

    it('envio e download continuam funcionando com a permissão por coluna', async () => {
      const s = banco.como(ANA);
      const r = await s.rpc(
        'sinc_enviar',
        JSON.stringify([
          operacao(1, 'teste_segredos', { id: uuid(1), nome: 'b', segredo: 'tentativa' }),
        ]),
      );
      expect(r[0].ok).toBe(true);
      const [linha] = await s.rpc('sinc_baixar', 'teste_segredos', 0, 10);
      expect(linha.nome).toBe('b');
      expect(Object.keys(linha)).not.toContain('segredo');
      const [admin] = await banco.admin.query(`select segredo from public.teste_segredos`);
      expect(admin.segredo).toBe('so-no-servidor');
    });

    it('tabela sem colunas ocultas continua legível por inteiro (colunas novas não precisam de permissão)', async () => {
      await banco.admin.query(`alter table public.teste_itens add column coluna_nova text`);
      await banco.admin.query(
        `insert into public.teste_itens (id, dono_id, coluna_nova) values ($1, $2, 'x')`,
        [uuid(1), ANA],
      );
      expect(await banco.como(ANA).query(`select coluna_nova from public.teste_itens`)).toEqual([
        { coluna_nova: 'x' },
      ]);
      const [linha] = await banco.como(ANA).rpc('sinc_baixar', 'teste_itens', 0, 10);
      expect(linha.coluna_nova).toBe('x');
      await banco.admin.query(`alter table public.teste_itens drop column coluna_nova`);
    });
  });

  describe('carimbos e permissões', () => {
    it('criado_em no futuro é limitado ao momento do servidor', async () => {
      await banco
        .como(ANA)
        .rpc(
          'sinc_enviar',
          JSON.stringify([
            operacao(1, 'teste_itens', item(1, ANA, { criado_em: '2099-01-01T00:00:00Z' })),
          ]),
        );
      const [linha] = await banco.admin.query(
        `select criado_em, atualizado_em from public.teste_itens`,
      );
      expect(new Date(linha.criado_em).getFullYear()).toBeLessThan(2099);
      expect(new Date(linha.criado_em).getTime()).toBeLessThanOrEqual(
        new Date(linha.atualizado_em).getTime(),
      );
    });

    it('criado_em no passado é respeitado', async () => {
      await banco
        .como(ANA)
        .rpc(
          'sinc_enviar',
          JSON.stringify([
            operacao(1, 'teste_itens', item(1, ANA, { criado_em: '2020-05-06T07:08:09Z' })),
          ]),
        );
      const [linha] = await banco.admin.query(`select criado_em from public.teste_itens`);
      expect(new Date(linha.criado_em).toISOString()).toBe('2020-05-06T07:08:09.000Z');
    });

    it('ninguém além do servidor usa a sequência de sincronização', async () => {
      for (const sessao of [banco.como(ANA), banco.anonimo]) {
        expect(await sessao.erro(`select nextval('public.sequencia_sinc')`)).toMatch(
          /permission denied/,
        );
        expect(await sessao.erro(`select setval('public.sequencia_sinc', 1)`)).toMatch(
          /permission denied/,
        );
      }
    });

    it('gravar funciona sem o usuário ter permissão na sequência (gatilho é do servidor)', async () => {
      const r = await banco
        .como(ANA)
        .rpc('sinc_enviar', JSON.stringify([operacao(1, 'teste_itens', item(1))]));
      expect(r[0].ok).toBe(true);
      expect(
        await banco
          .como(ANA)
          .erro(`insert into public.teste_itens (id, dono_id) values ($1, $2)`, [uuid(2), ANA]),
      ).toBe('');
    });

    it('funções internas não são chamadas por usuários', async () => {
      const s = banco.como(ANA);
      expect(await s.erro(`select public.carimbar_sincronizacao()`)).toMatch(/permission denied/);
      expect(
        await s.erro(`select public.preparar_tabela_sincronizada('public.teste_itens')`),
      ).toMatch(/permission denied/);
      expect(await s.erro(`select public.sinc_limpar_operacoes(1)`)).toMatch(/permission denied/);
    });

    it('visitante (anon) não chama nenhuma função de sincronização', async () => {
      for (const chamada of [
        `select public.sinc_enviar('[]'::jsonb)`,
        `select public.sinc_baixar('teste_itens', 0, 10)`,
        `select interno.sinc_registrar_operacao('${uuid(1)}')`,
        `select public.sinc_janela_segura()`,
      ]) {
        expect(await banco.anonimo.erro(chamada)).toMatch(/permission denied/);
      }
    });
  });

  describe('reenvio simultâneo da mesma operação', () => {
    it('o reenvio na mesma chamada (mesmo id) passa pela trava sem erro e só aplica uma vez', async () => {
      const op = operacao(1, 'teste_itens', item(1, ANA, { nome: 'v1' }), uuid(8000));
      const r = await banco.como(ANA).rpc('sinc_enviar', JSON.stringify([op, op, op]));
      expect(r.map((x: any) => [x.ok, x.duplicada ?? false])).toEqual([
        [true, false],
        [true, true],
        [true, true],
      ]);
      const [{ n }] = await banco.admin.query(`select count(*)::int as n from public.teste_itens`);
      expect(n).toBe(1);
    });

    it('operações de usuários diferentes com o mesmo id não se bloqueiam nem se confundem', async () => {
      const a = await banco
        .como(ANA)
        .rpc('sinc_enviar', JSON.stringify([operacao(1, 'teste_itens', item(1), uuid(8001))]));
      const b = await banco
        .como(BRUNO)
        .rpc(
          'sinc_enviar',
          JSON.stringify([operacao(2, 'teste_itens', item(2, BRUNO), uuid(8001))]),
        );
      expect(a[0].ok && b[0].ok).toBe(true);
      const [{ n }] = await banco.admin.query(
        `select count(*)::int as n from public.sinc_operacoes`,
      );
      expect(n).toBe(2);
    });
  });
});
