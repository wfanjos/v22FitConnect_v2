import { MotorSincronizacao } from '../motor';
import { ArmazenamentoSqlite } from '../sqlite';
import {
  criarAparelho,
  criarDriverLocal,
  relogioQueAvanca,
  RemotoFalso,
  type Aparelho,
  type DriverNode,
} from './helpers';

const AGORA = '2026-10-01T10:00:00.000Z';
const DEPOIS = '2026-10-01T11:00:00.000Z';

describe('armazenamento: servidor mais novo que o app (colunas desconhecidas)', () => {
  let driver: DriverNode;
  let local: ArmazenamentoSqlite;
  let n = 0;

  beforeEach(async () => {
    driver = await criarDriverLocal();
    n = 0;
    local = ArmazenamentoSqlite.criar(driver, { novoIdOperacao: () => `op-${++n}` });
  });

  const linha = async (tabela: string, id: string) =>
    (await driver.consultar<any>(`select * from ${tabela} where id = ?`, [id]))[0];

  it('ignora a coluna que o aparelho ainda não tem e aplica o resto', async () => {
    const aplicou = await local.aplicarRemoto('itens', {
      id: 'a',
      dono_id: 'ana',
      nome: 'ok',
      coluna_do_futuro: 'o app antigo não conhece',
      seq_sinc: 5,
    });
    expect(aplicou).toBe(true);
    expect(await linha('itens', 'a')).toMatchObject({ nome: 'ok', seq_sinc: 5 });
  });

  it('uma página inteira com coluna nova é aplicada e o cursor avança', async () => {
    await local.transacao(async (tx) => {
      await tx.aplicarRemoto('itens', { id: 'a', nome: 'a', nova: 1, seq_sinc: 1 });
      await tx.aplicarRemoto('itens', { id: 'b', nome: 'b', nova: 2, seq_sinc: 2 });
      await tx.gravarCursor('itens', 2);
    });
    expect(await driver.consultar('select id from itens order by id')).toHaveLength(2);
    expect(await local.lerCursor('itens')).toBe(2);
  });

  it('tabela que nem existe no aparelho dá erro claro (falha de migration local)', async () => {
    await expect(
      local.aplicarRemoto('tabela_inexistente', { id: 'a', seq_sinc: 1 }),
    ).rejects.toThrow(/não existe/);
  });

  it('o aparelho continua gravando só colunas que conhece (coluna inválida é erro de quem chamou)', async () => {
    await expect(local.gravar('itens', { id: 'a', coluna_do_futuro: 1 }, AGORA)).rejects.toThrow();
  });
});

describe('armazenamento: descartarFalha restaura a linha local', () => {
  let driver: DriverNode;
  let local: ArmazenamentoSqlite;
  let n = 0;

  beforeEach(async () => {
    driver = await criarDriverLocal();
    n = 0;
    local = ArmazenamentoSqlite.criar(driver, { novoIdOperacao: () => `op-${++n}` });
  });

  const linha = async (tabela: string, id: string) =>
    (await driver.consultar<any>(`select * from ${tabela} where id = ?`, [id]))[0];
  const falhar = (tabela: string, id: string, op: string) =>
    local.registrarTentativa(tabela, id, op, {
      codigo: '42501',
      mensagem: 'sem permissão',
      permanente: true,
      contar: true,
    });

  it('registro que nunca chegou ao servidor some do aparelho', async () => {
    await local.gravar('itens', { id: 'novo', dono_id: 'ana', nome: 'recusado' }, AGORA);
    await falhar('itens', 'novo', 'op-1');
    expect(await local.descartarFalha('itens', 'novo')).toBe(true);
    expect(await linha('itens', 'novo')).toBeUndefined();
    expect(await driver.consultar('select * from sinc_fila')).toHaveLength(0);
  });

  it('registro que já existe no servidor volta ao valor do servidor no próximo download', async () => {
    await local.aplicarRemoto('itens', {
      id: 'a',
      dono_id: 'ana',
      nome: 'do servidor',
      valor: 1,
      seq_sinc: 10,
    });
    await local.gravarCursor('itens', 10);
    await local.gravar('itens', { id: 'a', nome: 'valor recusado' }, DEPOIS);
    await falhar('itens', 'a', 'op-1');
    expect(await local.descartarFalha('itens', 'a')).toBe(true);

    expect(await local.lerCursor('itens')).toBe(0); // baixa a tabela de novo
    // O mesmo seq_sinc do servidor volta a valer (antes era barrado por ser igual ao local):
    expect(
      await local.aplicarRemoto('itens', {
        id: 'a',
        dono_id: 'ana',
        nome: 'do servidor',
        valor: 1,
        seq_sinc: 10,
      }),
    ).toBe(true);
    expect(await linha('itens', 'a')).toMatchObject({ nome: 'do servidor' });
  });

  it('só descarta falhas; pendentes e outros cursores não são tocados', async () => {
    await local.gravarCursor('filhos', 7);
    await local.gravar('itens', { id: 'a', dono_id: 'ana' }, AGORA);
    await local.gravar('itens', { id: 'b', dono_id: 'ana' }, AGORA);
    await falhar('itens', 'a', 'op-1');
    expect(await local.descartarFalha('itens', 'b')).toBe(false); // b está pendente, não falhou
    expect(await local.descartarFalha('itens', 'a')).toBe(true);
    expect(await linha('itens', 'b')).toBeDefined();
    expect((await local.listarFila()).map((i) => i.registroId)).toEqual(['b']);
    expect(await local.lerCursor('filhos')).toBe(7);
  });
});

