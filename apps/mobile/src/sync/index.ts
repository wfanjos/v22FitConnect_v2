import {
  ArmazenamentoSqlite,
  MotorSincronizacao,
  criarGeradorUuidV7,
  criarRemotoRpc,
  definirFonteAleatoria,
  prepararSincronizacaoLocal,
  type ChamadaRpc,
  type DriverSqlite,
} from '@v22/core';
import { getRandomBytes } from 'expo-crypto';
import { openDatabaseAsync } from 'expo-sqlite';

import { criarDriverExpo } from './driver-expo';

// React Native não tem `crypto` global: os ids uuid v7 usam o gerador seguro do expo-crypto.
definirFonteAleatoria(getRandomBytes);

const ID_DE_USUARIO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cada usuário tem o próprio arquivo de banco: dados, cursor e fila de envio nunca se misturam
 * quando duas pessoas entram no mesmo aparelho (a fila de uma nunca é enviada pela sessão da outra).
 */
export function nomeDoBancoLocal(usuarioId: string): string {
  if (!ID_DE_USUARIO.test(usuarioId))
    throw new Error('usuarioId inválido para abrir o banco local');
  return `v22-${usuarioId.toLowerCase()}.db`;
}

/** Abre o banco local do usuário (SQLite) e prepara as tabelas de controle da sincronização. */
export async function abrirBancoLocal(usuarioId: string): Promise<DriverSqlite> {
  const db = await openDatabaseAsync(nomeDoBancoLocal(usuarioId));
  // WAL: necessário para as transações exclusivas conviverem com leituras do app.
  // busy_timeout: se outra conexão estiver gravando, espera um pouco em vez de falhar na hora.
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  const driver = criarDriverExpo(db);
  await prepararSincronizacaoLocal(driver);
  return driver;
}

/**
 * Monta o motor de sincronização.
 * `rpc` é o `supabase.rpc` do cliente autenticado; `tabelas` na ordem pais → filhos.
 * As tabelas de negócio (e as migrations locais delas) chegam com cada fase.
 */
export function criarMotorDoApp(opcoes: {
  driver: DriverSqlite;
  rpc: ChamadaRpc;
  tabelas: readonly string[];
}): MotorSincronizacao {
  const local = ArmazenamentoSqlite.criar(opcoes.driver, { novoIdOperacao: criarGeradorUuidV7() });
  return new MotorSincronizacao({
    local,
    remoto: criarRemotoRpc(opcoes.rpc),
    tabelas: opcoes.tabelas,
  });
}
