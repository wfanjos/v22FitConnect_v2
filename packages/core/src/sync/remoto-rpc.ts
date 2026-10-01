import {
  ErroDeAutenticacao,
  ErroDeRede,
  type OperacaoEnvio,
  type Registro,
  type RemotoSincronizacao,
  type RespostaBaixarTudo,
  type ResultadoEnvio,
} from './tipos';

/** Formato de `supabase.rpc(nome, args)`. */
export type ChamadaRpc = (
  funcao: string,
  argumentos: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;

const CODIGOS_DE_AUTENTICACAO = new Set(['28000', 'PGRST301', '401', 'PGRST302']);

async function chamar(rpc: ChamadaRpc, funcao: string, argumentos: Record<string, unknown>) {
  let resposta;
  try {
    resposta = await rpc(funcao, argumentos);
  } catch (e) {
    throw new ErroDeRede(e instanceof Error ? e.message : String(e));
  }
  if (resposta.error) {
    const { code, message } = resposta.error;
    if (code && CODIGOS_DE_AUTENTICACAO.has(code)) throw new ErroDeAutenticacao(message);
    throw new ErroDeRede(code ? `${code}: ${message}` : message);
  }
  return resposta.data;
}

/** Liga o motor às funções `sinc_enviar` e `sinc_baixar` do Supabase. */
export function criarRemotoRpc(rpc: ChamadaRpc): RemotoSincronizacao {
  return {
    async enviar(operacoes: OperacaoEnvio[]): Promise<ResultadoEnvio[]> {
      const dados = await chamar(rpc, 'sinc_enviar', { p_operacoes: operacoes });
      if (!Array.isArray(dados)) throw new ErroDeRede('resposta inesperada de sinc_enviar');
      return dados as ResultadoEnvio[];
    },
    async baixar(tabela: string, depoisDe: number, limite: number): Promise<Registro[]> {
      const dados = await chamar(rpc, 'sinc_baixar', {
        p_tabela: tabela,
        p_depois_de: depoisDe,
        p_limite: limite,
      });
      if (!Array.isArray(dados)) throw new ErroDeRede('resposta inesperada de sinc_baixar');
      return dados as Registro[];
    },
    async baixarTudo(
      cursores: Record<string, number>,
      limite: number,
    ): Promise<RespostaBaixarTudo> {
      const dados = await chamar(rpc, 'sinc_baixar_tudo', {
        p_cursores: cursores,
        p_limite: limite,
      });
      const resposta = dados as Partial<RespostaBaixarTudo> | null;
      if (!resposta || typeof resposta.dados !== 'object' || !Array.isArray(resposta.mais)) {
        throw new ErroDeRede('resposta inesperada de sinc_baixar_tudo');
      }
      return { dados: resposta.dados ?? {}, mais: resposta.mais };
    },
  };
}
