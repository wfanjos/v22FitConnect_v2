// Só para o Jest: compila TypeScript e converte ESM para CommonJS.
module.exports = {
  presets: [['@babel/preset-env', { targets: { node: 'current' } }], '@babel/preset-typescript'],
};
