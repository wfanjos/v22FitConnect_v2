import type {
  ArmazenamentoLocal,
  ItemFalha,
  ItemFila,
  Registro,
  ResultadoTentativa,
} from './tipos';

export type ValorSql = string | number | null;

export interface ExecutorSqlite {
  executar(sql: string, parametros?: ValorSql[]): Promise<void>;
  consultar<T = Record<string, unknown>>(sql: string, parametros?: ValorSql[]): Promise<T[]>;
}

/** Banco SQLite do aparelho. No app: expo-sqlite. Nos testes: node:sqlite. */
export interface DriverSqlite extends ExecutorSqlite {
  /** Transação exclusiva: outras gravações esperam. */
  transacao<T>(fn: (tx: ExecutorSqlite) => Promise<T>): Promise<T>;
}

const IDENTIFICADOR = /^[a-z_][a-z0-9_]*$/;

function id(nome: string): string {
  if (!IDENTIFICADOR.test(nome)) throw new Error(`nome inválido para tabela ou coluna: ${nome}`);
  return `"${nome}"`;
}

/** JSON do servidor → valor que o SQLite aceita (booleano vira 0/1, objeto/lista vira texto JSON). */
export function paraSqlite(valor: unknown): ValorSql {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'boolean') return valor ? 1 : 0;
  if (typeof valor === 'number' || typeof valor === 'string') return valor;
  return JSON.stringify(valor);
}

export const SCHEMA_SINCRONIZACAO = [
  `create table if not exists sinc_estado (
     tabela text primary key,
     cursor integer not null default 0
   )`,
  `create table if not exists sinc_fila (
     tabela text not null,
     registro_id text not null,
     id_operacao text not null,
     ordem integer not null,
     carga text not null,
     tentativas integer not null default 0,
     falha integer not null default 0,
     ultimo_codigo text,
     ultimo_erro text,
     primary key (tabela, registro_id)
   )`,
  `create index if not exists ix_sinc_fila_ordem on sinc_fila (falha, ordem)`,
];

/** Cria as tabelas de controle da sincronização no banco local (idempotente). */
export async function prepararSincronizacaoLocal(driver: DriverSqlite): Promise<void> {
  await driver.transacao(async (tx) => {
    for (const sql of SCHEMA_SINCRONIZACAO) await tx.executar(sql);
  });
}

type LinhaFila = {
  tabela: string;
  registro_id: string;
  id_operacao: string;
  carga: string;
  tentativas: number;
  ultimo_codigo?: string | null;
  ultimo_erro?: string | null;
};

const paraItem = (l: LinhaFila): ItemFila => ({
  tabela: l.tabela,
  registroId: l.registro_id,
  idOperacao: l.id_operacao,
  carga: JSON.parse(l.carga) as Registro,
  tentativas: Number(l.tentativas),
});

export type OpcoesArmazenamento = {
  /** Gera o id de cada operação enfileirada (uuid v7). */
  novoIdOperacao: () => string;
};

export class ArmazenamentoSqlite implements ArmazenamentoLocal {
  constructor(
    private readonly executor: ExecutorSqlite,
    private readonly opcoes: OpcoesArmazenamento,
    private readonly driver: DriverSqlite | null = null,
    // Colunas de cada tabela local (PRAGMA table_info), compartilhado entre transações.
    private readonly colunasPorTabela: Map<string, Set<string>> = new Map(),
  ) {}

  static criar(driver: DriverSqlite, opcoes: OpcoesArmazenamento): ArmazenamentoSqlite {
    return new ArmazenamentoSqlite(driver, opcoes, driver);
  }

  async transacao<T>(fn: (tx: ArmazenamentoLocal) => Promise<T>): Promise<T> {
    // Já dentro de uma transação: reaproveita.
    if (!this.driver) return fn(this);
    return this.driver.transacao((executor) =>
      fn(new ArmazenamentoSqlite(executor, this.opcoes, null, this.colunasPorTabela)),
    );
  }

  async lerCursor(tabela: string): Promise<number> {
    const linhas = await this.executor.consultar<{ cursor: number }>(
      'select cursor from sinc_estado where tabela = ?',
      [tabela],
    );
    return Number(linhas[0]?.cursor ?? 0);
  }

  async gravarCursor(tabela: string, cursor: number): Promise<void> {
    await this.executor.executar(
      `insert into sinc_estado (tabela, cursor) values (?, ?)
       on conflict (tabela) do update set cursor = max(cursor, excluded.cursor)`,
      [tabela, cursor],
    );
  }

  async reiniciarCursor(tabela: string): Promise<void> {
    await this.executor.executar(
      `insert into sinc_estado (tabela, cursor) values (?, 0)
       on conflict (tabela) do update set cursor = 0`,
      [tabela],
    );
  }

