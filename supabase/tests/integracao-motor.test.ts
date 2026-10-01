import { ANA, BRUNO, criarBanco, type Banco } from './helpers/banco';
import { criarAparelhoPg } from './helpers/aparelho';

// O motor do aparelho (packages/core) conversando com as funções SQL reais (migration), no PGlite.

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

const noServidor = (id: string) =>
  banco.admin.query('select * from public.teste_itens where id = $1', [id]).then((l) => l[0]);

describe('um aparelho', () => {
  it('cria, sincroniza e recebe de volta os carimbos do servidor', async () => {
    const a = await criarAparelhoPg(banco.como(ANA));
    const id = await a.motor.criar('teste_itens', { dono_id: ANA, nome: 'supino', valor: 10 });
    const r = await a.motor.sincronizar();
    expect(r).toMatchObject({ enviadas: 1, falhasDefinitivas: 0 });

    const doServidor = await noServidor(id);
    expect(doServidor).toMatchObject({ nome: 'supino', valor: 10, dono_id: ANA });
    const local = await a.ler('teste_itens', id);
    expect(local?.seq_sinc).toBe(Number(doServidor.seq_sinc));
    expect(new Date(String(local?.atualizado_em)).getTime()).toBe(
      new Date(doServidor.atualizado_em).getTime(),
    );
  });

  it('mantém o criado_em do aparelho (criado offline antes de chegar ao servidor)', async () => {
    const a = await criarAparelhoPg(banco.como(ANA));
    const id = await a.motor.criar('teste_itens', {
      dono_id: ANA,
      nome: 'x',
      criado_em: '2026-01-02T03:04:05.000Z',
    });
    await a.motor.sincronizar();
    expect(new Date((await noServidor(id)).criado_em).toISOString()).toBe(
      '2026-01-02T03:04:05.000Z',
    );
  });

  it('atualização e exclusão chegam só com as colunas que mudaram', async () => {
    const a = await criarAparelhoPg(banco.como(ANA));
    const id = await a.motor.criar('teste_itens', { dono_id: ANA, nome: 'original', valor: 1 });
    await a.motor.sincronizar();
    await a.motor.atualizar('teste_itens', id, { valor: 2 });
    await a.motor.sincronizar();
    expect(await noServidor(id)).toMatchObject({ nome: 'original', valor: 2 });
    await a.motor.excluir('teste_itens', id);
    await a.motor.sincronizar();
    const linha = await noServidor(id);
    expect(linha.excluido_em).not.toBeNull();
    expect(linha.nome).toBe('original');
  });

  it('pai e filho criados juntos chegam na ordem certa', async () => {
    const a = await criarAparelhoPg(banco.como(ANA));
    const pai = await a.motor.criar('teste_itens', { dono_id: ANA, nome: 'pai' });
    const filho = await a.motor.criar('teste_filhos', {
      item_id: pai,
      dono_id: ANA,
      nome: 'filho',
    });
    expect(await a.motor.sincronizar()).toMatchObject({
      enviadas: 2,
      adiadas: 0,
      falhasDefinitivas: 0,
    });
    const [{ n }] = await banco.admin.query(
      'select count(*)::int as n from public.teste_filhos where id = $1',
      [filho],
    );
    expect(n).toBe(1);
  });

  it('muitas linhas: paginação do download contra o servidor real', async () => {
    const a = await criarAparelhoPg(banco.como(ANA), { tamanhoLote: 50 });
    for (let i = 0; i < 130; i++)
      await a.motor.criar('teste_itens', { dono_id: ANA, nome: `n${i}`, valor: i });
    await a.motor.sincronizar();
    const b = await criarAparelhoPg(banco.como(ANA), { limitePagina: 40 });
    const r = await b.motor.sincronizar();
    expect(r.baixadas).toBe(130);
    expect(await b.todos('teste_itens')).toHaveLength(130);
  });
});

