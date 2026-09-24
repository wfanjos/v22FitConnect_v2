# Mascote V22 — Harpia: ficha e prompts

Base: versão com kimono de jiu-jitsu (a preferida). Nova skin: academia carioca, sem kimono.
Ferramenta sugerida: app Gemini (gemini.google.com), geração de imagem grátis com limite diário. O Google AI Studio passou a exigir plano pago/API para vários modelos no Playground (bloqueou em set/2026). Sempre anexar a imagem de referência.

## Imagens de referência aprovadas

Pasta: [`assets/brand/mascote/`](../../assets/brand/mascote/)

| Arquivo | Conteúdo |
|---|---|
| `harpia-carioca-aprovada.jpg` | Skin carioca aprovada: calçadão, barra, regata cavada, toalha vermelha (imagem 1 dos prompts) |
| `harpia-ficha-referencia.jpg` | Ficha frente/perfil/costas, fundo branco (imagem 2 dos prompts) |

Pendências conhecidas da ficha: rabo inconsistente entre as vistas (perfil com penas finas, costas em leque) e regata menos cavada que a aprovada. Corrigir via texto em cada prompt de pose.

## Prompt de pose (anexar as duas imagens de referência)

```
Image 1 is the approved character. Image 2 is his turnaround sheet (use it for body proportions and all angles).
Create a new image of this SAME character: identical face, crest, beak, eyes, feathers, stocky proportions, outfit and 3D animated style.

Outfit details to keep: off-white tank top with deep, wide armholes cut low on the sides; navy shorts with a deep-red stripe on both sides; red towel on one shoulder; navy wristbands. Tail: a short fan of dark-gray feathers behind the legs (not long thin spikes).

POSE: (trocar pelas variações abaixo)

SETTING: same Rio de Janeiro seaside promenade as image 1 at golden hour: black-and-white wave-pattern mosaic sidewalk, blurred sea and mountains in the background, warm orange and soft purple sky. Shallow depth of field.

COMPOSITION: full body visible from crest to talons, centered, vertical 2:3 format.

AVOID: any text, letters, numbers or logos; changing his proportions; making him taller or slimmer; long spiky tail; extra fingers or limbs; distorted beak.
```

## Variações de pose (trocar só o bloco POSE)

- **Recorde pessoal:** celebrating a personal record. One arm raised high in victory, holding a heavy black iron weight plate overhead; the other hand in a strong fist at chest height. Crest feathers fully raised. Proud, confident open-beak smile, looking at the viewer. Slight low camera angle to make him look powerful.
- **Descanso:** sitting on a wooden bench, towel on shoulder, looking at a large stopwatch in his hand, relaxed smile.
- **Professor:** holding a clipboard in one hand and pointing forward with the other, whistle on a red cord around the neck, encouraging expression.
- **Barra:** doing a pull-up on the bar, chin above the bar, determined face.
- **Série vencida:** pointing at a large paper wall calendar with a surprised raised eyebrow.
- **Offline:** holding a smartphone up high looking for signal, puzzled expression.
- **Lista vazia:** standing next to an empty barbell on the ground, shrugging with a friendly "let's start?" smile.

## Prompt original da skin carioca (a partir da imagem do jiu-jitsu)

```
Use the attached image as the character reference. Keep the SAME character: identical head shape, crest, face, eyes, beak, feather colors, body proportions and 3D style. Change ONLY the outfit and the setting.

CHARACTER (do not change):
- Anthropomorphic harpy eagle (Harpia harpyja) mascot, stylized 3D animated feature-film look, soft fluffy feather texture, subsurface lighting.
- Head: rounded, covered in soft light-gray feathers with subtle darker gray scalloped pattern; tall crest of 6–8 long gray feathers rising straight up and slightly back from the top of the head. NO ear tufts, NOT an owl.
- Face: light-gray; heavy furrowed brow; large eyes with pale cream iris, big black pupil and a small white highlight; confident, slightly smug half-smile.
- Beak: large, strongly hooked, dark charcoal gray, matte.
- Body: stocky, muscular, broad chest and shoulders, short legs; chest feathers medium gray with scalloped pattern.
- Arms: wing-arms fully covered in dark-gray feathers ending in feathered hands with fingers.
- Legs and feet: dark-gray scaly legs, three front toes and one back toe, curved glossy black talons. Legs are gray, NOT yellow.
- Tail: dark-gray tail feathers visible behind the legs.

OUTFIT — Rio de Janeiro beach-gym style:
- Off-white (#D9D3C3) sleeveless muscle tank with deep armholes (regata cavada), soft cotton, plain, no text.
- Navy blue (#072444) mid-thigh board-short style training shorts, lightweight tactel fabric, with one thin deep-red (#AF2530) stripe down each side.
- Small plain deep-red (#AF2530) towel draped over one shoulder.
- Navy wristbands on both wrists. No shoes (bare talons). No hat, no sunglasses, no jewelry, no kimono, no belt.

POSE: standing confident, three-quarter view, one hand resting on a steel pull-up bar at chest height, the other hand in a relaxed fist at the side, chest out, looking at the viewer.

SETTING: outdoor beach workout station on the Rio de Janeiro seaside promenade at golden hour; black-and-white wave-pattern mosaic sidewalk under the feet; blurred sea, sand and mountains in the background; warm orange and soft purple sky. Shallow depth of field, background soft and blurred, character sharp.

COMPOSITION: full body visible from crest to talons, centered, vertical 2:3 format, character fills about 80% of the height.

AVOID: any text, letters, numbers or logos anywhere; ear tufts; owl features; yellow legs; human hair; extra fingers or toes; extra limbs; distorted beak; realistic photo style; cluttered background.
```

## Fluxo recomendado

1. Anexar as duas imagens de referência aprovadas.
2. Colar o prompt de pose trocando só o bloco POSE.
3. Logo e texto "V22" adicionados depois em editor, não pela IA.
