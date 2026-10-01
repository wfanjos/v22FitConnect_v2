import { uuidv7 } from '../uuid';
import {
  ErroDeAutenticacao,
  type ArmazenamentoLocal,
  type ItemFalha,
  type Registro,
  type RemotoSincronizacao,
  type ResultadoEnvio,
} from './tipos';

export type OpcoesMotor = {
  local: ArmazenamentoLocal;
  remoto: RemotoSincronizacao;
  /** Tabelas sincronizadas, na ordem em que devem ser baixadas (pais antes dos filhos). */
  tabelas: readonly string[];
  /** Operações por chamada de envio. */
  tamanhoLote?: number;
  /** Linhas por página no download (o servidor limita a 1000). */
  limitePagina?: number;
  /**
   * Margem de segurança no download: pede de novo os últimos números antes do cursor, porque uma
   * gravação com número menor pode ser confirmada no servidor depois de uma com número maior.
   */
  sobreposicao?: number;
  /** Depois de tantas tentativas com erro passageiro, a alteração vira falha definitiva. */
  maxTentativas?: number;
  agora?: () => Date;
  gerarId?: () => string;
};

export type RelatorioSincronizacao = {
  enviadas: number;
  duplicadas: number;
  falhasDefinitivas: number;
  adiadas: number;
  baixadas: number;
  erro?: 'rede' | 'autenticacao';
  mensagemErro?: string;
};

export type EstadoSincronizacao = {
  pendentes: number;
  falhas: ItemFalha[];
  cursores: Record<string, number>;
};

type Classe = 'definitivo' | 'passageiro' | 'autenticacao';

/**
 * Decide o que fazer com um erro devolvido pelo servidor para uma operação.
 * - definitivo: RLS, dado inválido, restrição do banco... reenviar não adianta.
 * - passageiro: instabilidade; tenta de novo depois.
 * - autenticacao: sessão expirada; para tudo até entrar de novo.
 */
export function classificarErro(codigo: string | undefined | null): Classe {
  if (!codigo) return 'passageiro';
  if (codigo === '28000' || codigo === 'PGRST301' || codigo === '401') return 'autenticacao';
  // Chave estrangeira: o registro pai pode estar a caminho num lote seguinte.
  if (codigo === '23503') return 'passageiro';
  const grupo = codigo.slice(0, 2);
  if (['22', '23', '42', 'P0', '44'].includes(grupo)) return 'definitivo';
  return 'passageiro';
}

const relatorioVazio = (): RelatorioSincronizacao => ({
  enviadas: 0,
  duplicadas: 0,
  falhasDefinitivas: 0,
  adiadas: 0,
  baixadas: 0,
});

export class MotorSincronizacao {
  private readonly local: ArmazenamentoLocal;
  private readonly remoto: RemotoSincronizacao;
  private readonly tabelas: readonly string[];
  private readonly tamanhoLote: number;
  private readonly limitePagina: number;
  private readonly sobreposicao: number;
  private readonly maxTentativas: number;
  private readonly agora: () => Date;
  private readonly gerarId: () => string;

  private emAndamento: Promise<RelatorioSincronizacao> | null = null;
  private repetir = false;

  constructor(opcoes: OpcoesMotor) {
    this.local = opcoes.local;
    this.remoto = opcoes.remoto;
    this.tabelas = opcoes.tabelas;
    this.tamanhoLote = opcoes.tamanhoLote ?? 100;
    this.limitePagina = Math.min(opcoes.limitePagina ?? 500, 1000);
    // O servidor só entrega linhas "frias" (janela segura), então o cursor não precisa de margem.
    this.sobreposicao = opcoes.sobreposicao ?? 0;
    this.maxTentativas = opcoes.maxTentativas ?? 5;
    this.agora = opcoes.agora ?? (() => new Date());
    this.gerarId = opcoes.gerarId ?? uuidv7;
    if (this.tamanhoLote < 1) throw new Error('tamanhoLote precisa ser pelo menos 1');
    // O servidor recusa lotes com mais de 200 operações.
    if (this.tamanhoLote > 200) throw new Error('tamanhoLote não pode passar de 200');
    if (this.limitePagina < 1) throw new Error('limitePagina precisa ser pelo menos 1');
  }