describe('dois aparelhos da mesma conta', () => {
  it('o que um cria, o outro recebe, incluindo edições e exclusões', async () => {
    const a = await criarAparelhoPg(banco.como(ANA));
    const b = await criarAparelhoPg(banco.como(ANA));
    const id = await a.motor.criar('teste_itens', { dono_id: ANA, nome: 'v1', valor: 1 });
    await a.motor.sincronizar();
    await b.motor.sincronizar();
    expect(await b.ler('teste_itens', id)).toMatchObject({ nome: 'v1' });

    await b.motor.atualizar('teste_itens', id, { nome: 'v2 do B' });
    await b.motor.sincronizar();
    await a.motor.sincronizar();
    expect(await a.ler('teste_itens', id)).toMatchObject({ nome: 'v2 do B' });

    await a.motor.excluir('teste_itens', id);
    await a.motor.sincronizar();
    await b.motor.sincronizar();
    expect((await b.ler('teste_itens', id))?.excluido_em).not.toBeNull();
  });

  it('colunas diferentes editadas offline: as duas edições sobrevivem no servidor real', async () => {
    const a = await criarAparelhoPg(banco.como(ANA));
    const b = await criarAparelhoPg(banco.como(ANA));
    const id = await a.motor.criar('teste_itens', { dono_id: ANA, nome: 'x', valor: 1 });
    await a.motor.sincronizar();
    await b.motor.sincronizar();

    await a.motor.atualizar('teste_itens', id, { nome: 'nome do A' });
    await b.motor.atualizar('teste_itens', id, { valor: 77 });
    await a.motor.sincronizar();
    await b.motor.sincronizar();
    await a.motor.sincronizar();

    expect(await noServidor(id)).toMatchObject({ nome: 'nome do A', valor: 77 });
    for (const ap of [a, b])
      expect(await ap.ler('teste_itens', id)).toMatchObject({ nome: 'nome do A', valor: 77 });
  });

  it('mesma coluna: o último a chegar ao servidor vence, e os dois aparelhos convergem', async () => {
    const a = await criarAparelhoPg(banco.como(ANA));
    const b = await criarAparelhoPg(banco.como(ANA));
    const id = await a.motor.criar('teste_itens', { dono_id: ANA, nome: 'x' });
    await a.motor.sincronizar();
    await b.motor.sincronizar();

    await a.motor.atualizar('teste_itens', id, { nome: 'A' });
    await b.motor.atualizar('teste_itens', id, { nome: 'B' });
    await b.motor.sincronizar();
    await a.motor.sincronizar();
    await b.motor.sincronizar();
    expect((await noServidor(id)).nome).toBe('A');
    expect((await b.ler('teste_itens', id))?.nome).toBe('A');
  });
});

describe('falhas de rede com o servidor real', () => {
  it('sem conexão: nada se perde e o envio acontece depois', async () => {
    const a = await criarAparelhoPg(banco.como(ANA));
    const id = await a.motor.criar('teste_itens', { dono_id: ANA, nome: 'x' });
    a.rede.falhaEnvio = 'antes';
    expect((await a.motor.sincronizar()).erro).toBe('rede');
    expect(await noServidor(id)).toBeUndefined();
    expect((await a.motor.sincronizar()).erro).toBeUndefined();
    expect(await noServidor(id)).toBeDefined();
  });

  it('resposta perdida: o reenvio é reconhecido (sinc_operacoes) e não desfaz a edição de outro aparelho', async () => {
    const a = await criarAparelhoPg(banco.como(ANA));
    const b = await criarAparelhoPg(banco.como(ANA));
    const id = await a.motor.criar('teste_itens', { dono_id: ANA, nome: 'v1' });

    a.rede.falhaEnvio = 'depois';
    expect((await a.motor.sincronizar()).erro).toBe('rede');
    expect((await noServidor(id)).nome).toBe('v1'); // o servidor aplicou

    await b.motor.sincronizar();
    await b.motor.atualizar('teste_itens', id, { nome: 'v2 do B' });
    await b.motor.sincronizar();

    const r = await a.motor.sincronizar();
    expect(r).toMatchObject({ enviadas: 0, duplicadas: 1 });
    expect((await noServidor(id)).nome).toBe('v2 do B');
    expect((await a.ler('teste_itens', id))?.nome).toBe('v2 do B');
    expect((await a.motor.estado()).pendentes).toBe(0);
  });

  it('sessão expirada: para sem perder nada', async () => {
    const a = await criarAparelhoPg(banco.como(ANA));
    await a.motor.criar('teste_itens', { dono_id: ANA, nome: 'x' });
    a.rede.falhaEnvio = 'sessao';
    expect((await a.motor.sincronizar()).erro).toBe('autenticacao');
    expect((await a.motor.estado()).pendentes).toBe(1);
  });
});

