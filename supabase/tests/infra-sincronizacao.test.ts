import { ANA, BRUNO, criarBanco, operacao, uuid, type Banco } from './helpers/banco';

let banco: Banco;

beforeAll(async () => {
  banco = await criarBanco();
});

afterAll(async () => {
  await banco.fechar();
});

beforeEach(async () => {
  await banco.admin.query(
    'truncate public.teste_filhos, public.teste_itens, public.teste_segredos, public.sinc_operacoes',
  );
});

const item = (n: number, dono = ANA, extra: Record<string, unknown> = {}) => ({
  id: uuid(n),
  dono_id: dono,
  nome: `item ${n}`,
  valor: n,
  criado_em: null,
  atualizado_em: null,
  excluido_em: null,
  seq_sinc: null,
  ...extra,
});

const itemDoAdmin = async (n: number) =>
  (await banco.admin.query('select * from public.teste_itens where id = $1', [uuid(n)]))[0];

describe('preparar_tabela_sincronizada', () => {
  it('recusa tabela sem as colunas de controle e diz quais faltam', async () => {
    const erro = await banco.admin.erro(`
      create table public.ruim (id uuid primary key, criado_em timestamptz);
      select public.preparar_tabela_sincronizada('public.ruim');
    `);
    expect(erro).toMatch(/atualizado_em, excluido_em, seq_sinc/);
  });

  it('recusa tabela sem chave primária em id', async () => {
    const erro = await banco.admin.erro(`
      create table public.sem_pk (id uuid, criado_em timestamptz, atualizado_em timestamptz,
        excluido_em timestamptz, seq_sinc bigint);
      select public.preparar_tabela_sincronizada('public.sem_pk');
    `);
    expect(erro).toMatch(/chave primária apenas em id/);
  });

  it('recusa coluna oculta inexistente ou de controle', async () => {
    const base = `create table public.t_oculta (id uuid primary key, criado_em timestamptz,
      atualizado_em timestamptz, excluido_em timestamptz, seq_sinc bigint);`;
    expect(
      await banco.admin.erro(
        `${base} select public.preparar_tabela_sincronizada('public.t_oculta', array['nada']);`,
      ),
    ).toMatch(/não existe/);
    await banco.admin.query('drop table if exists public.t_oculta');
    expect(
      await banco.admin.erro(
        `${base} select public.preparar_tabela_sincronizada('public.t_oculta', array['seq_sinc']);`,
      ),
    ).toMatch(/não pode ser oculta/);
    await banco.admin.query('drop table if exists public.t_oculta');
  });

  it('liga o RLS, cria o gatilho e o índice e registra a tabela', async () => {
    const [{ relrowsecurity }] = await banco.admin.query(
      `select relrowsecurity from pg_class where relname = 'teste_itens'`,
    );
    expect(relrowsecurity).toBe(true);
    const gatilhos = await banco.admin.query(
      `select tgname from pg_trigger where tgrelid = 'public.teste_itens'::regclass and not tgisinternal`,
    );
    expect(gatilhos.map((g) => g.tgname)).toEqual(['carimbar_sincronizacao']);
    const indices = await banco.admin.query(
      `select indexname from pg_indexes where tablename = 'teste_itens' and indexname like '%seq_sinc'`,
    );
    expect(indices).toHaveLength(1);
  });

  it('é idempotente: rodar de novo não duplica gatilho nem registro', async () => {
    await banco.admin.query(`select public.preparar_tabela_sincronizada('public.teste_itens')`);
    const gatilhos = await banco.admin.query(
      `select 1 from pg_trigger where tgrelid = 'public.teste_itens'::regclass and not tgisinternal`,
    );
    expect(gatilhos).toHaveLength(1);
    const registros = await banco.admin.query(
      `select 1 from public.tabelas_sincronizadas where nome = 'teste_itens'`,
    );
    expect(registros).toHaveLength(1);
  });

  it('usuário comum não consegue chamar a preparação nem o gatilho', async () => {
    expect(
      await banco
        .como(ANA)
        .erro(`select public.preparar_tabela_sincronizada('public.teste_itens')`),
    ).toMatch(/permission denied/);
    expect(await banco.como(ANA).erro(`select public.carimbar_sincronizacao()`)).toMatch(
      /permission denied/,
    );
  });
});

