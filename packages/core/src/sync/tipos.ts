/** Linha de uma tabela sincronizada: pode ser completa (vinda do servidor) ou parcial (só o que mudou). */
export type Registro = Record<string, unknown>;

export type OperacaoEnvio = { id_operacao: string; tabela: string; registro: Registro };

export type ResultadoEnvio = {
  id_operacao: string;
  ok: boolean;
  /** O servidor já tinha aplicado esta operação (reenvio após falha de rede). */
  duplicada?: boolean;
  /** SQLSTATE do Postgres quando `ok` é falso (ex.: 42501 = RLS recusou). */
  codigo?: string;
  mensagem?: string;
};

/** O lado do servidor (Supabase). `sinc_enviar` e `sinc_baixar` em supabase/migrations. */
export interface RemotoSincronizacao {
  /** Lança ErroDeRede / ErroDeAutenticacao quando a chamada inteira falha. */
  enviar(operacoes: OperacaoEnvio[]): Promise<ResultadoEnvio[]>;
  baixar(tabela: string, depoisDe: number, limite: number): Promise<Registro[]>;
  /**
   * Opcional: baixa várias tabelas numa chamada só (menos requisições e menos tráfego).
   * `cursores` = último seq_sinc recebido de cada tabela. O motor usa quando existe.
   */
  baixarTudo?(cursores: Record<string, number>, limite: number): Promise<RespostaBaixarTudo>;
}

export type RespostaBaixarTudo = {
  /** Só as tabelas com novidade. */
  dados: Record<string, Registro[]>;
  /** Tabelas que podem ter mais linhas: perguntar de novo só por elas. */
  mais: string[];
};

/** Sem conexão ou falha do servidor: nada foi perdido, tenta de novo depois. */
export class ErroDeRede extends Error {
  override name = 'ErroDeRede';
}

/** Sessão ausente ou expirada: precisa entrar de novo. */
export class ErroDeAutenticacao extends Error {
  override name = 'ErroDeAutenticacao';
}

/** Alteração local ainda não confirmada pelo servidor. */
export type ItemFila = {
  tabela: string;
  registroId: string;
  idOperacao: string;
  /** Só as colunas alteradas desde o último envio (campo a campo). */
  carga: Registro;
  tentativas: number;
};

export type ItemFalha = ItemFila & { codigo: string | null; mensagem: string | null };

export type ResultadoTentativa = {
  codigo: string | null;
  mensagem: string | null;
  /** Falha definitiva: sai do envio automático e fica à vista para decisão. */
  permanente: boolean;
  /** Soma na contagem de tentativas? (falha de chave estrangeira por causa de outro item não soma) */
  contar: boolean;
};

/** O que o motor precisa do banco local (SQLite). */
export interface ArmazenamentoLocal {
  /** Agrupa operações de forma atômica; dentro dela use o `tx` recebido. */
  transacao<T>(fn: (tx: ArmazenamentoLocal) => Promise<T>): Promise<T>;

  lerCursor(tabela: string): Promise<number>;
  /** Nunca diminui o cursor. */
  gravarCursor(tabela: string, cursor: number): Promise<void>;
  reiniciarCursor(tabela: string): Promise<void>;

  ler(tabela: string, id: string): Promise<Registro | null>;
  /** Grava no aparelho e enfileira o envio. Cria a linha se não existir; senão muda só as colunas dadas. */
  gravar(tabela: string, registro: Registro, agora: string): Promise<void>;
  /** Aplica uma linha vinda do servidor, sem enfileirar. Devolve se mudou algo. */
  aplicarRemoto(tabela: string, registro: Registro): Promise<boolean>;

  listarFila(): Promise<ItemFila[]>;
  removerDaFila(tabela: string, registroId: string, idOperacao: string): Promise<boolean>;
  registrarTentativa(
    tabela: string,
    registroId: string,
    idOperacao: string,
    resultado: ResultadoTentativa,
  ): Promise<void>;

  listarFalhas(): Promise<ItemFalha[]>;
  /** Volta as falhas definitivas para o envio automático. */
  reenfileirarFalhas(): Promise<number>;
  /** Abandona uma alteração local que o servidor recusou. */
  descartarFalha(tabela: string, registroId: string): Promise<boolean>;
}
