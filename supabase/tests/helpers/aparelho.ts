import {
  ArmazenamentoSqlite,
  MotorSincronizacao,
  ErroDeAutenticacao,
  ErroDeRede,
  criarGeradorUuidV7,
  prepararSincronizacaoLocal,
  type DriverSqlite,
  type ExecutorSqlite,
  type OperacaoEnvio,
  type Registro,
  type RemotoSincronizacao,
  type RespostaBaixarTudo,
  type ResultadoEnvio,
  type ValorSql,
} from '@v22/core';
import { DatabaseSync } from 'node:sqlite';

import type { Sessao } from './banco';

/** SQLite em memória com a mesma interface do expo-sqlite usada pelo app. */
export class DriverNode implements DriverSqlite {
  readonly db = new DatabaseSync(':memory:');
  private fila: Promise<unknown> = Promise.resolve();

  async executar(sql: string, parametros: ValorSql[] = []): Promise<void> {
    this.db.prepare(sql).run(...parametros);
  }

  async consultar<T = Record<string, unknown>>(
    sql: string,
    parametros: ValorSql[] = [],
  ): Promise<T[]> {
    return this.db
      .prepare(sql)
      .all(...parametros)
      .map((l) => ({ ...l })) as T[];
  }

  transacao<T>(fn: (tx: ExecutorSqlite) => Promise<T>): Promise<T> {
    const executar = async () => {
      this.db.exec('begin immediate');
      try {
        const r = await fn(this);
        this.db.exec('commit');
        return r;
      } catch (e) {
        this.db.exec('rollback');
        throw e;
      }
    };
    const proxima = this.fila.then(executar, executar);
    this.fila = proxima.catch(() => undefined);
    return proxima;
  }
}

export type Rede = {
  /** Quantas chamadas de download o servidor recebeu. */
  chamadasDownload: number;
  /** Falha do próximo `enviar`: antes de chegar ao servidor, ou depois de aplicado (resposta perdida). */
  falhaEnvio: 'antes' | 'depois' | 'sessao' | null;
  falhaDownload: 'antes' | 'sessao' | null;
  chamadasEnvio: OperacaoEnvio[][];
};

/** O servidor de verdade (funções SQL da migration, rodando no PGlite) como o app o enxergaria. */
export function remotoPglite(sessao: Sessao, rede: Rede): RemotoSincronizacao {
  return {
    async enviar(operacoes: OperacaoEnvio[]): Promise<ResultadoEnvio[]> {
      rede.chamadasEnvio.push(operacoes);
      const falha = rede.falhaEnvio;
      rede.falhaEnvio = null;
      if (falha === 'antes') throw new ErroDeRede('sem conexão');
      if (falha === 'sessao') throw new ErroDeAutenticacao('JWT expirado');
      const resultado = await sessao.rpc('sinc_enviar', JSON.stringify(operacoes));
      if (falha === 'depois') throw new ErroDeRede('conexão caiu antes da resposta');
      return resultado as ResultadoEnvio[];
    },
    async baixar(tabela: string, depoisDe: number, limite: number): Promise<Registro[]> {
      const falha = rede.falhaDownload;
      rede.falhaDownload = null;
      if (falha === 'antes') throw new ErroDeRede('sem conexão');
      if (falha === 'sessao') throw new ErroDeAutenticacao('JWT expirado');
      rede.chamadasDownload += 1;
      return (await sessao.rpc('sinc_baixar', tabela, depoisDe, limite)) as Registro[];
    },
    async baixarTudo(
      cursores: Record<string, number>,
      limite: number,
    ): Promise<RespostaBaixarTudo> {
      const falha = rede.falhaDownload;
      rede.falhaDownload = null;
      if (falha === 'antes') throw new ErroDeRede('sem conexão');
      if (falha === 'sessao') throw new ErroDeAutenticacao('JWT expirado');
      rede.chamadasDownload += 1;
      return (await sessao.rpc(
        'sinc_baixar_tudo',
        JSON.stringify(cursores),
        limite,
      )) as RespostaBaixarTudo;
    },
  };
}

export const TABELAS_LOCAIS_PG = [
  `create table teste_itens (
     id text primary key, dono_id text, nome text, valor integer,
     criado_em text, atualizado_em text, excluido_em text, seq_sinc integer
   )`,
  `create table teste_filhos (
     id text primary key, item_id text, dono_id text, nome text,
     criado_em text, atualizado_em text, excluido_em text, seq_sinc integer
   )`,
  `create table teste_segredos (
     id text primary key, dono_id text, nome text,
     criado_em text, atualizado_em text, excluido_em text, seq_sinc integer
   )`,
];

export async function criarAparelhoPg(
  sessao: Sessao,
  opcoes: { tamanhoLote?: number; limitePagina?: number } = {},
) {
  const driver = new DriverNode();
  await prepararSincronizacaoLocal(driver);
  for (const sql of TABELAS_LOCAIS_PG) await driver.executar(sql);
  const rede: Rede = {
    falhaEnvio: null,
    falhaDownload: null,
    chamadasEnvio: [],
    chamadasDownload: 0,
  };
  const local = ArmazenamentoSqlite.criar(driver, { novoIdOperacao: criarGeradorUuidV7() });
  const motor = new MotorSincronizacao({
    local,
    remoto: remotoPglite(sessao, rede),
    tabelas: ['teste_itens', 'teste_filhos', 'teste_segredos'],
    ...opcoes,
  });
  return {
    driver,
    local,
    motor,
    rede,
    ler: async (tabela: string, id: string) =>
      (
        await driver.consultar<Record<string, unknown>>(`select * from ${tabela} where id = ?`, [
          id,
        ])
      )[0],
    todos: (tabela: string) =>
      driver.consultar<Record<string, unknown>>(`select * from ${tabela} order by id`),
  };
}
