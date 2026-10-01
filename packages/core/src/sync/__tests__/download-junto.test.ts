import { MotorSincronizacao } from '../motor';
import {
  ErroDeAutenticacao,
  ErroDeRede,
  type RemotoSincronizacao,
  type RespostaBaixarTudo,
} from '../tipos';
import { criarAparelho, relogioQueAvanca, RemotoFalso, type Aparelho } from './helpers';

let servidor: RemotoFalso;
let a: Aparelho;
let b: Aparelho;

beforeEach(async () => {
  servidor = new RemotoFalso();
  a = await criarAparelho(servidor, { relogio: relogioQueAvanca('2026-10-01T10:00:00Z') });
  b = await criarAparelho(servidor, { relogio: relogioQueAvanca('2026-10-01T10:30:00Z') });
});

const criar = (aparelho: Aparelho, dados: Record<string, unknown> = {}) =>
  aparelho.motor.criar('itens', { dono_id: 'ana', nome: 'x', valor: 1, ...dados });

describe('download de todas as tabelas numa chamada só', () => {
  it('sem novidade, uma sincronização faz UMA requisição de download, não uma por tabela', async () => {
    const muitasTabelas = Array.from({ length: 30 }, (_, i) => `tabela_${i}`);
    const motor = new MotorSincronizacao({
      local: b.local,
      remoto: servidor,
      tabelas: muitasTabelas,
    });
    const relatorio = await motor.sincronizar();
    expect(relatorio.baixadas).toBe(0);
    expect(servidor.chamadasBaixarTudo).toHaveLength(1);
    expect(Object.keys(servidor.chamadasBaixarTudo[0]!.cursores)).toHaveLength(30);
    expect(servidor.chamadasDownload).toHaveLength(0); // nada de chamada por tabela
  });

  it('traz as novidades de várias tabelas na mesma chamada', async () => {
    const pai = await criar(a);
    await a.motor.criar('filhos', { item_id: pai, dono_id: 'ana', nome: 'f' });
    await a.motor.sincronizar();
    servidor.chamadasBaixarTudo.length = 0;

    const r = await b.motor.sincronizar();
    expect(r.baixadas).toBe(2);
    expect(servidor.chamadasBaixarTudo).toHaveLength(1);
    expect(await b.todos('itens')).toHaveLength(1);
    expect(await b.todos('filhos')).toHaveLength(1);
  });

  it('o cursor enviado é exatamente o salvo (sem margem que repita linhas)', async () => {
    await criar(a);
    await a.motor.sincronizar();
    await b.motor.sincronizar();
    const salvo = (await b.motor.estado()).cursores;
    servidor.chamadasBaixarTudo.length = 0;
    await b.motor.sincronizar();
    expect(servidor.chamadasBaixarTudo[0]!.cursores).toEqual(salvo);
  });

  it('não baixa de novo o que já tem: segunda sincronização entrega zero linhas', async () => {
    for (let i = 0; i < 20; i++) await criar(a, { valor: i });
    await a.motor.sincronizar();
    await b.motor.sincronizar();
    const antes = servidor.linhasEntregues;
    await b.motor.sincronizar();
    await b.motor.sincronizar();
    expect(servidor.linhasEntregues - antes).toBe(0);
  });

  it('uma edição em um aparelho faz o outro baixar exatamente 1 linha (a linha inteira, uma vez)', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push(await criar(a, { valor: i }));
    await a.motor.sincronizar();
    await b.motor.sincronizar();

    await a.motor.atualizar('itens', ids[3]!, { valor: 999 });
    await a.motor.sincronizar();
    const antes = servidor.linhasEntregues;
    await b.motor.sincronizar();
    expect(servidor.linhasEntregues - antes).toBe(1);
    expect((await b.ler('itens', ids[3]!))?.valor).toBe(999);
  });

  it('o aparelho que enviou recebe de volta só as próprias linhas alteradas (sem repetir o resto)', async () => {
    for (let i = 0; i < 10; i++) await criar(a, { valor: i });
    await a.motor.sincronizar();
    const antes = servidor.linhasEntregues;
    const id = (await a.todos('itens'))[0]!.id as string;
    await a.motor.atualizar('itens', id, { valor: 77 });
    await a.motor.sincronizar();
    expect(servidor.linhasEntregues - antes).toBe(1); // só a linha que acabou de enviar
  });

  it('tabela com mais linhas que o limite: as rodadas seguintes pedem só ela', async () => {
    for (let i = 0; i < 25; i++)
      servidor.gravarNoServidor('itens', { id: `i${String(i).padStart(2, '0')}`, dono_id: 'ana' });
    servidor.gravarNoServidor('filhos', { id: 'f1', item_id: 'i00', dono_id: 'ana' });
    const motor = new MotorSincronizacao({
      local: b.local,
      remoto: servidor,
      tabelas: ['itens', 'filhos'],
      limitePagina: 10,
    });
    const r = await motor.sincronizar();
    expect(r.baixadas).toBe(26);
    expect(servidor.chamadasBaixarTudo.map((c) => Object.keys(c.cursores))).toEqual([
      ['itens', 'filhos'], // 10 itens + 1 filho; itens tem mais
      ['itens'], // 10 itens
      ['itens'], // 5 itens: terminou
    ]);
    expect(await b.todos('itens')).toHaveLength(25);
  });

  it('o teto de linhas por chamada deixa tabelas para a rodada seguinte, sem perder nada', async () => {
    servidor.tetoPorChamada = 3;
    for (let i = 0; i < 6; i++) servidor.gravarNoServidor('itens', { id: `i${i}`, dono_id: 'ana' });
    for (let i = 0; i < 4; i++)
      servidor.gravarNoServidor('filhos', { id: `f${i}`, item_id: 'i0', dono_id: 'ana' });
    const motor = new MotorSincronizacao({
      local: b.local,
      remoto: servidor,
      tabelas: ['itens', 'filhos'],
      limitePagina: 3,
    });
    await motor.sincronizar();
    expect(await b.todos('itens')).toHaveLength(6);
    expect(await b.todos('filhos')).toHaveLength(4);
  });

  it('servidor preso (sempre a mesma página cheia) não faz o motor girar para sempre', async () => {
    let chamadas = 0;
    const preso: RemotoSincronizacao = {
      enviar: async () => [],
      baixar: async () => [],
      baixarTudo: async () => {
        chamadas += 1;
        return {
          dados: {
            itens: [
              { id: 'x1', dono_id: 'a', seq_sinc: 5 },
              { id: 'x2', dono_id: 'a', seq_sinc: 5 },
            ],
          },
          mais: ['itens'],
        };
      },
    };
    const motor = new MotorSincronizacao({
      local: b.local,
      remoto: preso,
      tabelas: ['itens'],
      limitePagina: 2,
    });
    await motor.sincronizar();
    expect(chamadas).toBeLessThanOrEqual(3);
  });

  it('falha de rede no meio: nada aplicado pela metade e o cursor não anda', async () => {
    await criar(a);
    await a.motor.sincronizar();
    servidor.falhaDownload = 'falha-antes';
    const r = await b.motor.sincronizar();
    expect(r.erro).toBe('rede');
    expect((await b.motor.estado()).cursores).toEqual({ itens: 0, filhos: 0 });
    expect((await b.motor.sincronizar()).erro).toBeUndefined();
    expect(await b.todos('itens')).toHaveLength(1);
  });

  it('sessão expirada é reportada como autenticação', async () => {
    servidor.falhaDownload = 'sessao-expirada';
    expect((await b.motor.sincronizar()).erro).toBe('autenticacao');
  });

  it('exceção qualquer do servidor vira falha de rede, sem derrubar o app', async () => {
    const quebrado: RemotoSincronizacao = {
      enviar: async () => [],
      baixar: async () => [],
      baixarTudo: async () => {
        throw new ErroDeRede('timeout');
      },
    };
    const motor = new MotorSincronizacao({ local: b.local, remoto: quebrado, tabelas: ['itens'] });
    expect((await motor.sincronizar()).erro).toBe('rede');
    const expirado: RemotoSincronizacao = {
      enviar: async () => [],
      baixar: async () => [],
      baixarTudo: async () => {
        throw new ErroDeAutenticacao('JWT');
      },
    };
    expect(
      (
        await new MotorSincronizacao({
          local: b.local,
          remoto: expirado,
          tabelas: ['itens'],
        }).sincronizar()
      ).erro,
    ).toBe('autenticacao');
  });

  it('linhas inválidas na resposta são ignoradas e o resto da tabela é aplicado', async () => {
    const sujo: RemotoSincronizacao = {
      enviar: async () => [],
      baixar: async () => [],
      baixarTudo: async (cursores): Promise<RespostaBaixarTudo> =>
        (cursores.itens ?? 0) > 0
          ? { dados: {}, mais: [] }
          : {
              dados: {
                itens: [
                  { nome: 'sem id', seq_sinc: 1 },
                  { id: 'sem-seq', dono_id: 'a' },
                  { id: 'boa', dono_id: 'a', nome: 'ok', seq_sinc: 4 },
                ],
              },
              mais: [],
            },
    };
    const motor = new MotorSincronizacao({ local: b.local, remoto: sujo, tabelas: ['itens'] });
    expect((await motor.sincronizar()).baixadas).toBe(1);
    expect((await b.todos('itens')).map((l) => l.id)).toEqual(['boa']);
  });

  it('servidor sem a chamada única continua funcionando, tabela por tabela', async () => {
    servidor.desligarBaixarTudo();
    await criar(a);
    await a.motor.sincronizar();
    servidor.chamadasDownload.length = 0;
    await b.motor.sincronizar();
    expect(servidor.chamadasBaixarTudo).toHaveLength(0);
    expect(servidor.chamadasDownload.map((c) => c.tabela)).toEqual(['itens', 'filhos']);
    expect(await b.todos('itens')).toHaveLength(1);
  });
});
