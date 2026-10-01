import { criarGeradorUuidV7 } from '../../uuid';
import { ArmazenamentoSqlite, paraSqlite } from '../sqlite';
import { criarDriverLocal, type DriverNode } from './helpers';

let driver: DriverNode;
let local: ArmazenamentoSqlite;
let contadorOperacao = 0;

beforeEach(async () => {
  driver = await criarDriverLocal();
  contadorOperacao = 0;
  local = ArmazenamentoSqlite.criar(driver, {
    novoIdOperacao: () => `op-${++contadorOperacao}`,
  });
});

const AGORA = '2026-10-01T10:00:00.000Z';
const DEPOIS = '2026-10-01T11:00:00.000Z';

const fila = () => driver.consultar<any>('select * from sinc_fila order by ordem');
const linha = async (tabela: string, id: string) =>
  (await driver.consultar<any>(`select * from ${tabela} where id = ?`, [id]))[0];

describe('paraSqlite', () => {
  it('converte tipos do JSON para tipos do SQLite', () => {
    expect(paraSqlite(null)).toBeNull();
    expect(paraSqlite(undefined)).toBeNull();
    expect(paraSqlite(true)).toBe(1);
    expect(paraSqlite(false)).toBe(0);
    expect(paraSqlite(42)).toBe(42);
    expect(paraSqlite('texto')).toBe('texto');
    expect(paraSqlite({ a: 1 })).toBe('{"a":1}');
    expect(paraSqlite([1, 2])).toBe('[1,2]');
  });
});

