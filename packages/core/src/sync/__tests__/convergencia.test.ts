import { criarAparelho, relogioQueAvanca, RemotoFalso, type Aparelho } from './helpers';

// Gerador pseudoaleatório com semente: se um cenário falhar, dá para repeti-lo igual.
function mulberry32(semente: number) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Falha = 'falha-antes' | 'falha-depois' | 'sessao-expirada';

async function cenario(semente: number, aparelhos: number, passos: number) {
  const sorte = mulberry32(semente);
  const escolher = <T>(lista: readonly T[]): T => lista[Math.floor(sorte() * lista.length)]!;

  const servidor = new RemotoFalso();
  const todos: Aparelho[] = [];
  for (let i = 0; i < aparelhos; i++) {
    todos.push(
      await criarAparelho(servidor, {
        relogio: relogioQueAvanca(`2026-10-01T${String(8 + i).padStart(2, '0')}:00:00Z`),
        tamanhoLote: 1 + Math.floor(sorte() * 6),
        limitePagina: 1 + Math.floor(sorte() * 8),
        maxTentativas: 1000, // este teste não quer falhas definitivas
      }),
    );
  }

  const falhas: Array<Falha | null> = [
    null,
    null,
    null,
    'falha-antes',
    'falha-depois',
    'sessao-expirada',
  ];

  for (let passo = 0; passo < passos; passo++) {
    const ap = escolher(todos);
    const acao = sorte();

    if (acao < 0.3) {
      await ap.motor.criar('itens', { dono_id: 'ana', nome: `n${passo}`, valor: passo });
    } else if (acao < 0.45) {
      // Filho só de um pai que este aparelho já tem (criado nele ou baixado), como no app.
      const pais = (await ap.todos('itens')).filter((l) => l.excluido_em === null);
      if (pais.length) {
        await ap.motor.criar('filhos', {
          item_id: escolher(pais).id,
          dono_id: 'ana',
          nome: `f${passo}`,
        });
      }
    } else if (acao < 0.7) {
      const existentes = (await ap.todos('itens')).filter((l) => l.excluido_em === null);
      if (existentes.length) {
        const alvo = escolher(existentes).id as string;
        const coluna = escolher(['nome', 'valor'] as const);
        await ap.motor.atualizar(
          'itens',
          alvo,
          coluna === 'nome' ? { nome: `e${passo}` } : { valor: passo },
        );
      }
    } else if (acao < 0.77) {
      const existentes = (await ap.todos('itens')).filter((l) => l.excluido_em === null);
      if (existentes.length) await ap.motor.excluir('itens', escolher(existentes).id as string);
    } else {
      servidor.falhaEnvio = escolher(falhas);
      servidor.falhaDownload = sorte() < 0.2 ? escolher(falhas) : null;
      await ap.motor.sincronizar();
      servidor.falhaEnvio = null;
      servidor.falhaDownload = null;
    }
  }

  // Rede boa para todos, até assentar.
  servidor.falhaEnvio = null;
  servidor.falhaDownload = null;
  for (let rodada = 0; rodada < 4; rodada++) {
    for (const ap of todos) {
      const r = await ap.motor.sincronizar();
      if (r.erro) throw new Error(`rede boa mas deu erro: ${r.erro} ${r.mensagemErro}`);
    }
  }
  return { servidor, todos };
}

const COLUNAS_ITENS = ['id', 'dono_id', 'nome', 'valor', 'excluido_em'] as const;
const COLUNAS_FILHOS = ['id', 'item_id', 'dono_id', 'nome', 'excluido_em'] as const;

const recorte = (linha: Record<string, unknown> | undefined, colunas: readonly string[]) =>
  linha ? Object.fromEntries(colunas.map((c) => [c, linha[c] ?? null])) : undefined;

describe('convergência com operações aleatórias e falhas de rede', () => {
  const sementes = Array.from({ length: 25 }, (_, i) => i + 1);

  it.each(sementes)(
    'semente %i: todos os aparelhos terminam iguais ao servidor, sem perder nada',
    async (semente) => {
      const { servidor, todos } = await cenario(semente, 3, 120);

      for (const [tabela, colunas] of [
        ['itens', COLUNAS_ITENS],
        ['filhos', COLUNAS_FILHOS],
      ] as const) {
        const noServidor = Object.fromEntries(
          [...servidor.linhas(tabela).values()].map((l) => [String(l.id), recorte(l, colunas)]),
        );
        for (const ap of todos) {
          const local = Object.fromEntries(
            (await ap.todos(tabela)).map((l) => [String(l.id), recorte(l, colunas)]),
          );
          expect(local).toEqual(noServidor);
        }
      }

      for (const ap of todos) {
        const estado = await ap.motor.estado();
        expect(estado.pendentes).toBe(0);
        expect(estado.falhas).toEqual([]);
      }
    },
  );

  it('seqüência cresce no servidor e os cursores dos aparelhos chegam ao máximo', async () => {
    const { servidor, todos } = await cenario(99, 3, 150);
    const maximo = Math.max(
      0,
      ...[...servidor.linhas('itens').values()].map((l) => Number(l.seq_sinc)),
    );
    for (const ap of todos) {
      expect((await ap.motor.estado()).cursores.itens).toBe(maximo);
    }
  });

  it('5 aparelhos e 300 passos', async () => {
    const { servidor, todos } = await cenario(2026, 5, 300);
    const noServidor = Object.fromEntries(
      [...servidor.linhas('itens').values()].map((l) => [String(l.id), recorte(l, COLUNAS_ITENS)]),
    );
    for (const ap of todos) {
      const local = Object.fromEntries(
        (await ap.todos('itens')).map((l) => [String(l.id), recorte(l, COLUNAS_ITENS)]),
      );
      expect(local).toEqual(noServidor);
    }
  });
});