describe('carimbos do servidor (gatilho)', () => {
  it('insert: preenche atualizado_em e seq_sinc; mantém criado_em informado pelo aparelho', async () => {
    const criado = '2026-01-02T03:04:05.000Z';
    const resultado = await banco
      .como(ANA)
      .rpc(
        'sinc_enviar',
        JSON.stringify([operacao(1, 'teste_itens', item(1, ANA, { criado_em: criado }))]),
      );
    expect(resultado).toEqual([{ id_operacao: uuid(1001), ok: true }]);
    const linha = await itemDoAdmin(1);
    expect(new Date(linha.criado_em).toISOString()).toBe(criado);
    expect(Number(linha.seq_sinc)).toBeGreaterThan(0);
    expect(new Date(linha.atualizado_em).getTime()).toBeGreaterThan(new Date(criado).getTime());
  });

  it('insert sem criado_em: o servidor define', async () => {
    await banco.admin.query(`insert into public.teste_itens (id, dono_id) values ($1, $2)`, [
      uuid(2),
      ANA,
    ]);
    const linha = await itemDoAdmin(2);
    expect(linha.criado_em).not.toBeNull();
    expect(Number(linha.seq_sinc)).toBeGreaterThan(0);
  });

  it('update: sobe seq_sinc, renova atualizado_em e preserva id e criado_em', async () => {
    await banco.admin.query(
      `insert into public.teste_itens (id, dono_id, criado_em) values ($1, $2, '2026-01-01')`,
      [uuid(3), ANA],
    );
    const antes = await itemDoAdmin(3);
    await banco.admin.query(
      `update public.teste_itens set nome = 'novo', criado_em = '2000-01-01' where id = $1`,
      [uuid(3)],
    );
    const depois = await itemDoAdmin(3);
    expect(Number(depois.seq_sinc)).toBeGreaterThan(Number(antes.seq_sinc));
    expect(new Date(depois.atualizado_em).getTime()).toBeGreaterThanOrEqual(
      new Date(antes.atualizado_em).getTime(),
    );
    expect(new Date(depois.criado_em).toISOString()).toBe(new Date(antes.criado_em).toISOString());
    expect(depois.id).toBe(antes.id);
  });

  it('o aparelho não consegue forjar seq_sinc nem atualizado_em', async () => {
    await banco
      .como(ANA)
      .rpc(
        'sinc_enviar',
        JSON.stringify([
          operacao(
            4,
            'teste_itens',
            item(4, ANA, { seq_sinc: 999999999, atualizado_em: '2099-01-01T00:00:00Z' }),
          ),
        ]),
      );
    const linha = await itemDoAdmin(4);
    expect(Number(linha.seq_sinc)).toBeLessThan(999999);
    expect(new Date(linha.atualizado_em).getFullYear()).toBeLessThan(2099);
  });

  it('seq_sinc é estritamente crescente entre gravações de usuários diferentes', async () => {
    await banco
      .como(ANA)
      .rpc('sinc_enviar', JSON.stringify([operacao(5, 'teste_itens', item(5, ANA))]));
    await banco
      .como(BRUNO)
      .rpc('sinc_enviar', JSON.stringify([operacao(6, 'teste_itens', item(6, BRUNO))]));
    await banco
      .como(ANA)
      .rpc('sinc_enviar', JSON.stringify([operacao(7, 'teste_itens', item(7, ANA))]));
    const seqs = (
      await banco.admin.query('select seq_sinc from public.teste_itens order by seq_sinc')
    ).map((l) => Number(l.seq_sinc));
    expect(seqs).toHaveLength(3);
    expect(new Set(seqs).size).toBe(3);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });
});