describe('gravar', () => {
  it('registro novo: cria a linha local e enfileira a carga completa', async () => {
    await local.gravar('itens', { id: 'a', dono_id: 'ana', nome: 'supino', valor: 10 }, AGORA);
    const l = await linha('itens', 'a');
    expect(l).toMatchObject({
      id: 'a',
      nome: 'supino',
      valor: 10,
      criado_em: AGORA,
      atualizado_em: AGORA,
    });
    expect(l.seq_sinc).toBeNull();

    const [item] = await fila();
    expect(item).toMatchObject({
      tabela: 'itens',
      registro_id: 'a',
      id_operacao: 'op-1',
      tentativas: 0,
      falha: 0,
    });
    // O servidor define atualizado_em e seq_sinc: o aparelho não envia. criado_em vai.
    expect(JSON.parse(item.carga)).toEqual({
      id: 'a',
      dono_id: 'ana',
      nome: 'supino',
      valor: 10,
      criado_em: AGORA,
    });
  });

  it('respeita o criado_em informado (registro criado offline antes)', async () => {
    await local.gravar(
      'itens',
      { id: 'a', dono_id: 'ana', criado_em: '2026-01-01T00:00:00.000Z' },
      AGORA,
    );
    expect((await linha('itens', 'a')).criado_em).toBe('2026-01-01T00:00:00.000Z');
  });

  it('registro existente: muda só as colunas informadas e renova atualizado_em local', async () => {
    await local.gravar('itens', { id: 'a', dono_id: 'ana', nome: 'supino', valor: 10 }, AGORA);
    await local.gravar('itens', { id: 'a', valor: 12 }, DEPOIS);
    const l = await linha('itens', 'a');
    expect(l).toMatchObject({ nome: 'supino', valor: 12, criado_em: AGORA, atualizado_em: DEPOIS });
  });

  it('edições seguidas viram uma só operação, com o que mudou, e id_operacao novo', async () => {
    await local.gravar('itens', { id: 'a', dono_id: 'ana', nome: 'supino', valor: 10 }, AGORA);
    await local.gravar('itens', { id: 'a', valor: 11 }, AGORA);
    await local.gravar('itens', { id: 'a', nome: 'supino reto' }, AGORA);
    const itens = await fila();
    expect(itens).toHaveLength(1);
    expect(itens[0].id_operacao).toBe('op-3');
    expect(JSON.parse(itens[0].carga)).toMatchObject({
      nome: 'supino reto',
      valor: 11,
      dono_id: 'ana',
    });
  });

  it('a mesma coluna editada duas vezes fica com o último valor', async () => {
    await local.gravar('itens', { id: 'a', dono_id: 'ana', valor: 1 }, AGORA);
    await local.gravar('itens', { id: 'a', valor: 2 }, AGORA);
    await local.gravar('itens', { id: 'a', valor: 3 }, AGORA);
    expect(JSON.parse((await fila())[0].carga).valor).toBe(3);
  });

  it('mantém a posição na fila ao reeditar (pai continua antes do filho)', async () => {
    await local.gravar('itens', { id: 'pai', dono_id: 'ana' }, AGORA);
    await local.gravar('filhos', { id: 'filho', item_id: 'pai', dono_id: 'ana' }, AGORA);
    await local.gravar('itens', { id: 'pai', nome: 'editado depois do filho' }, AGORA);
    expect((await fila()).map((i) => i.registro_id)).toEqual(['pai', 'filho']);
  });

  it('reeditar um registro com falha o devolve para o envio e zera as tentativas', async () => {
    await local.gravar('itens', { id: 'a', dono_id: 'ana' }, AGORA);
    await local.registrarTentativa('itens', 'a', 'op-1', {
      codigo: '42501',
      mensagem: 'rls',
      permanente: true,
      contar: true,
    });
    expect(await local.listarFila()).toHaveLength(0);
    await local.gravar('itens', { id: 'a', nome: 'corrigido' }, AGORA);
    const [item] = await local.listarFila();
    expect(item).toMatchObject({ registroId: 'a', tentativas: 0 });
    expect((await fila())[0]).toMatchObject({ falha: 0, ultimo_codigo: null, ultimo_erro: null });
  });

  it('guarda a carga com os tipos do JSON; a linha local usa tipos do SQLite', async () => {
    await local.gravar(
      'itens',
      { id: 'a', dono_id: 'ana', ativo: true, dados: { series: [1, 2] } },
      AGORA,
    );
    const l = await linha('itens', 'a');
    expect(l.ativo).toBe(1);
    expect(JSON.parse(l.dados)).toEqual({ series: [1, 2] });
    expect(JSON.parse((await fila())[0].carga)).toMatchObject({
      ativo: true,
      dados: { series: [1, 2] },
    });
  });

  it('não envia seq_sinc nem atualizado_em, mesmo se o chamador mandar', async () => {
    await local.gravar(
      'itens',
      { id: 'a', dono_id: 'ana', seq_sinc: 999, atualizado_em: '2099-01-01' },
      AGORA,
    );
    const carga = JSON.parse((await fila())[0].carga);
    expect(carga).not.toHaveProperty('seq_sinc');
    expect(carga).not.toHaveProperty('atualizado_em');
    expect((await linha('itens', 'a')).seq_sinc).toBeNull();
  });

  it('exige id', async () => {
    await expect(local.gravar('itens', { nome: 'sem id' }, AGORA)).rejects.toThrow(
      /precisa de um id/,
    );
    await expect(local.gravar('itens', { id: '', nome: 'x' }, AGORA)).rejects.toThrow(
      /precisa de um id/,
    );
    expect(await fila()).toHaveLength(0);
  });

  it('recusa nome de tabela ou coluna perigoso e não executa nada', async () => {
    await expect(local.gravar('itens; drop table itens', { id: 'a' }, AGORA)).rejects.toThrow(
      /nome inválido/,
    );
    await expect(
      local.gravar('itens', { id: 'a', 'nome"; drop table itens; --': 'x' }, AGORA),
    ).rejects.toThrow(/nome inválido/);
    await local.gravar('itens', { id: 'b', dono_id: 'ana' }, AGORA);
    await expect(local.gravar('itens', { id: 'b', 'x = 1; --': 'x' }, AGORA)).rejects.toThrow(
      /nome inválido/,
    );
    expect(
      await driver.consultar(`select name from sqlite_master where name = 'itens'`),
    ).toHaveLength(1);
  });

  it('se algo falha no meio, nada fica pela metade (linha e fila andam juntas)', async () => {
    await expect(
      local.gravar('itens', { id: 'a', coluna_que_nao_existe: 1 }, AGORA),
    ).rejects.toThrow();
    expect(await linha('itens', 'a')).toBeUndefined();
    expect(await fila()).toHaveLength(0);
  });
});

