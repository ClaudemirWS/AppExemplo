# R2 — hospedagem dos pacotes da pré-carga

Object storage (Cloudflare R2) que serve os zips das aulas + o manifesto ao PWA.
Para o PWA é **leitura pura**: prateleira estática com CORS (só GET), sem
credencial do aluno. O **downloader** agora **escreve** aqui direto (ver abaixo).

## Passo a passo no painel (só o usuário faz)

1. `dash.cloudflare.com` → menu **R2**.
2. Ativar R2 (exige cartão cadastrado mesmo no free; 10 GB grátis, banda de saída
   não é cobrada).
3. **Create bucket** → nome `acervo-educandus` (ou outro).
4. **Tornar público:** aba Settings do bucket → **Public access** → habilitar o
   `r2.dev` público (ou ligar um domínio próprio depois). Isso dá a URL base
   `https://pub-XXXX.r2.dev/`.
5. **CORS:** aba Settings → **CORS policy** → colar o conteúdo de `cors.json`
   (libera localhost e a Vercel para GET/HEAD).

## Testar (depois que o bucket tiver 1 arquivo e o CORS aplicado)

Suba um `teste.txt` qualquer pelo painel e rode:

```
node r2/testar-r2.mjs https://pub-XXXX.r2.dev/teste.txt http://localhost:5173
```

Confirma que o download funciona E que o CORS libera a origem do PWA. Se o
preflight não trouxer `Access-Control-Allow-Origin` com a origem, o fetch do PWA
seria bloqueado — ajustar a CORS policy antes de seguir.

## Upload automático pelo downloader (escrita server-side)

Antes o upload era manual (arrastar no painel). Agora, com as variáveis `R2_*` no
`.env` (ver `.env.example`), o **download escreve direto no bucket**: sobe o
`<ID>.zip` e regenera+sobe o `manifesto.json` a cada conteúdo. A aba **Acervo** do
downloader passa a **ler do bucket** (via `manifesto.json`), não do disco. Sem as
`R2_*`, tudo cai no disco local (fallback) — nada quebra.

- **Credencial:** crie um **API token R2 com escrita** (R2 → Manage API Tokens) e
  preencha `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.
  A Secret dá poder de apagar/sobrescrever — trate como segredo (o `.env` já está no
  `.gitignore`).
- **CORS:** a escrita é server-side (o Express local), então **não passa por CORS** —
  o `cors.json` continua só com `GET`, para o PWA (navegador) ler. Não adicione `PUT`.
- **Código:** `servidor/r2Cliente.js` (SDK `@aws-sdk/client-s3`). Migrados nesta
  rodada: download, aba Acervo, DELETE e o botão "estrutura de LOs". **Ainda no disco
  (2ª rodada):** `POST /reindexar` e `scripts/verificar-updates.mjs`.

## Fluxo antigo (exportador manual)

`scripts/exportar-r2.mjs` ainda gera o `manifesto.json` local a partir dos zips do
disco — útil se você tiver um acervo local e quiser reconstruir o manifesto à mão.
Com o upload automático acima, não é mais o caminho principal.
