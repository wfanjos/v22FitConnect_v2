const mockExecAsync = jest.fn(async (_sql: string) => undefined);
const mockRunAsync = jest.fn(async (..._args: unknown[]) => ({ changes: 0, lastInsertRowId: 0 }));
const mockWithExclusiveTransactionAsync = jest.fn(
  async (
    tarefa: (txn: { runAsync: typeof mockRunAsync; getAllAsync: jest.Mock }) => Promise<void>,
  ) => {
    await tarefa({ runAsync: mockRunAsync, getAllAsync: jest.fn(async () => []) });
  },
);
const mockOpenDatabaseAsync = jest.fn(async (_nome: string) => ({
  execAsync: mockExecAsync,
  runAsync: mockRunAsync,
  getAllAsync: jest.fn(async () => []),
  withExclusiveTransactionAsync: mockWithExclusiveTransactionAsync,
}));

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: (nome: string) => mockOpenDatabaseAsync(nome),
}));
jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(n).fill(7) }));

// Os mocks acima precisam existir antes dos imports abaixo.
/* eslint-disable import/first */
import { uuidv7 } from '@v22/core';

import { abrirBancoLocal, nomeDoBancoLocal } from '..';
/* eslint-enable import/first */

const ANA = '018f0000-0000-7000-8000-00000000000a';
const BRUNO = '018F0000-0000-7000-8000-00000000000B';

beforeEach(() => jest.clearAllMocks());

describe('nomeDoBancoLocal', () => {
  it('cada usuário tem o seu arquivo', () => {
    expect(nomeDoBancoLocal(ANA)).toBe(`v22-${ANA}.db`);
    expect(nomeDoBancoLocal(BRUNO)).toBe('v22-018f0000-0000-7000-8000-00000000000b.db');
    expect(nomeDoBancoLocal(ANA)).not.toBe(nomeDoBancoLocal(BRUNO));
  });

  it.each([
    '',
    'ana',
    '../../etc/passwd',
    `${ANA}/../x`,
    `${ANA}.db`,
    'x'.repeat(36),
    `'; drop table x; --`,
  ])('recusa id que não é uuid: %j', (id) => {
    expect(() => nomeDoBancoLocal(id)).toThrow(/usuarioId inválido/);
  });
});

describe('abrirBancoLocal', () => {
  it('abre o arquivo do usuário, liga WAL e busy_timeout e prepara as tabelas de controle', async () => {
    await abrirBancoLocal(ANA);
    expect(mockOpenDatabaseAsync).toHaveBeenCalledWith(`v22-${ANA}.db`);
    expect(mockExecAsync).toHaveBeenCalledTimes(1);
    const pragmas = mockExecAsync.mock.calls[0]![0];
    expect(pragmas).toMatch(/journal_mode = WAL/);
    expect(pragmas).toMatch(/busy_timeout = 5000/);
    const sqls = mockRunAsync.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes('sinc_estado'))).toBe(true);
    expect(sqls.some((s) => s.includes('sinc_fila'))).toBe(true);
  });

  it('usuários diferentes abrem arquivos diferentes', async () => {
    await abrirBancoLocal(ANA);
    await abrirBancoLocal(BRUNO);
    expect(mockOpenDatabaseAsync.mock.calls.map((c) => c[0])).toEqual([
      `v22-${ANA}.db`,
      'v22-018f0000-0000-7000-8000-00000000000b.db',
    ]);
  });

  it('com id inválido nem chega a abrir o banco', async () => {
    await expect(abrirBancoLocal('../x')).rejects.toThrow(/usuarioId inválido/);
    expect(mockOpenDatabaseAsync).not.toHaveBeenCalled();
  });
});

describe('uuid v7 no celular', () => {
  it('importar o módulo de sincronização liga a fonte aleatória do expo-crypto', () => {
    const id = uuidv7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(id.slice(24)).toBe('070707070707'); // bytes 0x07 vindos do mock de expo-crypto
  });
});
