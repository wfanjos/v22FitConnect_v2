import { criarRemotoRpc, type ChamadaRpc } from '../remoto-rpc';
import { ErroDeAutenticacao, ErroDeRede } from '../tipos';

const OP = { id_operacao: 'op-1', tabela: 'itens', registro: { id: 'a', nome: 'x' } };

const rpcQueResponde = (data: unknown) =>
  jest.fn<ReturnType<ChamadaRpc>, Parameters<ChamadaRpc>>(async () => ({ data, error: null }));

const rpcComErro = (code: string | undefined, message = 'falhou'): ChamadaRpc =>
  (async () => ({
    data: null,
    error: { ...(code !== undefined ? { code } : {}), message },
  })) as ChamadaRpc;

describe('criarRemotoRpc', () => {
  describe('enviar', () => {
    it('chama sinc_enviar com a lista de operações e devolve os resultados', async () => {
      const rpc = rpcQueResponde([{ id_operacao: 'op-1', ok: true }]);
      const resultado = await criarRemotoRpc(rpc).enviar([OP]);
      expect(rpc).toHaveBeenCalledWith('sinc_enviar', { p_operacoes: [OP] });
      expect(resultado).toEqual([{ id_operacao: 'op-1', ok: true }]);
    });

    it('resposta que não é lista vira erro de rede', async () => {
      await expect(
        criarRemotoRpc(rpcQueResponde({ ok: true })).enviar([OP]),
      ).rejects.toBeInstanceOf(ErroDeRede);
      await expect(criarRemotoRpc(rpcQueResponde(null)).enviar([OP])).rejects.toBeInstanceOf(
        ErroDeRede,
      );
    });
  });

  describe('baixar', () => {
    it('chama sinc_baixar com tabela, cursor e limite', async () => {
      const rpc = rpcQueResponde([{ id: 'a', seq_sinc: 3 }]);
      const linhas = await criarRemotoRpc(rpc).baixar('itens', 2, 50);
      expect(rpc).toHaveBeenCalledWith('sinc_baixar', {
        p_tabela: 'itens',
        p_depois_de: 2,
        p_limite: 50,
      });
      expect(linhas).toEqual([{ id: 'a', seq_sinc: 3 }]);
    });

    it('resposta que não é lista vira erro de rede', async () => {
      await expect(
        criarRemotoRpc(rpcQueResponde('x')).baixar('itens', 0, 10),
      ).rejects.toBeInstanceOf(ErroDeRede);
    });
  });

  describe('baixarTudo', () => {
    it('chama sinc_baixar_tudo com o mapa de cursores e o limite', async () => {
      const rpc = rpcQueResponde({ dados: { itens: [{ id: 'a', seq_sinc: 1 }] }, mais: ['itens'] });
      const resposta = await criarRemotoRpc(rpc).baixarTudo!({ itens: 0, filhos: 7 }, 200);
      expect(rpc).toHaveBeenCalledWith('sinc_baixar_tudo', {
        p_cursores: { itens: 0, filhos: 7 },
        p_limite: 200,
      });
      expect(resposta).toEqual({ dados: { itens: [{ id: 'a', seq_sinc: 1 }] }, mais: ['itens'] });
    });

    it('resposta vazia do servidor é válida', async () => {
      const resposta = await criarRemotoRpc(rpcQueResponde({ dados: {}, mais: [] })).baixarTudo!(
        { itens: 0 },
        10,
      );
      expect(resposta).toEqual({ dados: {}, mais: [] });
    });

    it.each([
      null,
      'texto',
      [],
      { dados: {} },
      { mais: [] },
      { dados: 'x', mais: [] },
      { dados: {}, mais: 'x' },
    ])('resposta fora do formato vira erro de rede: %j', async (data) => {
      await expect(
        criarRemotoRpc(rpcQueResponde(data)).baixarTudo!({ itens: 0 }, 10),
      ).rejects.toBeInstanceOf(ErroDeRede);
    });
  });

  describe('erros do servidor e da rede', () => {
    it.each(['28000', 'PGRST301', 'PGRST302', '401'])(
      'código %s é falta de autenticação',
      async (codigo) => {
        const remoto = criarRemotoRpc(rpcComErro(codigo, 'JWT expirado'));
        await expect(remoto.enviar([OP])).rejects.toBeInstanceOf(ErroDeAutenticacao);
        await expect(remoto.baixar('itens', 0, 10)).rejects.toBeInstanceOf(ErroDeAutenticacao);
        await expect(remoto.baixarTudo!({ itens: 0 }, 10)).rejects.toBeInstanceOf(
          ErroDeAutenticacao,
        );
      },
    );

    it('outros códigos viram erro de rede, com o código na mensagem', async () => {
      const remoto = criarRemotoRpc(rpcComErro('57014', 'tempo esgotado'));
      await expect(remoto.enviar([OP])).rejects.toThrow(/57014: tempo esgotado/);
      await expect(remoto.enviar([OP])).rejects.toBeInstanceOf(ErroDeRede);
    });

    it('erro sem código (queda de conexão do cliente) vira erro de rede', async () => {
      const remoto = criarRemotoRpc(rpcComErro(undefined, 'Failed to fetch'));
      await expect(remoto.baixar('itens', 0, 10)).rejects.toThrow('Failed to fetch');
      await expect(remoto.baixar('itens', 0, 10)).rejects.toBeInstanceOf(ErroDeRede);
    });

    it('se a própria chamada lançar exceção, vira erro de rede', async () => {
      const rpc: ChamadaRpc = async () => {
        throw new TypeError('Network request failed');
      };
      await expect(criarRemotoRpc(rpc).enviar([OP])).rejects.toBeInstanceOf(ErroDeRede);
      await expect(criarRemotoRpc(rpc).baixarTudo!({ itens: 0 }, 10)).rejects.toThrow(
        'Network request failed',
      );
    });
  });
});