describe('motor: limites e reconciliação', () => {
  let servidor: RemotoFalso;
  let a: Aparelho;

  beforeEach(async () => {
    servidor = new RemotoFalso();
    a = await criarAparelho(servidor, { relogio: relogioQueAvanca('2026-10-01T10:00:00Z') });
  });

  const novoItem = (dados: Record<string, unknown> = {}) =>
    a.motor.criar('itens', { dono_id: 'ana', nome: 'supino', valor: 10, ...dados });

  it('lote maior que o limite do servidor (200) é recusado na criação do motor', () => {
    expect(
      () =>
        new MotorSincronizacao({ local: a.local, remoto: servidor, tabelas: [], tamanhoLote: 201 }),
    ).toThrow(/200/);
    expect(
      () =>
        new MotorSincronizacao({ local: a.local, remoto: servidor, tabelas: [], tamanhoLote: 200 }),
    ).not.toThrow();
  });

  it('descartar uma falha de RLS devolve o aparelho ao que o servidor tem', async () => {
    const id = await novoItem({ nome: 'original' });
    await a.motor.sincronizar();

    servidor.rejeitar = () => ({ codigo: '42501', mensagem: 'vínculo encerrado' });
    await a.motor.atualizar('itens', id, { nome: 'edição recusada' });
    await a.motor.sincronizar();
    expect((await a.motor.estado()).falhas).toHaveLength(1);
    expect((await a.ler('itens', id))?.nome).toBe('edição recusada'); // ainda mostra o recusado

    servidor.rejeitar = () => null;
    expect(await a.motor.descartarFalha('itens', id)).toBe(true);
    await a.motor.sincronizar();
    expect((await a.ler('itens', id))?.nome).toBe('original');
    expect((await a.motor.estado()).falhas).toHaveLength(0);
  });

  it('descartar o registro recusado que nunca chegou ao servidor o remove do aparelho', async () => {
    servidor.rejeitar = () => ({ codigo: '42501', mensagem: 'sem permissão' });
    const id = await novoItem();
    await a.motor.sincronizar();
    await a.motor.descartarFalha('itens', id);
    expect(await a.ler('itens', id)).toBeUndefined();
  });

  it('as confirmações de um lote são aplicadas juntas, numa só transação', async () => {
    for (let i = 0; i < 4; i++) await novoItem({ valor: i });
    let transacoes = 0;
    const original = a.local.transacao.bind(a.local);
    a.local.transacao = ((fn: Parameters<typeof original>[0]) => {
      transacoes += 1;
      return original(fn);
    }) as typeof original;
    const motor = new MotorSincronizacao({
      local: a.local,
      remoto: servidor,
      tabelas: ['itens'],
      tamanhoLote: 10,
    });
    await motor.enviarPendentes();
    expect(transacoes).toBe(1); // um lote de 4 itens = 1 transação para as 4 confirmações
    expect((await a.motor.estado()).pendentes).toBe(0);
  });
});