describe('aplicarRemoto', () => {
  const remoto = (extra: Record<string, unknown> = {}) => ({
    id: 'a',
    dono_id: 'ana',
    nome: 'do servidor',
    valor: 5,
    ativo: true,
    dados: { x: 1 },
    criado_em: AGORA,
    atualizado_em: AGORA,
    excluido_em: null,
    seq_sinc: 10,
    ...extra,
  });

  it('insere linha nova e converte os tipos', async () => {
    expect(await local.aplicarRemoto('itens', remoto())).toBe(true);
    const l = await linha('itens', 'a');
    expect(l).toMatchObject({ nome: 'do servidor', valor: 5, ativo: 1, seq_sinc: 10 });
    expect(JSON.parse(l.dados)).toEqual({ x: 1 });
    expect(await fila()).toHaveLength(0); // não enfileira o que veio do servidor
  });

  it('atualiza com versão mais nova e ignora versão igual ou mais velha', async () => {
    await local.aplicarRemoto('itens', remoto());
    expect(await local.aplicarRemoto('itens', remoto({ nome: 'v2', seq_sinc: 11 }))).toBe(true);
    expect((await linha('itens', 'a')).nome).toBe('v2');
    expect(await local.aplicarRemoto('itens', remoto({ nome: 'repetida', seq_sinc: 11 }))).toBe(
      false,
    );
    expect(await local.aplicarRemoto('itens', remoto({ nome: 'velha', seq_sinc: 3 }))).toBe(false);
    expect((await linha('itens', 'a')).nome).toBe('v2');
  });

  it('exclusão lógica vinda do servidor chega ao aparelho', async () => {
    await local.aplicarRemoto('itens', remoto());
    await local.aplicarRemoto('itens', remoto({ excluido_em: DEPOIS, seq_sinc: 12 }));
    expect((await linha('itens', 'a')).excluido_em).toBe(DEPOIS);
  });

  it('não sobrescreve colunas com alteração local pendente, mas atualiza as demais', async () => {
    await local.aplicarRemoto('itens', remoto());
    await local.gravar('itens', { id: 'a', nome: 'minha edição offline' }, DEPOIS);
    await local.aplicarRemoto('itens', remoto({ nome: 'outro aparelho', valor: 77, seq_sinc: 20 }));
    const l = await linha('itens', 'a');
    expect(l.nome).toBe('minha edição offline'); // pendente: vence
    expect(l.valor).toBe(77); // não pendente: vem do servidor
    expect(l.seq_sinc).toBe(20);
  });

  it('depois que a alteração pendente é enviada, o servidor volta a mandar', async () => {
    await local.aplicarRemoto('itens', remoto());
    await local.gravar('itens', { id: 'a', nome: 'minha' }, DEPOIS);
    await local.removerDaFila('itens', 'a', 'op-1');
    await local.aplicarRemoto('itens', remoto({ nome: 'confirmada pelo servidor', seq_sinc: 30 }));
    expect((await linha('itens', 'a')).nome).toBe('confirmada pelo servidor');
  });

  it('ignora linha sem id', async () => {
    expect(await local.aplicarRemoto('itens', { nome: 'sem id', seq_sinc: 1 })).toBe(false);
    expect(await driver.consultar('select * from itens')).toHaveLength(0);
  });

  it('coluna com nome perigoso vinda do servidor é ignorada (não existe no aparelho) e nada é executado', async () => {
    const aplicou = await local.aplicarRemoto('itens', remoto({ 'x"); drop table itens; --': 1 }));
    expect(aplicou).toBe(true);
    expect(
      await driver.consultar(`select name from sqlite_master where name = 'itens'`),
    ).toHaveLength(1);
    expect(await linha('itens', 'a')).toMatchObject({ nome: 'do servidor' });
  });
});