describe('sinc_enviar', () => {
  it('exige login', async () => {
    expect(await banco.anonimo.erro(`select public.sinc_enviar('[]'::jsonb)`)).toMatch(
      /permission denied/,
    );
    // mesmo com permissão, sem auth.uid() não grava
    await banco.admin.query(`grant execute on function public.sinc_enviar(jsonb) to anon`);
    expect(await banco.anonimo.erro(`select public.sinc_enviar('[]'::jsonb)`)).toMatch(
      /não autenticado/,
    );
    await banco.admin.query(`revoke execute on function public.sinc_enviar(jsonb) from anon`);
  });

  it('recusa entrada que não é lista', async () => {
    expect(await banco.como(ANA).erro(`select public.sinc_enviar('{}'::jsonb)`)).toMatch(
      /deve ser uma lista/,
    );
    expect(await banco.como(ANA).erro(`select public.sinc_enviar('null'::jsonb)`)).toMatch(
      /deve ser uma lista/,
    );
    expect(await banco.como(ANA).erro(`select public.sinc_enviar(null)`)).toMatch(
      /deve ser uma lista/,
    );
  });

  it('lista vazia devolve lista vazia', async () => {
    expect(await banco.como(ANA).rpc('sinc_enviar', '[]')).toEqual([]);
  });

  it('grava um lote inteiro e devolve um resultado por operação, na ordem', async () => {
    const ops = [1, 2, 3, 4, 5].map((n) => operacao(n, 'teste_itens', item(n)));
    const resultado = await banco.como(ANA).rpc('sinc_enviar', JSON.stringify(ops));
    expect(resultado.map((r: any) => r.ok)).toEqual([true, true, true, true, true]);
    expect(resultado.map((r: any) => r.id_operacao)).toEqual(ops.map((o) => o.id_operacao));
    const total = await banco.admin.query('select count(*)::int as n from public.teste_itens');
    expect(total[0].n).toBe(5);
  });

  it('atualiza o registro existente (o último a chegar vence)', async () => {
    const s = banco.como(ANA);
    await s.rpc(
      'sinc_enviar',
      JSON.stringify([operacao(1, 'teste_itens', item(1, ANA, { nome: 'primeiro' }))]),
    );
    await s.rpc(
      'sinc_enviar',
      JSON.stringify([operacao(2, 'teste_itens', item(1, ANA, { nome: 'segundo' }))]),
    );
    await s.rpc(
      'sinc_enviar',
      JSON.stringify([operacao(3, 'teste_itens', item(1, ANA, { nome: 'terceiro' }))]),
    );
    expect((await itemDoAdmin(1)).nome).toBe('terceiro');
    const [{ n }] = await banco.admin.query('select count(*)::int as n from public.teste_itens');
    expect(n).toBe(1);
  });

  it('o último a chegar vence mesmo que o aparelho tenha editado antes (relógio do aparelho não conta)', async () => {
    const s = banco.como(ANA);
    // Edição "mais nova" no relógio chega primeiro; a "mais antiga" chega depois e vence.
    await s.rpc(
      'sinc_enviar',
      JSON.stringify([
        operacao(
          1,
          'teste_itens',
          item(1, ANA, { nome: 'editado às 12h', atualizado_em: '2026-10-01T12:00:00Z' }),
        ),
      ]),
    );
    await s.rpc(
      'sinc_enviar',
      JSON.stringify([
        operacao(
          2,
          'teste_itens',
          item(1, ANA, { nome: 'editado às 09h', atualizado_em: '2026-10-01T09:00:00Z' }),
        ),
      ]),
    );
    expect((await itemDoAdmin(1)).nome).toBe('editado às 09h');
  });

  it('exclusão lógica: excluido_em é gravado e o registro continua na tabela', async () => {
    const s = banco.como(ANA);
    await s.rpc('sinc_enviar', JSON.stringify([operacao(1, 'teste_itens', item(1))]));
    await s.rpc(
      'sinc_enviar',
      JSON.stringify([
        operacao(2, 'teste_itens', item(1, ANA, { excluido_em: '2026-10-01T10:00:00Z' })),
      ]),
    );
    const linha = await itemDoAdmin(1);
    expect(linha.excluido_em).not.toBeNull();
    const [{ n }] = await banco.admin.query('select count(*)::int as n from public.teste_itens');
    expect(n).toBe(1);
  });

  it('idempotência: reenviar o mesmo id_operacao não reaplica (retomada após falha de rede)', async () => {
    const s = banco.como(ANA);
    const op1 = operacao(1, 'teste_itens', item(1, ANA, { nome: 'v1' }), uuid(5000));
    expect(await s.rpc('sinc_enviar', JSON.stringify([op1]))).toEqual([
      { id_operacao: uuid(5000), ok: true },
    ]);
    const seqAntes = Number((await itemDoAdmin(1)).seq_sinc);

    // Outro aparelho edita depois.
    await banco.admin.query(
      `update public.teste_itens set nome = 'v2 de outro aparelho' where id = $1`,
      [uuid(1)],
    );

    // O primeiro aparelho não recebeu a resposta e reenvia o mesmo lote.
    const reenvio = await s.rpc('sinc_enviar', JSON.stringify([op1]));
    expect(reenvio).toEqual([{ id_operacao: uuid(5000), ok: true, duplicada: true }]);
    const linha = await itemDoAdmin(1);
    expect(linha.nome).toBe('v2 de outro aparelho');
    expect(Number(linha.seq_sinc)).toBeGreaterThan(seqAntes);
  });

  it('a mesma operação duplicada dentro do mesmo lote só é aplicada uma vez', async () => {
    const op = operacao(1, 'teste_itens', item(1), uuid(5001));
    const resultado = await banco.como(ANA).rpc('sinc_enviar', JSON.stringify([op, op]));
    expect(resultado).toEqual([
      { id_operacao: uuid(5001), ok: true },
      { id_operacao: uuid(5001), ok: true, duplicada: true },
    ]);
  });

  it('uma operação que falha não derruba as outras do lote', async () => {
    const ops = [
      operacao(1, 'teste_itens', item(1)),
      operacao(2, 'teste_itens', item(2, BRUNO)), // dono diferente: RLS recusa
      operacao(3, 'teste_itens', item(3)),
    ];
    const resultado = await banco.como(ANA).rpc('sinc_enviar', JSON.stringify(ops));
    expect(resultado.map((r: any) => r.ok)).toEqual([true, false, true]);
    expect(resultado[1].codigo).toBe('42501');
    const ids = (await banco.admin.query('select id from public.teste_itens order by id')).map(
      (l) => l.id,
    );
    expect(ids).toEqual([uuid(1), uuid(3)]);
  });

  it('falha não deixa registro de operação aplicada (pode ser reenviada depois)', async () => {
    const op = operacao(1, 'teste_itens', item(1, BRUNO), uuid(5002));
    const r1 = await banco.como(ANA).rpc('sinc_enviar', JSON.stringify([op]));
    expect(r1[0].ok).toBe(false);
    const [{ n }] = await banco.admin.query(`select count(*)::int as n from public.sinc_operacoes`);
    expect(n).toBe(0);
  });

  it('RLS: ANA não consegue sobrescrever nem apagar registro do BRUNO usando o id dele', async () => {
    await banco
      .como(BRUNO)
      .rpc(
        'sinc_enviar',
        JSON.stringify([operacao(1, 'teste_itens', item(1, BRUNO, { nome: 'do bruno' }))]),
      );
    const ataques = [
      operacao(2, 'teste_itens', item(1, ANA, { nome: 'roubado' })), // troca o dono
      operacao(3, 'teste_itens', item(1, BRUNO, { nome: 'sobrescrito' })), // mantém o dono
      operacao(4, 'teste_itens', item(1, BRUNO, { excluido_em: '2026-10-01T00:00:00Z' })), // tenta apagar
    ];
    const resultado = await banco.como(ANA).rpc('sinc_enviar', JSON.stringify(ataques));
    expect(resultado.every((r: any) => r.ok === false)).toBe(true);
    const linha = await itemDoAdmin(1);
    expect(linha.nome).toBe('do bruno');
    expect(linha.dono_id).toBe(BRUNO);
    expect(linha.excluido_em).toBeNull();
  });

  it('dono não consegue passar o próprio registro para outro usuário', async () => {
    const s = banco.como(ANA);
    await s.rpc('sinc_enviar', JSON.stringify([operacao(1, 'teste_itens', item(1))]));
    const r = await s.rpc(
      'sinc_enviar',
      JSON.stringify([operacao(2, 'teste_itens', item(1, BRUNO))]),
    );
    expect(r[0].ok).toBe(false);
    expect((await itemDoAdmin(1)).dono_id).toBe(ANA);
  });

  it('chave estrangeira: filho antes do pai falha; depois que o pai chega, o reenvio funciona', async () => {
    const s = banco.como(ANA);
    const filho = { id: uuid(100), item_id: uuid(1), dono_id: ANA, nome: 'filho' };
    const antes = await s.rpc(
      'sinc_enviar',
      JSON.stringify([operacao(1, 'teste_filhos', filho, uuid(6001))]),
    );
    expect(antes[0]).toMatchObject({ ok: false, codigo: '23503' });

    const ordem = await s.rpc(
      'sinc_enviar',
      JSON.stringify([
        operacao(2, 'teste_itens', item(1)),
        operacao(3, 'teste_filhos', filho, uuid(6001)), // mesma operação do reenvio
      ]),
    );
    expect(ordem.map((r: any) => r.ok)).toEqual([true, true]);
  });

  it('pai e filho no mesmo lote, na ordem certa, funcionam', async () => {
    const resultado = await banco.como(ANA).rpc(
      'sinc_enviar',
      JSON.stringify([
        operacao(1, 'teste_itens', item(1)),
        operacao(2, 'teste_filhos', {
          id: uuid(100),
          item_id: uuid(1),
          dono_id: ANA,
          nome: 'filho',
        }),
      ]),
    );
    expect(resultado.map((r: any) => r.ok)).toEqual([true, true]);
  });

  it('tabela que não foi registrada na sincronização é recusada', async () => {
    const r = await banco
      .como(ANA)
      .rpc(
        'sinc_enviar',
        JSON.stringify([operacao(1, 'teste_nao_registrada', { id: uuid(1), dono_id: ANA })]),
      );
    expect(r[0]).toMatchObject({ ok: false, codigo: '42P01' });
    const [{ n }] = await banco.admin.query(
      'select count(*)::int as n from public.teste_nao_registrada',
    );
    expect(n).toBe(0);
  });

  it('tabelas internas e inexistentes não podem ser gravadas por aqui', async () => {
    const r = await banco
      .como(ANA)
      .rpc(
        'sinc_enviar',
        JSON.stringify([
          operacao(1, 'sinc_operacoes', { id_operacao: uuid(1), usuario_id: ANA }),
          operacao(2, 'tabelas_sincronizadas', { nome: 'x' }),
          operacao(3, 'nao_existe', { id: uuid(1) }),
          operacao(4, 'pg_class', { id: uuid(1) }),
        ]),
      );
    expect(r.map((x: any) => x.ok)).toEqual([false, false, false, false]);
  });

  it('nome de tabela malicioso (injeção de SQL) é recusado e nada é executado', async () => {
    const nomes = [
      'teste_itens; drop table public.teste_itens; --',
      'teste_itens"; drop table public.teste_itens; --',
      'public.teste_itens',
      'TESTE_ITENS',
    ];
    const r = await banco
      .como(ANA)
      .rpc('sinc_enviar', JSON.stringify(nomes.map((nome, i) => operacao(i, nome, item(i)))));
    expect(r.every((x: any) => x.ok === false)).toBe(true);
    expect(await banco.admin.query(`select to_regclass('public.teste_itens') as t`)).toEqual([
      { t: 'teste_itens' },
    ]);
  });

  it('operações malformadas viram erro individual e o resto continua', async () => {
    const r = await banco
      .como(ANA)
      .rpc(
        'sinc_enviar',
        JSON.stringify([
          { id_operacao: 'isto-nao-e-uuid', tabela: 'teste_itens', registro: item(1) },
          { tabela: 'teste_itens', registro: item(2) },
          { id_operacao: uuid(9000), registro: item(3) },
          { id_operacao: uuid(9001), tabela: 'teste_itens' },
          { id_operacao: uuid(9002), tabela: 'teste_itens', registro: 'texto' },
          { id_operacao: uuid(9003), tabela: 'teste_itens', registro: [1, 2] },
          operacao(7, 'teste_itens', item(7)),
        ]),
      );
    expect(r.map((x: any) => x.ok)).toEqual([false, false, false, false, false, false, true]);
    const [{ n }] = await banco.admin.query('select count(*)::int as n from public.teste_itens');
    expect(n).toBe(1);
  });

  it('colunas ocultas: o aparelho não as grava nem as sobrescreve', async () => {
    await banco.admin.query(
      `insert into public.teste_segredos (id, dono_id, nome, segredo) values ($1, $2, 'a', 'valor-do-servidor')`,
      [uuid(1), ANA],
    );
    const r = await banco.como(ANA).rpc(
      'sinc_enviar',
      JSON.stringify([
        operacao(1, 'teste_segredos', {
          id: uuid(1),
          dono_id: ANA,
          nome: 'b',
          segredo: 'tentativa-do-aparelho',
        }),
        operacao(2, 'teste_segredos', {
          id: uuid(2),
          dono_id: ANA,
          nome: 'novo',
          segredo: 'inserido-pelo-aparelho',
        }),
      ]),
    );
    expect(r.map((x: any) => x.ok)).toEqual([true, true]);
    const linhas = await banco.admin.query(
      'select id, nome, segredo from public.teste_segredos order by id',
    );
    expect(linhas).toEqual([
      { id: uuid(1), nome: 'b', segredo: 'valor-do-servidor' },
      { id: uuid(2), nome: 'novo', segredo: null },
    ]);
  });

  it('tabela sem política de RLS: nada é gravado', async () => {
    const r = await banco
      .como(ANA)
      .rpc('sinc_enviar', JSON.stringify([operacao(1, 'teste_sem_politica', { id: uuid(1) })]));
    expect(r[0]).toMatchObject({ ok: false, codigo: '42501' });
  });

  it('campos ausentes no registro não quebram: valores padrão do servidor não são exigidos do aparelho', async () => {
    const r = await banco
      .como(ANA)
      .rpc(
        'sinc_enviar',
        JSON.stringify([operacao(1, 'teste_itens', { id: uuid(1), dono_id: ANA })]),
      );
    expect(r[0].ok).toBe(true);
    const linha = await itemDoAdmin(1);
    expect(linha.nome).toBeNull();
    expect(Number(linha.seq_sinc)).toBeGreaterThan(0);
  });

  it('lote no limite (200 operações) é aplicado por inteiro', async () => {
    const ops = Array.from({ length: 200 }, (_, i) => operacao(i + 1, 'teste_itens', item(i + 1)));
    const r = await banco.como(ANA).rpc('sinc_enviar', JSON.stringify(ops));
    expect(r.every((x: any) => x.ok)).toBe(true);
    const [{ n }] = await banco.admin.query('select count(*)::int as n from public.teste_itens');
    expect(n).toBe(200);
  });

  it('lote acima de 200 operações é recusado por inteiro, sem gravar nada', async () => {
    const ops = Array.from({ length: 201 }, (_, i) => operacao(i + 1, 'teste_itens', item(i + 1)));
    expect(
      await banco.como(ANA).erro(`select public.sinc_enviar($1::jsonb)`, [JSON.stringify(ops)]),
    ).toMatch(/no máximo 200 operações/);
    const [{ n }] = await banco.admin.query('select count(*)::int as n from public.teste_itens');
    expect(n).toBe(0);
  });
});

