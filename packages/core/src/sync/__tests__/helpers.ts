import { DatabaseSync } from 'node:sqlite';

import { criarGeradorUuidV7 } from '../../uuid';
import { MotorSincronizacao, type OpcoesMotor } from '../motor';
import {
  ArmazenamentoSqlite,
  prepararSincronizacaoLocal,
  type DriverSqlite,
  type ExecutorSqlite,
  type ValorSql,
} from '../sqlite';
import {
  ErroDeAutenticacao,
  ErroDeRede,
  type OperacaoEnvio,
  type Registro,
  type RemotoSincronizacao,
  type RespostaBaixarTudo,
  type ResultadoEnvio,
} from '../tipos';

// ---------------------------------------------------------------------------------------------
// SQLite de verdade (node:sqlite) com a mesma interface do expo-sqlite usada pelo app
// ---------------------------------------------------------------------------------------------

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
      .map((linha) => ({ ...linha })) as T[];
  }

  /** Uma transação por vez (como a transação exclusiva do expo-sqlite). */
  transacao<T>(fn: (tx: ExecutorSqlite) => Promise<T>): Promise<T> {
    const executar = async () => {
      this.db.exec('begin immediate');
      try {
        const resultado = await fn(this);
        this.db.exec('commit');
        return resultado;
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

export const TABELAS_LOCAIS = [
  `create table itens (
     id text primary key,
     dono_id text,
     nome text,
     valor integer,
     ativo integer,
     dados text,
     criado_em text,
     atualizado_em text,
     excluido_em text,
     seq_sinc integer
   )`,
  `create table filhos (
     id text primary key,
     item_id text,
     dono_id text,
     nome text,
     criado_em text,
     atualizado_em text,
     excluido_em text,
     seq_sinc integer
   )`,
];

export async function criarDriverLocal(): Promise<DriverNode> {
  const driver = new DriverNode();
  await prepararSincronizacaoLocal(driver);
  for (const sql of TABELAS_LOCAIS) await driver.executar(sql);
  return driver;
}

// ---------------------------------------------------------------------------------------------
// Servidor falso em memória: reproduz as regras de sinc_enviar / sinc_baixar
// ---------------------------------------------------------------------------------------------

export type FalhaInjetada = 'falha-antes' | 'falha-depois' | 'sessao-expirada' | null;

export class RemotoFalso implements RemotoSincronizacao {
  readonly tabelas = new Map<string, Map<string, Registro>>();
  readonly aplicadas = new Set<string>();
  seq = 0;
  relogio = Date.parse('2026-10-01T12:00:00.000Z');

  /** Falha do próximo `enviar`: antes de aplicar, depois de aplicar (resposta perdida) ou sessão expirada. */
  falhaEnvio: FalhaInjetada = null;
  falhaDownload: FalhaInjetada = null;
  /** Recusa operações específicas (ex.: simular RLS). */
  rejeitar: (op: OperacaoEnvio) => { codigo: string; mensagem: string } | null = () => null;
  /** Colunas obrigatórias na criação, por tabela. */
  obrigatorias: Record<string, string[]> = { itens: ['dono_id'], filhos: ['item_id', 'dono_id'] };
  /** Linhas escondidas de quem baixa (simula RLS de leitura). */
  visivel: (tabela: string, linha: Registro) => boolean = () => true;

  chamadasEnvio: OperacaoEnvio[][] = [];
  chamadasBaixarTudo: Array<{ cursores: Record<string, number>; limite: number }> = [];
  /** Total de linhas entregues pelo servidor (para medir tráfego nos testes). */
  linhasEntregues = 0;
  /** Como o servidor real: no máximo ~2000 linhas por chamada de baixarTudo. */
  tetoPorChamada = 2000;
  chamadasDownload: Array<{ tabela: string; depoisDe: number; limite: number }> = [];
  /** Roda no meio do `enviar`, depois de aplicar (para simular edições concorrentes). */
  aoEnviar: (() => Promise<void>) | null = null;

  /** Desliga a chamada única: o motor volta a baixar tabela por tabela. */
  desligarBaixarTudo(): void {
    this.baixarTudo = undefined;
  }

  baixarTudo?: (cursores: Record<string, number>, limite: number) => Promise<RespostaBaixarTudo> =
    async (cursores, limite) => {
      this.chamadasBaixarTudo.push({ cursores: { ...cursores }, limite });
      const falha = this.falhaDownload;
      this.falhaDownload = null;
      if (falha === 'falha-antes') throw new ErroDeRede('sem conexão');
      if (falha === 'sessao-expirada') throw new ErroDeAutenticacao('JWT expirado');
      const dados: Record<string, Registro[]> = {};
      const mais: string[] = [];
      let total = 0;
      for (const [tabela, cursor] of Object.entries(cursores)) {
        if (total >= this.tetoPorChamada) {
          mais.push(tabela);
          continue;
        }
        const linhas = [...this.linhas(tabela).values()]
          .filter((l) => Number(l.seq_sinc) > cursor && this.visivel(tabela, l))
          .sort((a, b) => Number(a.seq_sinc) - Number(b.seq_sinc))
          .slice(0, limite)
          .map((l) => ({ ...l }));
        if (linhas.length > 0) {
          dados[tabela] = linhas;
          total += linhas.length;
          this.linhasEntregues += linhas.length;
        }
        if (linhas.length >= limite) mais.push(tabela);
      }
      return { dados, mais };
    };

  linhas(tabela: string): Map<string, Registro> {
    let t = this.tabelas.get(tabela);
    if (!t) {
      t = new Map();
      this.tabelas.set(tabela, t);
    }
    return t;
  }

  /** Grava direto no servidor (outro aparelho, painel admin...). */
  gravarNoServidor(tabela: string, registro: Registro): void {
    this.aplicar({ id_operacao: `direto-${this.seq}`, tabela, registro });
  }

  private proximoInstante(): string {
    this.relogio += 1;
    return new Date(this.relogio).toISOString();
  }

  private aplicar(op: OperacaoEnvio): ResultadoEnvio {
    const rejeicao = this.rejeitar(op);
    if (rejeicao) return { id_operacao: op.id_operacao, ok: false, ...rejeicao };

    const tabela = this.linhas(op.tabela);
    const id = op.registro.id;
    if (typeof id !== 'string') {
      return {
        id_operacao: op.id_operacao,
        ok: false,
        codigo: '22023',
        mensagem: 'registro sem id',
      };
    }
    const existente = tabela.get(id);
    const ignoradas = new Set(['id', 'seq_sinc', 'atualizado_em']);

    if (existente) {
      for (const [coluna, valor] of Object.entries(op.registro)) {
        if (ignoradas.has(coluna) || coluna === 'criado_em') continue;
        existente[coluna] = valor;
      }
      existente.atualizado_em = this.proximoInstante();
      existente.seq_sinc = ++this.seq;
    } else {
      for (const obrigatoria of this.obrigatorias[op.tabela] ?? []) {
        if (op.registro[obrigatoria] === undefined || op.registro[obrigatoria] === null) {
          return {
            id_operacao: op.id_operacao,
            ok: false,
            codigo: '23502',
            mensagem: `coluna ${obrigatoria} obrigatória`,
          };
        }
      }
      if (op.tabela === 'filhos' && !this.linhas('itens').has(String(op.registro.item_id))) {
        return {
          id_operacao: op.id_operacao,
          ok: false,
          codigo: '23503',
          mensagem: 'pai inexistente',
        };
      }
      const nova: Registro = {
        id,
        excluido_em: null,
        nome: null,
        ...(op.tabela === 'itens' ? { valor: null, ativo: null, dados: null } : {}),
      };
      for (const [coluna, valor] of Object.entries(op.registro)) {
        if (!ignoradas.has(coluna)) nova[coluna] = valor;
      }
      nova.criado_em = op.registro.criado_em ?? this.proximoInstante();
      nova.atualizado_em = this.proximoInstante();
      nova.seq_sinc = ++this.seq;
      tabela.set(id, nova);
    }
    this.aplicadas.add(op.id_operacao);
    return { id_operacao: op.id_operacao, ok: true };
  }

  async enviar(operacoes: OperacaoEnvio[]): Promise<ResultadoEnvio[]> {
    this.chamadasEnvio.push(operacoes.map((o) => ({ ...o, registro: { ...o.registro } })));
    const falha = this.falhaEnvio;
    this.falhaEnvio = null;
    if (falha === 'falha-antes') throw new ErroDeRede('sem conexão');
    if (falha === 'sessao-expirada') throw new ErroDeAutenticacao('JWT expirado');

    const resultados = operacoes.map((op) => {
      if (this.aplicadas.has(op.id_operacao)) {
        return { id_operacao: op.id_operacao, ok: true, duplicada: true };
      }
      return this.aplicar(op);
    });
    if (this.aoEnviar) {
      const gancho = this.aoEnviar;
      this.aoEnviar = null;
      await gancho();
    }
    if (falha === 'falha-depois') throw new ErroDeRede('conexão caiu antes da resposta');
    return resultados;
  }

  async baixar(tabela: string, depoisDe: number, limite: number): Promise<Registro[]> {
    this.chamadasDownload.push({ tabela, depoisDe, limite });
    const falha = this.falhaDownload;
    this.falhaDownload = null;
    if (falha === 'falha-antes') throw new ErroDeRede('sem conexão');
    if (falha === 'sessao-expirada') throw new ErroDeAutenticacao('JWT expirado');
    return [...this.linhas(tabela).values()]
      .filter((l) => Number(l.seq_sinc) > depoisDe && this.visivel(tabela, l))
      .sort((a, b) => Number(a.seq_sinc) - Number(b.seq_sinc))
      .slice(0, limite)
      .map((l) => ({ ...l }));
  }
}

// ---------------------------------------------------------------------------------------------
// Um "aparelho": banco local + motor, ligados a um servidor
// ---------------------------------------------------------------------------------------------

export type Aparelho = {
  driver: DriverNode;
  motor: MotorSincronizacao;
  local: ArmazenamentoSqlite;
  ler: (tabela: string, id: string) => Promise<Registro | undefined>;
  todos: (tabela: string) => Promise<Registro[]>;
};

export async function criarAparelho(
  remoto: RemotoSincronizacao,
  opcoes: Partial<OpcoesMotor> & { relogio?: () => number } = {},
): Promise<Aparelho> {
  const driver = await criarDriverLocal();
  const geradorOperacao = criarGeradorUuidV7();
  const local = ArmazenamentoSqlite.criar(driver, { novoIdOperacao: geradorOperacao });
  const { relogio, ...resto } = opcoes;
  const motor = new MotorSincronizacao({
    local,
    remoto,
    tabelas: ['itens', 'filhos'],
    ...(relogio
      ? { agora: () => new Date(relogio()), gerarId: criarGeradorUuidV7({ agora: relogio }) }
      : {}),
    ...resto,
  });
  return {
    driver,
    motor,
    local,
    ler: async (tabela, id) =>
      (await driver.consultar(`select * from ${tabela} where id = ?`, [id]))[0],
    todos: (tabela) => driver.consultar(`select * from ${tabela} order by id`),
  };
}

/** Relógio de teste que avança 1 s a cada leitura. */
export function relogioQueAvanca(inicio = '2026-10-01T10:00:00.000Z') {
  let t = Date.parse(inicio);
  return () => {
    t += 1000;
    return t;
  };
}

/** Compara o estado visível de um aparelho com o do servidor (colunas que ambos têm). */
export async function estadoDoAparelho(aparelho: Aparelho, tabela: string) {
  const linhas = await aparelho.todos(tabela);
  return Object.fromEntries(linhas.map((l) => [String(l.id), l]));
}