describe('cursor', () => {
  it('começa em zero, avança e nunca diminui', async () => {
    expect(await local.lerCursor('itens')).toBe(0);
    await local.gravarCursor('itens', 50);
    await local.gravarCursor('itens', 30);
    expect(await local.lerCursor('itens')).toBe(50);
    await local.gravarCursor('itens', 80);
    expect(await local.lerCursor('itens')).toBe(80);
  });

  it('cada tabela tem o seu', async () => {
    await local.gravarCursor('itens', 5);
    await local.gravarCursor('filhos', 9);
    expect(await local.lerCursor('itens')).toBe(5);
    expect(await local.lerCursor('filhos')).toBe(9);
  });

  it('reiniciarCursor volta a zero (baixar tudo de novo)', async () => {
    await local.gravarCursor('itens', 80);
    await local.reiniciarCursor('itens');
    expect(await local.lerCursor('itens')).toBe(0);
    await local.reiniciarCursor('tabela_sem_cursor');
    expect(await local.lerCursor('tabela_sem_cursor')).toBe(0);
  });
});

describe('fila', () => {
  it('removerDaFila só remove se o id_operacao for o mesmo (edição durante o envio não se perde)', async () => {
    await local.gravar('itens', { id: 'a', dono_id: 'ana', valor: 1 }, AGORA); // op-1
    const enviada = (await local.listarFila())[0]!;
    await local.gravar('itens', { id: 'a', valor: 2 }, AGORA); // op-2, durante o envio
    expect(await local.removerDaFila('itens', 'a', enviada.idOperacao)).toBe(false);
    const restante = await local.listarFila();
    expect(restante).toHaveLength(1);
    expect(restante[0]!.idOperacao).toBe('op-2');
    expect(await local.removerDaFila('itens', 'a', 'op-2')).toBe(true);
    expect(await local.listarFila()).toHaveLength(0);
  });

  it('removerDaFila de algo que não existe devolve falso', async () => {
    expect(await local.removerDaFila('itens', 'nada', 'op-x')).toBe(false);
  });

  it('listarFila vem na ordem das alterações e sem as falhas definitivas', async () => {
    await local.gravar('itens', { id: 'a', dono_id: 'x' }, AGORA);
    await local.gravar('itens', { id: 'b', dono_id: 'x' }, AGORA);
    await local.gravar('itens', { id: 'c', dono_id: 'x' }, AGORA);
    await local.registrarTentativa('itens', 'b', 'op-2', {
      codigo: '42501',
      mensagem: 'm',
      permanente: true,
      contar: true,
    });
    expect((await local.listarFila()).map((i) => i.registroId)).toEqual(['a', 'c']);
  });

  it('registrarTentativa conta (ou não) e guarda o motivo', async () => {
    await local.gravar('itens', { id: 'a', dono_id: 'x' }, AGORA);
    await local.registrarTentativa('itens', 'a', 'op-1', {
      codigo: '40001',
      mensagem: 'm1',
      permanente: false,
      contar: true,
    });
    await local.registrarTentativa('itens', 'a', 'op-1', {
      codigo: '23503',
      mensagem: 'm2',
      permanente: false,
      contar: false,
    });
    expect((await local.listarFila())[0]!.tentativas).toBe(1);
    expect((await fila())[0]).toMatchObject({
      ultimo_codigo: '23503',
      ultimo_erro: 'm2',
      falha: 0,
    });
  });

  it('registrarTentativa de uma operação que já foi trocada não faz nada', async () => {
    await local.gravar('itens', { id: 'a', dono_id: 'x' }, AGORA);
    await local.gravar('itens', { id: 'a', nome: 'novo' }, AGORA); // op-2
    await local.registrarTentativa('itens', 'a', 'op-1', {
      codigo: '42501',
      mensagem: 'velha',
      permanente: true,
      contar: true,
    });
    expect((await fila())[0]).toMatchObject({ falha: 0, tentativas: 0 });
  });

  it('falhas definitivas aparecem em listarFalhas com o motivo; reenfileirar e descartar funcionam', async () => {
    await local.gravar('itens', { id: 'a', dono_id: 'x' }, AGORA);
    await local.gravar('itens', { id: 'b', dono_id: 'x' }, AGORA);
    await local.registrarTentativa('itens', 'a', 'op-1', {
      codigo: '42501',
      mensagem: 'sem permissão',
      permanente: true,
      contar: true,
    });
    await local.registrarTentativa('itens', 'b', 'op-2', {
      codigo: '23505',
      mensagem: 'duplicado',
      permanente: true,
      contar: true,
    });

    const falhas = await local.listarFalhas();
    expect(falhas.map((f) => [f.registroId, f.codigo, f.mensagem])).toEqual([
      ['a', '42501', 'sem permissão'],
      ['b', '23505', 'duplicado'],
    ]);

    expect(await local.descartarFalha('itens', 'a')).toBe(true);
    expect(await local.descartarFalha('itens', 'a')).toBe(false);
    expect(await local.descartarFalha('itens', 'inexistente')).toBe(false);

    expect(await local.reenfileirarFalhas()).toBe(1);
    expect(await local.listarFalhas()).toHaveLength(0);
    expect((await local.listarFila()).map((i) => i.registroId)).toEqual(['b']);
  });

  it('descartarFalha não apaga alteração que ainda está pendente (sem falha)', async () => {
    await local.gravar('itens', { id: 'a', dono_id: 'x' }, AGORA);
    expect(await local.descartarFalha('itens', 'a')).toBe(false);
    expect(await local.listarFila()).toHaveLength(1);
  });
});