describe('sinc_baixar', () => {
  const popular = async () => {
    const a = banco.como(ANA);
    const b = banco.como(BRUNO);
    await a.rpc(
      'sinc_enviar',
      JSON.stringify([1, 2, 3].map((n) => operacao(n, 'teste_itens', item(n)))),
    );
    await b.rpc('sinc_enviar', JSON.stringify([operacao(10, 'teste_itens', item(10, BRUNO))]));
    await a.rpc('sinc_enviar', JSON.stringify([operacao(4, 'teste_itens', item(4))]));
  };

  it('exige login', async () => {
    expect(await banco.anonimo.erro(`select public.sinc_baixar('teste_itens', 0, 10)`)).toMatch(
      /permission denied/,
    );
  });

  it('devolve só o que o RLS permite, em ordem de seq_sinc', async () => {
    await popular();
    const linhas = await banco.como(ANA).rpc('sinc_baixar', 'teste_itens', 0, 100);
    expect(linhas.map((l: any) => l.id)).toEqual([uuid(1), uuid(2), uuid(3), uuid(4)]);
    const seqs = linhas.map((l: any) => Number(l.seq_sinc));
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    const doBruno = await banco.como(BRUNO).rpc('sinc_baixar', 'teste_itens', 0, 100);
    expect(doBruno.map((l: any) => l.id)).toEqual([uuid(10)]);
  });

  it('só devolve o que tem seq_sinc maior que o informado', async () => {
    await popular();
    const todas = await banco.como(ANA).rpc('sinc_baixar', 'teste_itens', 0, 100);
    const corte = Number(todas[1].seq_sinc);
    const resto = await banco.como(ANA).rpc('sinc_baixar', 'teste_itens', corte, 100);
    expect(resto.map((l: any) => l.id)).toEqual([uuid(3), uuid(4)]);
    const nada = await banco
      .como(ANA)
      .rpc('sinc_baixar', 'teste_itens', Number(todas[3].seq_sinc), 100);
    expect(nada).toEqual([]);
  });

  it('paginação: o limite corta e a página seguinte continua de onde parou', async () => {
    const ops = Array.from({ length: 25 }, (_, i) => operacao(i + 1, 'teste_itens', item(i + 1)));
    await banco.como(ANA).rpc('sinc_enviar', JSON.stringify(ops));
    const s = banco.como(ANA);
    const ids: string[] = [];
    let cursor = 0;
    for (let guarda = 0; guarda < 10; guarda++) {
      const pagina = await s.rpc('sinc_baixar', 'teste_itens', cursor, 10);
      if (pagina.length === 0) break;
      expect(pagina.length).toBeLessThanOrEqual(10);
      ids.push(...pagina.map((l: any) => l.id));
      cursor = Number(pagina[pagina.length - 1].seq_sinc);
    }
    expect(ids).toEqual(Array.from({ length: 25 }, (_, i) => uuid(i + 1)));
  });

  it('o limite é ajustado entre 1 e 1000; nulo vira 500', async () => {
    const ops = Array.from({ length: 30 }, (_, i) => operacao(i + 1, 'teste_itens', item(i + 1)));
    await banco.como(ANA).rpc('sinc_enviar', JSON.stringify(ops));
    const s = banco.como(ANA);
    expect(await s.rpc('sinc_baixar', 'teste_itens', 0, 0)).toHaveLength(1);
    expect(await s.rpc('sinc_baixar', 'teste_itens', 0, -5)).toHaveLength(1);
    expect(await s.rpc('sinc_baixar', 'teste_itens', 0, 5000)).toHaveLength(30);
    expect(await s.rpc('sinc_baixar', 'teste_itens', null, null)).toHaveLength(30);
  });

  it('registros excluídos logicamente continuam sendo entregues (para a exclusão chegar a outros aparelhos)', async () => {
    const s = banco.como(ANA);
    await s.rpc('sinc_enviar', JSON.stringify([operacao(1, 'teste_itens', item(1))]));
    const [antes] = await s.rpc('sinc_baixar', 'teste_itens', 0, 10);
    await s.rpc(
      'sinc_enviar',
      JSON.stringify([
        operacao(2, 'teste_itens', item(1, ANA, { excluido_em: '2026-10-01T10:00:00Z' })),
      ]),
    );
    const depois = await s.rpc('sinc_baixar', 'teste_itens', Number(antes.seq_sinc), 10);
    expect(depois).toHaveLength(1);
    expect(depois[0].id).toBe(uuid(1));
    expect(depois[0].excluido_em).not.toBeNull();
  });

  it('uma edição aparece de novo com seq_sinc maior', async () => {
    const s = banco.como(ANA);
    await s.rpc(
      'sinc_enviar',
      JSON.stringify([operacao(1, 'teste_itens', item(1, ANA, { nome: 'a' }))]),
    );
    const [v1] = await s.rpc('sinc_baixar', 'teste_itens', 0, 10);
    await s.rpc(
      'sinc_enviar',
      JSON.stringify([operacao(2, 'teste_itens', item(1, ANA, { nome: 'b' }))]),
    );
    const novas = await s.rpc('sinc_baixar', 'teste_itens', Number(v1.seq_sinc), 10);
    expect(novas).toHaveLength(1);
    expect(novas[0].nome).toBe('b');
  });

  it('colunas ocultas nunca descem para o aparelho', async () => {
    await banco.admin.query(
      `insert into public.teste_segredos (id, dono_id, nome, segredo) values ($1, $2, 'a', 'so-no-servidor')`,
      [uuid(1), ANA],
    );
    const [linha] = await banco.como(ANA).rpc('sinc_baixar', 'teste_segredos', 0, 10);
    expect(linha.nome).toBe('a');
    expect(Object.keys(linha)).not.toContain('segredo');
  });

  it('tabela não registrada ou com nome malicioso é recusada', async () => {
    const s = banco.como(ANA);
    for (const nome of [
      'teste_nao_registrada',
      'nao_existe',
      'sinc_operacoes',
      `teste_itens; drop table public.teste_itens`,
    ]) {
      expect(await s.erro(`select public.sinc_baixar($1, 0, 10)`, [nome])).toMatch(
        /não sincronizada/,
      );
    }
  });

  it('tabela sem política de RLS devolve lista vazia', async () => {
    await banco.admin.query(`insert into public.teste_sem_politica (id) values ($1)`, [uuid(1)]);
    expect(await banco.como(ANA).rpc('sinc_baixar', 'teste_sem_politica', 0, 10)).toEqual([]);
  });
});