describe('segurança (RLS) vista pelo aparelho', () => {
  it('aparelho do Bruno nunca recebe dados da Ana', async () => {
    const ana = await criarAparelhoPg(banco.como(ANA));
    const bruno = await criarAparelhoPg(banco.como(BRUNO));
    for (let i = 0; i < 5; i++)
      await ana.motor.criar('teste_itens', { dono_id: ANA, nome: `da ana ${i}` });
    await bruno.motor.criar('teste_itens', { dono_id: BRUNO, nome: 'do bruno' });
    await ana.motor.sincronizar();
    await bruno.motor.sincronizar();
    await ana.motor.sincronizar();
    expect((await bruno.todos('teste_itens')).map((l) => l.nome)).toEqual(['do bruno']);
    expect(await ana.todos('teste_itens')).toHaveLength(5);
  });

  it('tentar gravar com dono de outra pessoa vira falha definitiva e não trava o resto', async () => {
    const a = await criarAparelhoPg(banco.como(ANA));
    const ruim = await a.motor.criar('teste_itens', { dono_id: BRUNO, nome: 'em nome do bruno' });
    const bom = await a.motor.criar('teste_itens', { dono_id: ANA, nome: 'meu' });
    const r = await a.motor.sincronizar();
    expect(r).toMatchObject({ enviadas: 1, falhasDefinitivas: 1 });
    expect(await noServidor(bom)).toBeDefined();
    expect(await noServidor(ruim)).toBeUndefined();
    const estado = await a.motor.estado();
    expect(estado.falhas[0]).toMatchObject({ registroId: ruim, codigo: '42501' });
    expect(estado.pendentes).toBe(0);
  });

  it('não consegue sobrescrever nem excluir o registro de outro usando o id dele', async () => {
    const bruno = await criarAparelhoPg(banco.como(BRUNO));
    const idDoBruno = await bruno.motor.criar('teste_itens', { dono_id: BRUNO, nome: 'do bruno' });
    await bruno.motor.sincronizar();

    const ana = await criarAparelhoPg(banco.como(ANA));
    await ana.local.gravar(
      'teste_itens',
      { id: idDoBruno, nome: 'invadido' },
      '2026-10-01T10:00:00Z',
    );
    await ana.local.gravar(
      'teste_itens',
      { id: idDoBruno, excluido_em: '2026-10-01T10:00:00Z' },
      '2026-10-01T10:00:00Z',
    );
    const r = await ana.motor.sincronizar();
    expect(r.falhasDefinitivas).toBe(1);
    const linha = await noServidor(idDoBruno);
    expect(linha).toMatchObject({ nome: 'do bruno', dono_id: BRUNO });
    expect(linha.excluido_em).toBeNull();
  });

  it('coluna oculta do servidor nunca chega ao aparelho nem é sobrescrita por ele', async () => {
    await banco.admin.query(
      `insert into public.teste_segredos (id, dono_id, nome, segredo) values ('018f0000-0000-7000-8000-0000000000aa', $1, 'a', 'so-no-servidor')`,
      [ANA],
    );
    const a = await criarAparelhoPg(banco.como(ANA));
    await a.motor.sincronizar();
    const local = await a.ler('teste_segredos', '018f0000-0000-7000-8000-0000000000aa');
    expect(local).toMatchObject({ nome: 'a' });
    expect(Object.keys(local!)).not.toContain('segredo');

    await a.motor.atualizar('teste_segredos', '018f0000-0000-7000-8000-0000000000aa', {
      nome: 'b',
    });
    await a.motor.sincronizar();
    const [linha] = await banco.admin.query(`select nome, segredo from public.teste_segredos`);
    expect(linha).toEqual({ nome: 'b', segredo: 'so-no-servidor' });
  });

  it('registro novo vindo do servidor para um aparelho que já tinha o cursor adiantado é recebido (margem)', async () => {
    const a = await criarAparelhoPg(banco.como(ANA));
    const b = await criarAparelhoPg(banco.como(ANA));
    for (let i = 0; i < 3; i++) await a.motor.criar('teste_itens', { dono_id: ANA, nome: `n${i}` });
    await a.motor.sincronizar();
    await b.motor.sincronizar();
    const id = await a.motor.criar('teste_itens', { dono_id: ANA, nome: 'novo' });
    await a.motor.sincronizar();
    await b.motor.sincronizar();
    expect((await b.ler('teste_itens', id))?.nome).toBe('novo');
  });
});

