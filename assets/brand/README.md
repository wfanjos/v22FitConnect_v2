# V22 Fit Connect — Identidade visual

Todos os arquivos são PNG 1024×1024.

| Arquivo | Conteúdo | Uso sugerido |
|---|---|---|
| `logo-completo-fundo-escuro.png` | Águia + "V22 FITCONNECT", fundo azul-marinho | Splash screen / tema escuro |
| `logo-completo-fundo-claro.png` | Águia + "V22 FITCONNECT", fundo creme | Tema claro, materiais |
| `simbolo-aguia-vermelho.png` | Só a águia, com brilho, fundo cinza | Ícone / marca reduzida |
| `v22-claro.png` | "V22" creme, fundo cinza | Marca textual |
| `v22-escuro.png` | "V22" azul-marinho, fundo cinza | Marca textual |

## Cores (aproximadas, amostradas das imagens)

| Cor | Hex |
|---|---|
| Vermelho (águia) | `#911B28` (fundo escuro) / `#B02731` (fundo claro) |
| Azul-marinho | `#092144` (texto) / `#060E1C` (fundo) |
| Creme | `#F6EDDB` (fundo) / `#D9D3C3` (texto) |

> Os hex acima foram medidos nos PNGs e podem variar alguns tons. Se existir a paleta oficial, substitua aqui.

## Versões vetorizadas e transparentes

Geradas a partir de `logo-completo-fundo-claro.png`: fundo removido por cor e contornos vetorizados. É uma aproximação do desenho original. Olhando bem de perto, as bordas podem ter pequenas ondulações herdadas do PNG.

### `svg/` — vetores (escalam sem perder qualidade)

| Arquivo | Cores |
|---|---|
| `simbolo-aguia.svg` | águia `#AF2530` (para fundo claro) |
| `simbolo-aguia-escuro.svg` | águia `#901A27` (tom da versão de fundo escuro) |
| `logo-completo-texto-azul.svg` | águia `#AF2530` + texto `#072444` (para fundo claro) |
| `logo-completo-texto-creme.svg` | águia `#901A27` + texto `#D9D3C3` (para fundo escuro) |
| `v22-azul.svg` / `v22-creme.svg` | só "V22" |

O "V22" solto foi tirado do texto do logo completo, não dos arquivos com brilho.

### `transparente/` — PNG com fundo transparente (~2048 px)

Mesmos nomes e cores dos SVGs (sem a águia escura avulsa).

### `expo/` — prontos para o app

| Arquivo | Tamanho | Uso no `app.json` |
|---|---|---|
| `icon.png` | 1024×1024, **sem transparência** (a App Store exige) | `expo.icon`: águia sobre `#040C19` |
| `adaptive-icon.png` | 1024×1024, transparente | `android.adaptiveIcon.foregroundImage`: águia dentro da zona segura; use `backgroundColor: "#040C19"` |
| `splash-icon.png` | 1024×1024, transparente | plugin `expo-splash-screen`: logo completo creme; use fundo `#040C19` |
| `favicon.png` | 196×196, transparente | `web.favicon` / painel admin |

## Cores das versões transparentes

- Fundo claro: vermelho `#AF2530`, azul `#072444`
- Fundo escuro: vermelho `#901A27`, creme `#D9D3C3`, fundo `#040C19`
