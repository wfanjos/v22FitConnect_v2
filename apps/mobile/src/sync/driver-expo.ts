import type { DriverSqlite, ExecutorSqlite, ValorSql } from '@v22/core';
import type { SQLiteDatabase } from 'expo-sqlite';

type Alvo = Pick<SQLiteDatabase, 'runAsync' | 'getAllAsync'>;

const executor = (alvo: Alvo): ExecutorSqlite => ({
  executar: async (sql: string, parametros: ValorSql[] = []) => {
    await alvo.runAsync(sql, parametros);
  },
  consultar: <T>(sql: string, parametros: ValorSql[] = []) => alvo.getAllAsync<T>(sql, parametros),
});

/**
 * Liga o motor de sincronização ao expo-sqlite.
 * A transação é exclusiva (outra conexão): gravações do app esperam o fim dela.
 */
export function criarDriverExpo(
  db: Pick<SQLiteDatabase, 'runAsync' | 'getAllAsync' | 'withExclusiveTransactionAsync'>,
): DriverSqlite {
  return {
    ...executor(db),
    async transacao<T>(fn: (tx: ExecutorSqlite) => Promise<T>): Promise<T> {
      let resultado: T | undefined;
      await db.withExclusiveTransactionAsync(async (txn) => {
        resultado = await fn(executor(txn));
      });
      return resultado as T;
    },
  };
}