// --- Convergência aleatória contra o servidor real ---------------------------------------------

function mulberry32(semente: number) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('convergência aleatória contra o banco real', () => {
  it.each([1, 2, 3, 4, 5, 6])(
    'semente %i: 3 aparelhos da mesma conta, falhas de rede e edições concorrentes terminam iguais ao servidor',
    async (semente) => {
      const sorte = mulberry32(semente);
      const escolher = <T>(l: readonly T[]): T => l[Math.floor(sorte() * l.length)]!;
      const aparelhos = [];
      for (let i = 0; i < 3; i++) {
        aparelhos.push(
          await criarAparelhoPg(banco.como(ANA), {
            tamanhoLote: 1 + Math.floor(sorte() * 5),
            limitePagina: 1 + Math.floor(sorte() * 7),
          }),
        );
      }

      for (let passo = 0; passo < 70; passo++) {
        const ap = escolher(aparelhos);
        const acao = sorte();
        if (acao < 0.3) {
          await ap.motor.criar('teste_itens', { dono_id: ANA, nome: `n${passo}`, valor: passo });
        } else if (acao < 0.45) {
          const pais = (await ap.todos('teste_itens')).filter((l) => l.excluido_em === null);
          if (pais.length) {
            await ap.motor.criar('teste_filhos', {
              item_id: escolher(pais).id,
              dono_id: ANA,
              nome: `f${passo}`,
            });
          }
        } else if (acao < 0.7) {
          const vivos = (await ap.todos('teste_itens')).filter((l) => l.excluido_em === null);
          if (vivos.length) {
            const alvo = escolher(vivos).id as string;
            await ap.motor.atualizar(
              'teste_itens',
              alvo,
              escolher(['nome', 'valor'] as const) === 'nome'
                ? { nome: `e${passo}` }
                : { valor: passo },
            );
          }
        } else if (acao < 0.77) {
          const vivos = (await ap.todos('teste_itens')).filter((l) => l.excluido_em === null);
          if (vivos.length) await ap.motor.excluir('teste_itens', escolher(vivos).id as string);
        } else {
          ap.rede.falhaEnvio = escolher([null, null, 'antes', 'depois', 'sessao'] as const);
          ap.rede.falhaDownload = sorte() < 0.2 ? escolher(['antes', 'sessao'] as const) : null;
          await ap.motor.sincronizar();
          ap.rede.falhaEnvio = null;
          ap.rede.falhaDownload = null;
        }
      }

      for (let rodada = 0; rodada < 4; rodada++) {
        for (const ap of aparelhos) {
          const r = await ap.motor.sincronizar();
          expect(r.erro).toBeUndefined();
        }
      }

      const colunas = ['id', 'dono_id', 'nome', 'valor', 'excluido_em'];
      const doServidor = Object.fromEntries(
        (await banco.admin.query('select * from public.teste_itens')).map((l) => [
          l.id,
          {
            id: l.id,
            dono_id: l.dono_id,
            nome: l.nome,
            valor: l.valor,
            excluido_em: l.excluido_em ? true : null,
          },
        ]),
      );
      for (const ap of aparelhos) {
        const local = Object.fromEntries(
          (await ap.todos('teste_itens')).map((l) => [
            l.id,
            Object.fromEntries(
              colunas.map((c) => [c, c === 'excluido_em' ? (l[c] ? true : null) : (l[c] ?? null)]),
            ),
          ]),
        );
        expect(local).toEqual(doServidor);
        const estado = await ap.motor.estado();
        expect(estado.pendentes).toBe(0);
        expect(estado.falhas).toEqual([]);
      }
      const filhosServidor = (
        await banco.admin.query('select id from public.teste_filhos order by id')
      ).map((l) => l.id);
      for (const ap of aparelhos) {
        expect((await ap.todos('teste_filhos')).map((l) => l.id)).toEqual(filhosServidor);
      }
    },
  );
});
