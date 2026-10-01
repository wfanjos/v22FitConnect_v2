// Memória no lugar do SQLite: as preferências (src/preferences.ts) leem/gravam via kv-store.
jest.mock('expo-sqlite/kv-store', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItemSync: (key: string) => store.get(key) ?? null,
      setItemSync: (key: string, value: string) => void store.set(key, value),
      __clear: () => store.clear(),
    },
  };
});