  // --- Gravações do app (vão para o aparelho e para a fila de envio) ---------------------

  /** Cria um registro com id novo (uuid v7). Devolve o id. */
  async criar(tabela: string, dados: Registro): Promise<string> {
    const registroId = this.gerarId();
    await this.local.gravar(tabela, { ...dados, id: registroId }, this.agora().toISOString());
    return registroId;
  }

  /** Muda só as colunas informadas de um registro que já existe no aparelho. */
  async atualizar(tabela: string, registroId: string, dados: Registro): Promise<void> {
    await this.local.transacao(async (tx) => {
      if (!(await tx.ler(tabela, registroId))) {
        throw new Error(`atualizar: ${tabela}/${registroId} não existe no aparelho`);
      }
      await tx.gravar(tabela, { ...dados, id: registroId }, this.agora().toISOString());
    });
  }

  /** Exclusão lógica: marca `excluido_em` e a exclusão chega aos outros aparelhos. */
  async excluir(tabela: string, registroId: string): Promise<void> {
    const agora = this.agora().toISOString();
    await this.local.transacao(async (tx) => {
      if (!(await tx.ler(tabela, registroId))) {
        throw new Error(`excluir: ${tabela}/${registroId} não existe no aparelho`);
      }
      await tx.gravar(tabela, { id: registroId, excluido_em: agora }, agora);
    });
  }

  // --- Sincronização -----------------------------------------------------------------------

  /**
   * Envia o que está pendente e baixa as novidades. Chamadas simultâneas se juntam numa só
   * execução; se algo foi gravado durante ela, roda mais uma rodada ao final.
   */
  sincronizar(): Promise<RelatorioSincronizacao> {
    if (this.emAndamento) {
      this.repetir = true;
      return this.emAndamento;
    }
    const execucao = this.executar().finally(() => {
      this.emAndamento = null;
      this.repetir = false;
    });
    this.emAndamento = execucao;
    return execucao;
  }

  private async executar(): Promise<RelatorioSincronizacao> {
    const total = relatorioVazio();
    for (let rodada = 0; rodada < 3; rodada++) {
      this.repetir = false;
      const envio = await this.enviarPendentes();
      this.somar(total, envio);
      if (envio.erro) return this.comErro(total, envio);

      const baixado = await this.baixarNovidades();
      this.somar(total, baixado);
      if (baixado.erro) return this.comErro(total, baixado);

      if (!this.repetir) break;
    }
    return total;
  }

  private somar(total: RelatorioSincronizacao, parcial: RelatorioSincronizacao) {
    total.enviadas += parcial.enviadas;
    total.duplicadas += parcial.duplicadas;
    total.falhasDefinitivas += parcial.falhasDefinitivas;
    total.adiadas += parcial.adiadas;
    total.baixadas += parcial.baixadas;
  }

  private comErro(
    total: RelatorioSincronizacao,
    parcial: RelatorioSincronizacao,
  ): RelatorioSincronizacao {
    const resultado: RelatorioSincronizacao = { ...total };
    if (parcial.erro) resultado.erro = parcial.erro;
    if (parcial.mensagemErro !== undefined) resultado.mensagemErro = parcial.mensagemErro;
    return resultado;
  }

