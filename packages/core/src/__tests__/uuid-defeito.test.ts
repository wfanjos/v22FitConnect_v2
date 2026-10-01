import { criarGeradorUuidV7 } from '../uuid';

describe('fonte aleatória com defeito', () => {
  it('se devolver menos bytes do que o pedido, falha em vez de completar com zeros', () => {
    const gerar = criarGeradorUuidV7({
      agora: () => 1_790_000_000_000,
      aleatorio: () => new Uint8Array(3),
    });
    expect(() => gerar()).toThrow(/devolveu 3 bytes; eram necessários 8/);
  });
});