  async ler(tabela: string, registroId: string): Promise<Registro | null> {
    const linhas = await this.executor.consultar<Registro>(
      `select * from ${id(tabela)} where id = ?`,
      [registroId],
    );
    return linhas[0] ?? null;
  }

  gravar(tabela: string, registro: Registro, agora: string): Promise<void> {
    return this.transacao(async (tx) => {
      await (tx as ArmazenamentoSqlite).gravarDentroDaTransacao(tabela, registro, agora);
    });
  }

  private async gravarDentroDaTransacao(
    tabela: string,
    registro: Registro,
    agora: string,
  ): Promise<void> {
    const registroId = registro.id;
    if (typeof registroId !== 'string' || registroId === '') {
      throw new Error('gravar: o registro precisa de um id');
    }
    const existente = await this.ler(tabela, registroId);
    let carga: Registro;

    if (!existente) {
      carga = { ...registro, criado_em: registro.criado_em ?? agora };
      const local: Registro = { ...carga, atualizado_em: registro.atualizado_em ?? agora };
      delete local.seq_sinc;
      const colunas = Object.keys(local);
      await this.executor.executar(
        `insert into ${id(tabela)} (${colunas.map(id).join(', ')})
         values (${colunas.map(() => '?').join(', ')})`,
        colunas.map((c) => paraSqlite(local[c])),
      );
    } else {
      carga = { ...registro };
      const alteradas = Object.keys(carga).filter(
        (c) => !['id', 'criado_em', 'seq_sinc', 'atualizado_em'].includes(c),
      );
      const atribuicoes = [...alteradas.map((c) => `${id(c)} = ?`), `"atualizado_em" = ?`];
      await this.executor.executar(
        `update ${id(tabela)} set ${atribuicoes.join(', ')} where id = ?`,
        [...alteradas.map((c) => paraSqlite(carga[c])), agora, registroId],
      );
    }

    // O servidor define atualizado_em e seq_sinc; o aparelho nunca os envia.
    delete carga.atualizado_em;
    delete carga.seq_sinc;
    await this.enfileirar(tabela, registroId, carga);
  }

  private async enfileirar(tabela: string, registroId: string, carga: Registro): Promise<void> {
    const atual = await this.executor.consultar<{ carga: string }>(
      'select carga from sinc_fila where tabela = ? and registro_id = ?',
      [tabela, registroId],
    );
    const idOperacao = this.opcoes.novoIdOperacao();
    if (atual[0]) {
      // Várias edições do mesmo registro viram uma só: o que mudou desde o último envio.
      const unida = { ...(JSON.parse(atual[0].carga) as Registro), ...carga };
      await this.executor.executar(
        `update sinc_fila set carga = ?, id_operacao = ?, tentativas = 0, falha = 0,
           ultimo_codigo = null, ultimo_erro = null
         where tabela = ? and registro_id = ?`,
        [JSON.stringify(unida), idOperacao, tabela, registroId],
      );
      return;
    }
    const proxima = await this.executor.consultar<{ proxima: number }>(
      'select coalesce(max(ordem), 0) + 1 as proxima from sinc_fila',
    );
    await this.executor.executar(
      `insert into sinc_fila (tabela, registro_id, id_operacao, ordem, carga)
       values (?, ?, ?, ?, ?)`,
      [tabela, registroId, idOperacao, Number(proxima[0]?.proxima ?? 1), JSON.stringify(carga)],
    );
  }

  aplicarRemoto(tabela: string, registro: Registro): Promise<boolean> {
    return this.transacao(async (tx) =>
      (tx as ArmazenamentoSqlite).aplicarRemotoDentroDaTransacao(tabela, registro),
    );
  }

  private async aplicarRemotoDentroDaTransacao(
    tabela: string,
    registro: Registro,
  ): Promise<boolean> {
    const registroId = registro.id;
    if (typeof registroId !== 'string' || registroId === '') return false;

    // Coluna que o servidor tem e este app ainda não (servidor mais novo que o app) é ignorada;
    // sem isso a sincronização da tabela travaria para sempre num app desatualizado.
    const existentes = await this.colunasDaTabela(tabela);
    registro = Object.fromEntries(Object.entries(registro).filter(([c]) => existentes.has(c)));
    if (typeof registro.id !== 'string') return false;

    // Colunas com alteração local ainda não enviada ficam como estão: elas vão vencer no servidor.
    const pendente = await this.executor.consultar<{ carga: string }>(
      'select carga from sinc_fila where tabela = ? and registro_id = ?',
      [tabela, registroId],
    );
    const protegidas = new Set(pendente[0] ? Object.keys(JSON.parse(pendente[0].carga)) : []);
    const colunas = Object.keys(registro).filter((c) => c === 'id' || !protegidas.has(c));
    const atualizaveis = colunas.filter((c) => c !== 'id');

    const antes = await this.executor.consultar<{ seq_sinc: number | null }>(
      `select seq_sinc from ${id(tabela)} where id = ?`,
      [registroId],
    );
    const seqRemoto = Number(registro.seq_sinc ?? 0);
    const seqLocal = antes[0]?.seq_sinc;
    if (seqLocal !== null && seqLocal !== undefined && Number(seqLocal) >= seqRemoto) {
      return false; // já tínhamos esta versão (ou uma mais nova)
    }

    const marcadores = colunas.map(() => '?').join(', ');
    const atribuicoes = atualizaveis.map((c) => `${id(c)} = excluded.${id(c)}`).join(', ');
    await this.executor.executar(
      `insert into ${id(tabela)} (${colunas.map(id).join(', ')}) values (${marcadores})
       on conflict (id) do update set ${atribuicoes || '"id" = excluded."id"'}`,
      colunas.map((c) => paraSqlite(registro[c])),
    );
    return true;
  }

