import { ANA, BRUNO, criarBanco, operacao, uuid, type Banco } from './helpers/banco';
import { criarAparelhoPg } from './helpers/aparelho';

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

const item = (n: number, dono = ANA) => ({
  id: uuid(n),
  dono_id: dono,
  nome: `item ${n}`,
  valor: n,
});

const baixarTudo = (usuario: string, cursores: Record<string, number>, limite = 500) =>
  banco.como(usuario).rpc('sinc_baixar_tudo', JSON.stringify(cursores), limite);

describe('sinc_baixar_tudo', () => {
  it('exige login e é negada ao visitante', async () => {
    expect(await banco.anonimo.erro(`select public.sinc_baixar_tudo('{}'::jsonb, 10)`)).toMatch(
      /permission denied/,
    );
  });

  it('exige um objeto {tabela: cursor}', async () => {
    const s = banco.como(ANA);
    for (const entrada of ['[]', '"x"', 'null', '1']) {
      expect(await s.erro(`select public.sinc_baixar_tudo($1::jsonb, 10)`, [entrada])).toMatch(
        /deve ser um objeto/,
      );
    }
    expect(await s.erro(`select public.sinc_baixar_tudo(null, 10)`)).toMatch(/deve ser um objeto/);
  });

  it('limita a 100 tabelas por chamada', async () => {
    const cursores = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`t${i}`, 0]));
    expect(
      await banco
        .como(ANA)
        .erro(`select public.sinc_baixar_tudo($1::jsonb, 10)`, [JSON.stringify(cursores)]),
    ).toMatch(/no máximo 100 tabelas/);
  });

  it('sem novidade devolve uma resposta mínima (poucos bytes)', async () => {
    const resposta = await baixarTudo(ANA, { teste_itens: 0, teste_filhos: 0, teste_segredos: 0 });
    expect(resposta).toEqual({ dados: {}, mais: [] });
    expect(JSON.stringify(resposta).length).toBeLessThan(40);
  });

  it('traz várias tabelas numa chamada, só as que têm novidade', async () => {
    const s = banco.como(ANA);
    await s.rpc(
      'sinc_enviar',
      JSON.stringify([
        operacao(1, 'teste_itens', item(1)),
        operacao(2, 'teste_filhos', { id: uuid(100), item_id: uuid(1), dono_id: ANA, nome: 'f' }),
      ]),
    );
    const resposta = await baixarTudo(ANA, { teste_itens: 0, teste_filhos: 0, teste_segredos: 0 });
    expect(Object.keys(resposta.dados).sort()).toEqual(['teste_filhos', 'teste_itens']);
    expect(resposta.dados.teste_itens).toHaveLength(1);
    expect(resposta.dados.teste_filhos).toHaveLength(1);
    expect(resposta.mais).toEqual([]);
  });

  it('respeita o cursor de cada tabela', async () => {
    const s = banco.como(ANA);
    for (const n of [1, 2, 3])
      await s.rpc('sinc_enviar', JSON.stringify([operacao(n, 'teste_itens', item(n))]));
    const todas = (await baixarTudo(ANA, { teste_itens: 0 })).dados.teste_itens;
    const corte = Number(todas[1].seq_sinc);
    const resto = (await baixarTudo(ANA, { teste_itens: corte })).dados.teste_itens;
    expect(resto.map((l: any) => l.id)).toEqual([uuid(3)]);
    expect((await baixarTudo(ANA, { teste_itens: Number(todas[2].seq_sinc) })).dados).toEqual({});
  });

  it('marca em "mais" a tabela que atingiu o limite, e só ela', async () => {
    const s = banco.como(ANA);
    const ops = Array.from({ length: 5 }, (_, i) => operacao(i + 1, 'teste_itens', item(i + 1)));
    await s.rpc('sinc_enviar', JSON.stringify(ops));
    await s.rpc(
      'sinc_enviar',
      JSON.stringify([
        operacao(50, 'teste_filhos', { id: uuid(500), item_id: uuid(1), dono_id: ANA }),
      ]),
    );
    const resposta = await baixarTudo(ANA, { teste_itens: 0, teste_filhos: 0 }, 3);
    expect(resposta.dados.teste_itens).toHaveLength(3);
    expect(resposta.dados.teste_filhos).toHaveLength(1);
    expect(resposta.mais).toEqual(['teste_itens']);
  });

  it('só entrega o que o RLS permite a quem pergunta', async () => {
    await banco.como(ANA).rpc('sinc_enviar', JSON.stringify([operacao(1, 'teste_itens', item(1))]));
    await banco
      .como(BRUNO)
      .rpc('sinc_enviar', JSON.stringify([operacao(2, 'teste_itens', item(2, BRUNO))]));
    expect(
      (await baixarTudo(ANA, { teste_itens: 0 })).dados.teste_itens.map((l: any) => l.id),
    ).toEqual([uuid(1)]);
    expect(
      (await baixarTudo(BRUNO, { teste_itens: 0 })).dados.teste_itens.map((l: any) => l.id),
    ).toEqual([uuid(2)]);
  });

  it('colunas ocultas não descem', async () => {
    await banco.admin.query(
      `insert into public.teste_segredos (id, dono_id, nome, segredo) values ($1, $2, 'a', 'so-no-servidor')`,
      [uuid(1), ANA],
    );
    const [linha] = (await baixarTudo(ANA, { teste_segredos: 0 })).dados.teste_segredos;
    expect(Object.keys(linha)).not.toContain('segredo');
  });

  it('inclui lápides (exclusão lógica) para a exclusão chegar a outros aparelhos', async () => {
    const s = banco.como(ANA);
    await s.rpc('sinc_enviar', JSON.stringify([operacao(1, 'teste_itens', item(1))]));
    await s.rpc(
      'sinc_enviar',
      JSON.stringify([
        operacao(2, 'teste_itens', { id: uuid(1), excluido_em: '2026-10-01T10:00:00Z' }),
      ]),
    );
    const [linha] = (await baixarTudo(ANA, { teste_itens: 0 })).dados.teste_itens;
    expect(linha.excluido_em).not.toBeNull();
  });

  it('tabela não registrada, inexistente ou com nome malicioso derruba a chamada com erro claro', async () => {
    for (const nome of [
      'teste_nao_registrada',
      'nao_existe',
      'sinc_operacoes',
      'teste_itens; drop table public.teste_itens',
    ]) {
      expect(
        await banco
          .como(ANA)
          .erro(`select public.sinc_baixar_tudo($1::jsonb, 10)`, [JSON.stringify({ [nome]: 0 })]),
      ).toMatch(/não sincronizada/);
    }
  });

  it('cursor que não é número é tratado como zero; limite nulo vira 500', async () => {
    await banco.como(ANA).rpc('sinc_enviar', JSON.stringify([operacao(1, 'teste_itens', item(1))]));
    const r1 = await banco
      .como(ANA)
      .rpc('sinc_baixar_tudo', JSON.stringify({ teste_itens: 'abc' }), 10);
    expect(r1.dados.teste_itens).toHaveLength(1);
    const r2 = await banco
      .como(ANA)
      .rpc('sinc_baixar_tudo', JSON.stringify({ teste_itens: null }), null);
    expect(r2.dados.teste_itens).toHaveLength(1);
  });

  it('o teto de ~2000 linhas por chamada deixa as outras tabelas em "mais"', async () => {
    const lotes = 10;
    for (let l = 0; l < lotes; l++) {
      const ops = Array.from({ length: 200 }, (_, i) =>
        operacao(l * 200 + i + 1, 'teste_itens', item(l * 200 + i + 1)),
      );
      await banco.como(ANA).rpc('sinc_enviar', JSON.stringify(ops));
    }
    await banco
      .como(ANA)
      .rpc(
        'sinc_enviar',
        JSON.stringify([
          operacao(9000, 'teste_filhos', { id: uuid(9001), item_id: uuid(1), dono_id: ANA }),
        ]),
      );
    const resposta = await banco
      .como(ANA)
      .rpc('sinc_baixar_tudo', JSON.stringify({ teste_itens: 0, teste_filhos: 0 }), 1000);
    expect(resposta.dados.teste_itens).toHaveLength(1000);
    expect(resposta.mais).toContain('teste_itens');
  }, 120000);
});

describe('motor + banco real: uma requisição por sincronização', () => {
  it('sem novidade, sincronizar faz uma única chamada de download para as 3 tabelas', async () => {
    const a = await criarAparelhoPg(banco.como(ANA));
    await a.motor.sincronizar();
    expect(a.rede.chamadasDownload).toBe(1);
    await a.motor.sincronizar();
    expect(a.rede.chamadasDownload).toBe(2);
  });

  it('com dados em duas tabelas, ainda é uma chamada', async () => {
    const a = await criarAparelhoPg(banco.como(ANA));
    const pai = await a.motor.criar('teste_itens', { dono_id: ANA, nome: 'p' });
    await a.motor.criar('teste_filhos', { item_id: pai, dono_id: ANA, nome: 'f' });
    await a.motor.sincronizar();
    const b = await criarAparelhoPg(banco.como(ANA));
    await b.motor.sincronizar();
    expect(b.rede.chamadasDownload).toBe(1);
    expect(await b.todos('teste_itens')).toHaveLength(1);
    expect(await b.todos('teste_filhos')).toHaveLength(1);
  });
});
