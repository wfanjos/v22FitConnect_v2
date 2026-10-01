import { criarDriverExpo } from '../driver-expo';

type Chamada = { origem: 'db' | 'txn'; metodo: 'run' | 'all'; sql: string; params: unknown[] };

function criarDbFalso(opcoes: { falharNaTransacao?: boolean } = {}) {
  const chamadas: Chamada[] = [];
  let emTransacao = false;
  const alvo = (origem: 'db' | 'txn') => ({
    runAsync: jest.fn(async (sql: string, params: unknown[]) => {
      chamadas.push({ origem, metodo: 'run', sql, params });
      return { changes: 1, lastInsertRowId: 1 };
    }),
    getAllAsync: jest.fn(async (sql: string, params: unknown[]) => {
      chamadas.push({ origem, metodo: 'all', sql, params });
      return [{ n: 7 }];
    }),
  });
  const db = {
    ...alvo('db'),
    withExclusiveTransactionAsync: jest.fn(
      async (tarefa: (txn: ReturnType<typeof alvo>) => Promise<void>) => {
        emTransacao = true;
        try {
          await tarefa(alvo('txn'));
          if (opcoes.falharNaTransacao) throw new Error('rollback');
        } finally {
          emTransacao = false;
        }
      },
    ),
  };
  return { db, chamadas, estaEmTransacao: () => emTransacao };
}

describe('criarDriverExpo', () => {
  it('executar e consultar usam runAsync e getAllAsync com os parâmetros', async () => {
    const { db, chamadas } = criarDbFalso();
    const driver = criarDriverExpo(db as never);
    await driver.executar('insert into t values (?, ?)', ['a', 1]);
    expect(await driver.consultar('select count(*) as n from t where x = ?', ['a'])).toEqual([
      { n: 7 },
    ]);
    expect(chamadas).toEqual([
      { origem: 'db', metodo: 'run', sql: 'insert into t values (?, ?)', params: ['a', 1] },
      {
        origem: 'db',
        metodo: 'all',
        sql: 'select count(*) as n from t where x = ?',
        params: ['a'],
      },
    ]);
  });

  it('sem parâmetros manda uma lista vazia', async () => {
    const { db, chamadas } = criarDbFalso();
    const driver = criarDriverExpo(db as never);
    await driver.executar('delete from t');
    await driver.consultar('select 1');
    expect(chamadas.map((c) => c.params)).toEqual([[], []]);
  });

  it('transacao usa a conexão exclusiva e devolve o resultado da função', async () => {
    const { db, chamadas, estaEmTransacao } = criarDbFalso();
    const driver = criarDriverExpo(db as never);
    const resultado = await driver.transacao(async (tx) => {
      expect(estaEmTransacao()).toBe(true);
      await tx.executar('update t set x = ?', [1]);
      const linhas = await tx.consultar('select count(*) as n from t');
      return linhas.length;
    });
    expect(resultado).toBe(1);
    expect(estaEmTransacao()).toBe(false);
    expect(chamadas.every((c) => c.origem === 'txn')).toBe(true);
  });

  it('erro dentro da transação sobe para quem chamou', async () => {
    const { db } = criarDbFalso();
    const driver = criarDriverExpo(db as never);
    await expect(
      driver.transacao(async () => {
        throw new Error('falhou no meio');
      }),
    ).rejects.toThrow('falhou no meio');
  });

  it('se o banco desfaz a transação (rollback), o erro sobe e o resultado não vaza', async () => {
    const { db } = criarDbFalso({ falharNaTransacao: true });
    const driver = criarDriverExpo(db as never);
    await expect(driver.transacao(async () => 'resultado')).rejects.toThrow('rollback');
  });

  it('transação que devolve vazio ou falso funciona', async () => {
    const { db } = criarDbFalso();
    const driver = criarDriverExpo(db as never);
    expect(await driver.transacao(async () => undefined)).toBeUndefined();
    expect(await driver.transacao(async () => false)).toBe(false);
    expect(await driver.transacao(async () => 0)).toBe(0);
  });
});