describe('tabelas internas', () => {
  it('usuário comum não altera o registro de tabelas sincronizadas', async () => {
    const s = banco.como(ANA);
    expect(await s.erro(`insert into public.tabelas_sincronizadas (nome) values ('x')`)).toMatch(
      /permission denied/,
    );
    expect(await s.erro(`update public.tabelas_sincronizadas set colunas_ocultas = '{}'`)).toMatch(
      /permission denied/,
    );
    expect(await s.erro(`delete from public.tabelas_sincronizadas`)).toMatch(/permission denied/);
    expect(await s.query(`select nome from public.tabelas_sincronizadas`)).not.toHaveLength(0);
    expect(await banco.anonimo.erro(`select * from public.tabelas_sincronizadas`)).toMatch(
      /permission denied/,
    );
  });

  it('cada usuário só vê as próprias operações aplicadas', async () => {
    await banco.como(ANA).rpc('sinc_enviar', JSON.stringify([operacao(1, 'teste_itens', item(1))]));
    await banco
      .como(BRUNO)
      .rpc('sinc_enviar', JSON.stringify([operacao(2, 'teste_itens', item(2, BRUNO))]));
    const deAna = await banco.como(ANA).query(`select id_operacao from public.sinc_operacoes`);
    expect(deAna).toEqual([{ id_operacao: uuid(1001) }]);
    expect(await banco.como(ANA).erro(`delete from public.sinc_operacoes`)).toMatch(
      /permission denied/,
    );
    expect(
      await banco.como(ANA).erro(`update public.sinc_operacoes set usuario_id = '${BRUNO}'`),
    ).toMatch(/permission denied/);
    expect(await banco.anonimo.erro(`select * from public.sinc_operacoes`)).toMatch(
      /permission denied/,
    );
  });

  it('usuário não grava direto em sinc_operacoes (nem em nome de outro): só pela função', async () => {
    const erro = await banco
      .como(ANA)
      .erro(`insert into public.sinc_operacoes (id_operacao, usuario_id) values ($1, $2)`, [
        uuid(1),
        BRUNO,
      ]);
    expect(erro).toMatch(/permission denied/);
    // A função sempre registra em nome de quem chama.
    expect(await banco.como(ANA).rpc('sinc_registrar_operacao', uuid(2))).toBe(true);
    expect(await banco.como(ANA).rpc('sinc_registrar_operacao', uuid(2))).toBe(false);
    const donos = await banco.admin.query(`select usuario_id from public.sinc_operacoes`);
    expect(donos).toEqual([{ usuario_id: ANA }]);
    expect(
      await banco.anonimo.erro(`select public.sinc_registrar_operacao($1)`, [uuid(3)]),
    ).toMatch(/permission denied/);
  });

  it('o mesmo id_operacao de usuários diferentes não se atrapalha (chave por usuário)', async () => {
    await banco
      .como(ANA)
      .rpc('sinc_enviar', JSON.stringify([operacao(1, 'teste_itens', item(1), uuid(7000))]));
    const r = await banco
      .como(BRUNO)
      .rpc('sinc_enviar', JSON.stringify([operacao(2, 'teste_itens', item(2, BRUNO), uuid(7000))]));
    expect(r).toEqual([{ id_operacao: uuid(7000), ok: true }]);
  });

  it('sinc_limpar_operacoes remove só as antigas e ninguém além do servidor chama', async () => {
    await banco
      .como(ANA)
      .rpc('sinc_enviar', JSON.stringify([operacao(1, 'teste_itens', item(1), uuid(7001))]));
    await banco.admin.query(
      `insert into public.sinc_operacoes (usuario_id, id_operacao, aplicada_em) values ($1, $2, now() - interval '40 days')`,
      [ANA, uuid(7002)],
    );
    expect(await banco.como(ANA).erro(`select public.sinc_limpar_operacoes(30)`)).toMatch(
      /permission denied/,
    );
    const [{ r }] = await banco.admin.query(`select public.sinc_limpar_operacoes(30) as r`);
    expect(Number(r)).toBe(1);
    const restantes = await banco.admin.query(`select id_operacao from public.sinc_operacoes`);
    expect(restantes).toEqual([{ id_operacao: uuid(7001) }]);
  });
});