  /** Envia a fila em lotes, na ordem em que as alterações foram feitas. */
  async enviarPendentes(): Promise<RelatorioSincronizacao> {
    const relatorio = relatorioVazio();
    const fila = await this.local.listarFila();
    let houveFalhaAntes = false;

    for (let inicio = 0; inicio < fila.length; inicio += this.tamanhoLote) {
      const lote = fila.slice(inicio, inicio + this.tamanhoLote);
      let resultados: ResultadoEnvio[];
      try {
        resultados = await this.remoto.enviar(
          lote.map((i) => ({ id_operacao: i.idOperacao, tabela: i.tabela, registro: i.carga })),
        );
      } catch (e) {
        relatorio.erro = e instanceof ErroDeAutenticacao ? 'autenticacao' : 'rede';
        relatorio.mensagemErro = e instanceof Error ? e.message : String(e);
        return relatorio;
      }

      // As confirmações do lote entram numa transação só (e não disputam o banco com o app).
      const porId = new Map(resultados.map((r) => [r.id_operacao, r]));
      const parar = await this.local.transacao(async (tx) => {
        for (const item of lote) {
          const resultado = porId.get(item.idOperacao);
          if (resultado?.ok) {
            await tx.removerDaFila(item.tabela, item.registroId, item.idOperacao);
            if (resultado.duplicada) relatorio.duplicadas += 1;
            else relatorio.enviadas += 1;
            continue;
          }

          const classe = resultado ? classificarErro(resultado.codigo) : 'passageiro';
          if (classe === 'autenticacao') {
            relatorio.erro = 'autenticacao';
            relatorio.mensagemErro = resultado?.mensagem ?? 'sessão expirada';
            return true;
          }

          // Falha de chave estrangeira logo depois de outra falha costuma ser consequência dela:
          // não gasta tentativa do item.
          const consequencia = resultado?.codigo === '23503' && houveFalhaAntes;
          const tentativasDepois = item.tentativas + (consequencia ? 0 : 1);
          const definitiva = classe === 'definitivo' || tentativasDepois >= this.maxTentativas;
          await tx.registrarTentativa(item.tabela, item.registroId, item.idOperacao, {
            codigo: resultado?.codigo ?? null,
            mensagem: resultado?.mensagem ?? 'sem resposta do servidor para esta operação',
            permanente: definitiva,
            contar: !consequencia,
          });
          houveFalhaAntes = true;
          if (definitiva) relatorio.falhasDefinitivas += 1;
          else relatorio.adiadas += 1;
        }
        return false;
      });
      if (parar) return relatorio;
    }
    return relatorio;
  }

  private erroDeTransporte(relatorio: RelatorioSincronizacao, e: unknown): RelatorioSincronizacao {
    relatorio.erro = e instanceof ErroDeAutenticacao ? 'autenticacao' : 'rede';
    relatorio.mensagemErro = e instanceof Error ? e.message : String(e);
    return relatorio;
  }

  /**
   * Aplica uma página de uma tabela. As linhas e o cursor entram juntos na mesma transação:
   * nunca fica um sem o outro. Devolve quantas linhas mudaram e o maior seq_sinc visto.
   */
  private async aplicarPagina(
    tabela: string,
    linhas: Registro[],
    depoisDe: number,
  ): Promise<{ aplicadas: number; ultimo: number }> {
    const validas = linhas.filter(
      (l) => typeof l.id === 'string' && l.id !== '' && Number.isFinite(Number(l.seq_sinc)),
    );
    const ultimo = validas.reduce((maior, l) => Math.max(maior, Number(l.seq_sinc)), depoisDe);
    const aplicadas = await this.local.transacao(async (tx) => {
      let n = 0;
      for (const linha of validas) if (await tx.aplicarRemoto(tabela, linha)) n += 1;
      if (ultimo > 0) await tx.gravarCursor(tabela, ultimo);
      return n;
    });
    return { aplicadas, ultimo };
  }

  /**
   * Baixa tudo que tem `seq_sinc` maior que o último recebido, de todas as tabelas.
   * Usa uma única chamada para todas as tabelas quando o servidor oferece (`baixarTudo`):
   * sem novidade, é uma requisição minúscula por sincronização, em vez de uma por tabela.
   */
  async baixarNovidades(): Promise<RelatorioSincronizacao> {
    const baixarTudo = this.remoto.baixarTudo?.bind(this.remoto);
    return baixarTudo ? this.baixarJunto(baixarTudo) : this.baixarTabelaPorTabela();
  }