describe('transacao', () => {
  it('desfaz tudo se falhar no meio (linhas e cursor juntos)', async () => {
    await expect(
      local.transacao(async (tx) => {
        await tx.aplicarRemoto('itens', { id: 'a', dono_id: 'x', seq_sinc: 5 });
        await tx.gravarCursor('itens', 5);
        throw new Error('caiu no meio');
      }),
    ).rejects.toThrow('caiu no meio');
    expect(await linha('itens', 'a')).toBeUndefined();
    expect(await local.lerCursor('itens')).toBe(0);
  });

  it('confirma tudo quando termina bem', async () => {
    await local.transacao(async (tx) => {
      await tx.aplicarRemoto('itens', { id: 'a', dono_id: 'x', seq_sinc: 5 });
      await tx.gravarCursor('itens', 5);
    });
    expect(await linha('itens', 'a')).toBeDefined();
    expect(await local.lerCursor('itens')).toBe(5);
  });

  it('transação dentro de transação reaproveita a de fora', async () => {
    await expect(
      local.transacao(async (tx) => {
        await tx.transacao(async (interna) => {
          await interna.gravarCursor('itens', 9);
        });
        throw new Error('desfaz também a interna');
      }),
    ).rejects.toThrow();
    expect(await local.lerCursor('itens')).toBe(0);
  });

  it('gravações simultâneas não se misturam nem se perdem', async () => {
    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        local.gravar('itens', { id: `id-${i}`, dono_id: 'ana', valor: i }, AGORA),
      ),
    );
    expect(await driver.consultar('select * from itens')).toHaveLength(50);
    const ordens = (await fila()).map((f) => f.ordem);
    expect(new Set(ordens).size).toBe(50); // nenhuma posição repetida
  });
});

describe('ids de operação', () => {
  it('com o gerador uuid v7 os ids são únicos e ordenados', async () => {
    const real = ArmazenamentoSqlite.criar(driver, { novoIdOperacao: criarGeradorUuidV7() });
    for (let i = 0; i < 30; i++) await real.gravar('itens', { id: `x${i}`, dono_id: 'a' }, AGORA);
    const ids = (await fila()).map((f) => f.id_operacao);
    expect(new Set(ids).size).toBe(30);
    expect([...ids].sort()).toEqual(ids);
  });
});