describe('RLS direto nas tabelas sincronizadas', () => {
  it('cada usuário só enxerga e altera as próprias linhas', async () => {
    await banco.admin.query(
      `insert into public.teste_itens (id, dono_id) values ($1, $2), ($3, $4)`,
      [uuid(1), ANA, uuid(2), BRUNO],
    );
    const s = banco.como(ANA);
    expect((await s.query(`select id from public.teste_itens`)).map((l) => l.id)).toEqual([
      uuid(1),
    ]);
    expect(
      await s.query(`update public.teste_itens set nome = 'x' where id = $1 returning id`, [
        uuid(2),
      ]),
    ).toEqual([]);
    // Exclusão física é proibida para o usuário (só excluido_em), até do próprio registro.
    expect(await s.erro(`delete from public.teste_itens where id = $1`, [uuid(1)])).toMatch(
      /permission denied/,
    );
    expect(await s.erro(`delete from public.teste_itens where id = $1`, [uuid(2)])).toMatch(
      /permission denied/,
    );
    expect(
      await s.erro(`insert into public.teste_itens (id, dono_id) values ($1, $2)`, [
        uuid(3),
        BRUNO,
      ]),
    ).toMatch(/row-level security/);
    expect(await banco.anonimo.erro(`select id from public.teste_itens`)).toMatch(
      /permission denied/,
    );
  });
});

