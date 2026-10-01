// uuid v7 (RFC 9562): 48 bits de milissegundos + contador de 12 bits + 62 bits aleatórios.
// Ordenável pelo tempo de criação e gerado no próprio aparelho, sem coordenar com o servidor.

export type Aleatorio = (bytes: number) => Uint8Array;

export type OpcoesUuidV7 = {
  /** Relógio em milissegundos (injetável nos testes). */
  agora?: () => number;
  /** Fonte de bytes aleatórios seguros (no app: expo-crypto). */
  aleatorio?: Aleatorio;
};

let fonteDoApp: Aleatorio | null = null;

/** O app informa a fonte de bytes seguros da plataforma (React Native não tem `crypto` global). */
export function definirFonteAleatoria(fonte: Aleatorio | null): void {
  fonteDoApp = fonte;
}

const aleatorioPadrao: Aleatorio = (bytes) => {
  if (fonteDoApp) return fonteDoApp(bytes);
  const cripto = (
    globalThis as { crypto?: { getRandomValues?: <T extends Uint8Array>(a: T) => T } }
  ).crypto;
  if (!cripto?.getRandomValues) {
    throw new Error(
      'Sem fonte de números aleatórios seguros: informe `aleatorio` ao gerar uuid v7.',
    );
  }
  return cripto.getRandomValues(new Uint8Array(bytes));
};

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Cria um gerador. Garante ordem crescente mesmo dentro do mesmo milissegundo (contador) e
 * mesmo se o relógio do aparelho voltar (usa o maior instante já visto).
 */
export function criarGeradorUuidV7({
  agora = Date.now,
  aleatorio = aleatorioPadrao,
}: OpcoesUuidV7 = {}) {
  let ultimoMs = -1;
  let contador = 0;

  return function uuidv7(): string {
    let ms = Math.max(Math.floor(agora()), ultimoMs);
    if (ms === ultimoMs) {
      contador += 1;
      if (contador > 0xfff) {
        // Mais de 4096 ids no mesmo milissegundo: pede emprestado o próximo.
        ms += 1;
        contador = 0;
      }
    } else {
      contador = 0;
    }
    ultimoMs = ms;

    const bytes = new Uint8Array(16);
    // 48 bits de tempo, big-endian (sem operadores de 32 bits, que estourariam)
    let restante = ms;
    for (let i = 5; i >= 0; i--) {
      bytes[i] = restante % 256;
      restante = Math.floor(restante / 256);
    }
    const sorteio = aleatorio(8);
    if (sorteio.length < 8) {
      throw new Error(`a fonte aleatória devolveu ${sorteio.length} bytes; eram necessários 8`);
    }
    bytes[6] = 0x70 | (contador >> 8); // versão 7 + 4 bits altos do contador
    bytes[7] = contador & 0xff;
    bytes[8] = 0x80 | ((sorteio[0] ?? 0) & 0x3f); // variante 10xx
    for (let i = 1; i < 8; i++) bytes[8 + i] = sorteio[i] ?? 0;

    const h = hex(bytes);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
}

/** Gerador padrão do app. */
export const uuidv7 = criarGeradorUuidV7();

const FORMATO = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const ehUuidV7 = (valor: unknown): valor is string =>
  typeof valor === 'string' && FORMATO.test(valor);

/** Instante (ms desde 1970) em que o id foi criado. */
export function instanteDoUuidV7(id: string): number {
  if (!ehUuidV7(id)) throw new Error(`não é um uuid v7: ${id}`);
  return Number.parseInt(id.replace(/-/g, '').slice(0, 12), 16);
}