  private async baixarJunto(
    baixarTudo: NonNullable<RemotoSincronizacao['baixarTudo']>,
  ): Promise<RelatorioSincronizacao> {
    const relatorio = relatorioVazio();
    let pendentes = [...this.tabelas];

    // Cada rodada pede só as tabelas que ainda podem ter mais linhas.
    for (let rodada = 0; rodada < 100 && pendentes.length > 0; rodada++) {
      const inicios: Record<string, number> = {};
      for (const tabela of pendentes) {
        inicios[tabela] = Math.max((await this.local.lerCursor(tabela)) - this.sobreposicao, 0);
      }

      let resposta;
      try {
        resposta = await baixarTudo(inicios, this.limitePagina);
      } catch (e) {
        return this.erroDeTransporte(relatorio, e);
      }
      const mais = new Set(resposta.mais);

      const seguintes: string[] = [];
      for (const tabela of pendentes) {
        const linhas = resposta.dados[tabela] ?? [];
        const inicio = inicios[tabela] ?? 0;
        let progrediu = false;
        if (linhas.length > 0) {
          const { aplicadas, ultimo } = await this.aplicarPagina(tabela, linhas, inicio);
          relatorio.baixadas += aplicadas;
          progrediu = ultimo > inicio;
        }
        // Na lista "mais" sem nenhuma linha = o servidor nem chegou nessa tabela (limite da chamada).
        // Com linhas mas sem avanço do cursor = servidor preso: desiste para não girar em falso.
        if (mais.has(tabela) && (linhas.length === 0 || progrediu)) seguintes.push(tabela);
      }
      pendentes = seguintes;
    }
    return relatorio;
  }

  private async baixarTabelaPorTabela(): Promise<RelatorioSincronizacao> {
    const relatorio = relatorioVazio();

    for (const tabela of this.tabelas) {
      const cursorSalvo = await this.local.lerCursor(tabela);
      let depoisDe = Math.max(cursorSalvo - this.sobreposicao, 0);

      for (;;) {
        let linhas: Registro[];
        try {
          linhas = await this.remoto.baixar(tabela, depoisDe, this.limitePagina);
        } catch (e) {
          return this.erroDeTransporte(relatorio, e);
        }
        if (linhas.length === 0) break;

        const { aplicadas, ultimo } = await this.aplicarPagina(tabela, linhas, depoisDe);
        relatorio.baixadas += aplicadas;

        if (linhas.length < this.limitePagina) break;
        if (ultimo <= depoisDe) break; // proteção contra laço infinito
        depoisDe = ultimo;
      }
    }
    return relatorio;
  }

  // --- Estado e manutenção -----------------------------------------------------------------

  async estado(): Promise<EstadoSincronizacao> {
    const [fila, falhas] = await Promise.all([this.local.listarFila(), this.local.listarFalhas()]);
    const cursores: Record<string, number> = {};
    for (const tabela of this.tabelas) cursores[tabela] = await this.local.lerCursor(tabela);
    return { pendentes: fila.length, falhas, cursores };
  }

  /**
   * Baixa tudo de novo (uma tabela ou todas). Use quando o aparelho passa a poder ler registros
   * antigos que não lia antes (ex.: novo vínculo com professor).
   */
  async baixarTudoDeNovo(tabela?: string): Promise<void> {
    for (const t of tabela ? [tabela] : this.tabelas) await this.local.reiniciarCursor(t);
  }

  reenfileirarFalhas(): Promise<number> {
    return this.local.reenfileirarFalhas();
  }

  descartarFalha(tabela: string, registroId: string): Promise<boolean> {
    return this.local.descartarFalha(tabela, registroId);
  }
}