describe('envio campo a campo (registro parcial)', () => {
  it('só as colunas enviadas mudam; as outras ficam como estavam', async () => {
    const s = banco.como(ANA);
    await s.rpc(
      'sinc_enviar',
      JSON.stringify([operacao(1, 'teste_itens', item(1, ANA, { nome: 'original', valor: 7 }))]),
    );
    await s.rpc(
      'sinc_enviar',
      JSON.stringify([operacao(2, 'teste_itens', { id: uuid(1), valor: 99 })]),
    );
    const linha = await itemDoAdmin(1);
    expect(linha.nome).toBe('original');
    expect(linha.valor).toBe(99);
    expect(linha.dono_id).toBe(ANA);
  });

  it('exclusão pode mandar só {id, excluido_em}', async () => {
    const s = banco.como(ANA);
    await s.rpc('sinc_enviar', JSON.stringify([operacao(1, 'teste_itens', item(1))]));
    const r = await s.rpc(
      'sinc_enviar',
      JSON.stringify([
        operacao(2, 'teste_itens', { id: uuid(1), excluido_em: '2026-10-01T10:00:00Z' }),
      ]),
    );
    expect(r[0].ok).toBe(true);
    const linha = await itemDoAdmin(1);
    expect(linha.excluido_em).not.toBeNull();
    expect(linha.nome).toBe('item 1');
  });

  it('dois aparelhos editando colunas diferentes do mesmo registro: as duas edições sobrevivem', async () => {
    const s = banco.como(ANA);
    await s.rpc(
      'sinc_enviar',
      JSON.stringify([operacao(1, 'teste_itens', item(1, ANA, { nome: 'a', valor: 1 }))]),
    );
    await s.rpc(
      'sinc_enviar',
      JSON.stringify([
        operacao(2, 'teste_itens', { id: uuid(1), nome: 'renomeado no aparelho A' }),
      ]),
    );
    await s.rpc(
      'sinc_enviar',
      JSON.stringify([operacao(3, 'teste_itens', { id: uuid(1), valor: 42 })]),
    );
    const linha = await itemDoAdmin(1);
    expect(linha.nome).toBe('renomeado no aparelho A');
    expect(linha.valor).toBe(42);
  });

  it('na mesma coluna, o último a chegar vence', async () => {
    const s = banco.como(ANA);
    await s.rpc('sinc_enviar', JSON.stringify([operacao(1, 'teste_itens', item(1))]));
    await s.rpc(
      'sinc_enviar',
      JSON.stringify([operacao(2, 'teste_itens', { id: uuid(1), nome: 'A' })]),
    );
    await s.rpc(
      'sinc_enviar',
      JSON.stringify([operacao(3, 'teste_itens', { id: uuid(1), nome: 'B' })]),
    );
    expect((await itemDoAdmin(1)).nome).toBe('B');
  });

  it('coluna que o servidor não conhece é ignorada (app mais novo ou mais antigo que o banco)', async () => {
    const r = await banco.como(ANA).rpc(
      'sinc_enviar',
      JSON.stringify([
        operacao(1, 'teste_itens', {
          id: uuid(1),
          dono_id: ANA,
          nome: 'x',
          coluna_do_futuro: 123,
        }),
      ]),
    );
    expect(r[0].ok).toBe(true);
    expect((await itemDoAdmin(1)).nome).toBe('x');
  });

  it('registro sem id é recusado', async () => {
    const r = await banco
      .como(ANA)
      .rpc(
        'sinc_enviar',
        JSON.stringify([operacao(1, 'teste_itens', { dono_id: ANA, nome: 'sem id' })]),
      );
    expect(r[0]).toMatchObject({ ok: false, codigo: '22023' });
  });

  it('criar com colunas obrigatórias faltando falha, e nada é criado', async () => {
    const r = await banco
      .como(ANA)
      .rpc(
        'sinc_enviar',
        JSON.stringify([operacao(1, 'teste_itens', { id: uuid(1), nome: 'sem dono' })]),
      );
    expect(r[0]).toMatchObject({ ok: false });
    const [{ n }] = await banco.admin.query('select count(*)::int as n from public.teste_itens');
    expect(n).toBe(0);
  });

  it('atualização parcial no registro de outro usuário não muda nada e falha', async () => {
    await banco
      .como(BRUNO)
      .rpc(
        'sinc_enviar',
        JSON.stringify([operacao(1, 'teste_itens', item(1, BRUNO, { nome: 'do bruno' }))]),
      );
    const r = await banco
      .como(ANA)
      .rpc(
        'sinc_enviar',
        JSON.stringify([
          operacao(2, 'teste_itens', { id: uuid(1), nome: 'invadido' }),
          operacao(3, 'teste_itens', { id: uuid(1), excluido_em: '2026-10-01T10:00:00Z' }),
        ]),
      );
    expect(r.map((x: any) => x.ok)).toEqual([false, false]);
    const linha = await itemDoAdmin(1);
    expect(linha.nome).toBe('do bruno');
    expect(linha.excluido_em).toBeNull();
  });
});
