import {
  criarGeradorUuidV7,
  definirFonteAleatoria,
  ehUuidV7,
  instanteDoUuidV7,
  uuidv7,
} from '../uuid';

const aleatorioFixo = (byte: number) => (n: number) => new Uint8Array(n).fill(byte);

describe('uuid v7', () => {
  it('tem o formato, a versão 7 e a variante corretos', () => {
    for (let i = 0; i < 200; i++) {
      const id = uuidv7();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(ehUuidV7(id)).toBe(true);
    }
  });

  it('guarda o instante em milissegundos (acima de 2^32, sem estourar)', () => {
    const instante = Date.parse('2026-10-01T12:34:56.789Z');
    expect(instante).toBeGreaterThan(2 ** 32);
    const gerar = criarGeradorUuidV7({ agora: () => instante });
    expect(instanteDoUuidV7(gerar())).toBe(instante);
  });

  it('é ordenável pelo tempo de criação', () => {
    let t = Date.parse('2026-01-01T00:00:00Z');
    const gerar = criarGeradorUuidV7({ agora: () => (t += 5) });
    const ids = Array.from({ length: 1000 }, gerar);
    expect([...ids].sort()).toEqual(ids);
  });

  it('dentro do mesmo milissegundo continua estritamente crescente (contador)', () => {
    const gerar = criarGeradorUuidV7({
      agora: () => 1_790_000_000_000,
      aleatorio: aleatorioFixo(0),
    });
    const ids = Array.from({ length: 4000 }, gerar);
    expect(new Set(ids).size).toBe(4000);
    expect([...ids].sort()).toEqual(ids);
  });

  it('passa de 4096 ids no mesmo milissegundo sem repetir nem desordenar', () => {
    const gerar = criarGeradorUuidV7({
      agora: () => 1_790_000_000_000,
      aleatorio: aleatorioFixo(0),
    });
    const ids = Array.from({ length: 10_000 }, gerar);
    expect(new Set(ids).size).toBe(10_000);
    expect([...ids].sort()).toEqual(ids);
    // pediu emprestado os milissegundos seguintes
    expect(instanteDoUuidV7(ids[9999]!) - instanteDoUuidV7(ids[0]!)).toBeGreaterThanOrEqual(2);
  });

  it('se o relógio do aparelho voltar, os ids continuam crescendo', () => {
    const tempos = [1000, 2000, 500, 100, 3000, 2999];
    let i = 0;
    const gerar = criarGeradorUuidV7({ agora: () => tempos[i++] ?? 3000 });
    const ids = tempos.map(() => gerar());
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('100 mil ids com o relógio real são todos únicos', () => {
    const gerar = criarGeradorUuidV7();
    const ids = new Set<string>();
    for (let i = 0; i < 100_000; i++) ids.add(gerar());
    expect(ids.size).toBe(100_000);
  });

  it('dois aparelhos criando no mesmo instante não colidem', () => {
    const a = criarGeradorUuidV7({ agora: () => 1_790_000_000_000 });
    const b = criarGeradorUuidV7({ agora: () => 1_790_000_000_000 });
    const ids = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      ids.add(a());
      ids.add(b());
    }
    expect(ids.size).toBe(4000);
  });

  it('usa a fonte aleatória informada (no app: expo-crypto)', () => {
    const gerar = criarGeradorUuidV7({
      agora: () => 1_790_000_000_000,
      aleatorio: aleatorioFixo(0xab),
    });
    const id = gerar();
    // o primeiro byte do bloco final recebe os bits de variante: 0x80 | (0xab & 0x3f) = 0xab
    expect(id.slice(19, 23)).toBe('abab');
    expect(id.slice(24)).toBe('abababababab');
  });

  it('sem fonte de números aleatórios seguros, falha com mensagem clara', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    try {
      const gerar = criarGeradorUuidV7();
      expect(() => gerar()).toThrow(/números aleatórios seguros/);
    } finally {
      if (original) Object.defineProperty(globalThis, 'crypto', original);
    }
  });

  it('ehUuidV7 recusa uuid de outra versão, texto e valores que não são texto', () => {
    expect(ehUuidV7('550e8400-e29b-41d4-a716-446655440000')).toBe(false); // v4
    expect(ehUuidV7('018f0000-0000-7000-c000-000000000000')).toBe(false); // variante errada
    expect(ehUuidV7('')).toBe(false);
    expect(ehUuidV7('nao-e-uuid')).toBe(false);
    expect(ehUuidV7(null)).toBe(false);
    expect(ehUuidV7(123)).toBe(false);
    expect(ehUuidV7('018F0000-0000-7000-8000-000000000000')).toBe(false); // só minúsculas
  });

  it('instanteDoUuidV7 recusa o que não é uuid v7', () => {
    expect(() => instanteDoUuidV7('550e8400-e29b-41d4-a716-446655440000')).toThrow(
      /não é um uuid v7/,
    );
  });
});

describe('fonte aleatória do app', () => {
  it('definirFonteAleatoria vale para o gerador padrão (React Native não tem crypto global)', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    try {
      const gerar = criarGeradorUuidV7({ agora: () => 1_790_000_000_000 });
      expect(() => gerar()).toThrow(/números aleatórios seguros/);
      definirFonteAleatoria((n) => new Uint8Array(n).fill(0x11));
      expect(gerar().slice(24)).toBe('111111111111');
      definirFonteAleatoria(null);
      expect(() => criarGeradorUuidV7()()).toThrow(/números aleatórios seguros/);
    } finally {
      definirFonteAleatoria(null);
      if (original) Object.defineProperty(globalThis, 'crypto', original);
    }
  });
});