  private async colunasDaTabela(tabela: string): Promise<Set<string>> {
    const guardadas = this.colunasPorTabela.get(tabela);
    if (guardadas) return guardadas;
    const linhas = await this.executor.consultar<{ name: string }>(
      `pragma table_info(${id(tabela)})`,
    );
    if (linhas.length === 0) throw new Error(`a tabela local ${tabela} não existe`);
    const colunas = new Set(linhas.map((l) => l.name));
    this.colunasPorTabela.set(tabela, colunas);
    return colunas;
  }

  async listarFila(): Promise<ItemFila[]> {
    const linhas = await this.executor.consultar<LinhaFila>(
      'select * from sinc_fila where falha = 0 order by ordem',
    );
    return linhas.map(paraItem);
  }

  async removerDaFila(tabela: string, registroId: string, idOperacao: string): Promise<boolean> {
    // Só remove se ninguém editou o registro enquanto o envio estava no ar.
    const antes = await this.executor.consultar<{ n: number }>(
      'select count(*) as n from sinc_fila where tabela = ? and registro_id = ? and id_operacao = ?',
      [tabela, registroId, idOperacao],
    );
    if (Number(antes[0]?.n ?? 0) === 0) return false;
    await this.executor.executar(
      'delete from sinc_fila where tabela = ? and registro_id = ? and id_operacao = ?',
      [tabela, registroId, idOperacao],
    );
    return true;
  }

  async registrarTentativa(
    tabela: string,
    registroId: string,
    idOperacao: string,
    resultado: ResultadoTentativa,
  ): Promise<void> {
    await this.executor.executar(
      `update sinc_fila set tentativas = tentativas + ?, falha = ?, ultimo_codigo = ?, ultimo_erro = ?
       where tabela = ? and registro_id = ? and id_operacao = ?`,
      [
        resultado.contar ? 1 : 0,
        resultado.permanente ? 1 : 0,
        resultado.codigo,
        resultado.mensagem,
        tabela,
        registroId,
        idOperacao,
      ],
    );
  }

  async listarFalhas(): Promise<ItemFalha[]> {
    const linhas = await this.executor.consultar<LinhaFila>(
      'select * from sinc_fila where falha = 1 order by ordem',
    );
    return linhas.map((l) => ({
      ...paraItem(l),
      codigo: l.ultimo_codigo ?? null,
      mensagem: l.ultimo_erro ?? null,
    }));
  }

  async reenfileirarFalhas(): Promise<number> {
    const antes = await this.executor.consultar<{ n: number }>(
      'select count(*) as n from sinc_fila where falha = 1',
    );
    await this.executor.executar('update sinc_fila set falha = 0, tentativas = 0 where falha = 1');
    return Number(antes[0]?.n ?? 0);
  }

  async descartarFalha(tabela: string, registroId: string): Promise<boolean> {
    return this.transacao(async (tx) => {
      const self = tx as ArmazenamentoSqlite;
      const antes = await self.executor.consultar<{ n: number }>(
        'select count(*) as n from sinc_fila where tabela = ? and registro_id = ? and falha = 1',
        [tabela, registroId],
      );
      if (Number(antes[0]?.n ?? 0) === 0) return false;
      await self.executor.executar(
        'delete from sinc_fila where tabela = ? and registro_id = ? and falha = 1',
        [tabela, registroId],
      );

      // A linha local ainda mostra o valor que o servidor recusou. Volta ao que o servidor tem:
      // se ela nunca chegou ao servidor, some; se já existia lá, é baixada de novo.
      const linha = await self.executor.consultar<{ seq_sinc: number | null }>(
        `select seq_sinc from ${id(tabela)} where id = ?`,
        [registroId],
      );
      if (linha[0]) {
        if (linha[0].seq_sinc === null) {
          await self.executor.executar(`delete from ${id(tabela)} where id = ?`, [registroId]);
        } else {
          await self.executor.executar(`update ${id(tabela)} set seq_sinc = 0 where id = ?`, [
            registroId,
          ]);
          await self.reiniciarCursor(tabela);
        }
      }
      return true;
    });
  }
}
