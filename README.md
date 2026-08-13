# acervo-educandus

Downloader de acervo do AVA para **uso interno**. Lista o catalogo de Aulas e Jogos
exatamente como o aluno ve no PWA (mesmos filtros, mesma contagem), permite selecionar
conteudos ou paginas isoladas, baixa **no mesmo formato de pacote do PWA APP-Estudante**
e publica no Cloudflare R2.

Reproduz o contrato honesto da API do AVA — nao usa nenhum truque para extrair alem do
que a listagem normal entrega. So Administrador Educandus (role 1) acessa.

## Dois projetos, lado a lado

O acervo tem **frontend** e **backend** SEPARADOS, cada um com seu `package.json` e suas
dependencias. Eles rodam **em paralelo, cada um no seu terminal** — o front conversa com
o back pelo proxy `/api`.

```
acervo-educandus/
├── backend/     Express (login, catalogo, fila de download, acervo, R2) + CLI
│   ├── servidor/          rotas Express + logica de sessao/fila
│   ├── nucleo-conteudo/   nucleo de download (copia do PWA, adaptada p/ Node)
│   ├── adaptadores/       fsAcervo.js — persistencia em disco (o PWA usa Cache API)
│   ├── scripts/           CLI: baixar, verificar-updates, exportar-r2
│   ├── r2/                utilitarios e testes do bucket R2
│   ├── certificados/      cadeia TLS do backhomologa (ver abaixo)
│   ├── acervo/            pacotes baixados (ignorado no git)
│   └── .env               credenciais (ignorado no git; ver .env.example)
└── frontend/    Vite + React (telas de login, catalogo, acervo)
    └── web/               index.html + src/
```

Por que separados: o backend e um servidor Express de estado (sessao em memoria, fila de
download SSE, escrita em disco, credenciais); o frontend e so a interface. Misturar os
dois num `package.json` so confundia. Agora cada lado e um projeto autonomo.

## Rodar (dois terminais)

**Terminal 1 — backend** (Express em :3100):

```powershell
cd backend
npm install        # primeira vez
npm run dev        # com --watch (reinicia ao editar); use `npm start` para downloads longos
```

**Terminal 2 — frontend** (Vite em :5173, com proxy /api -> :3100):

```powershell
cd frontend
npm install        # primeira vez
npm run dev
```

Abra http://localhost:5173. O front **precisa** do backend rodando — sozinho ele nao faz
nada (login, catalogo e download passam todos pelo Express).

### CLI (sem abrir o front)

Da pasta `backend/`:

```powershell
npm run baixar -- --id <ID> --usuario <user> --senha <senha>
npm run verificar-updates
npm run exportar -- --r2
```

### Testes do backend

```powershell
cd backend
npm test           # autorizacao + indisponiveis + disciplinas (node:assert, sem framework)
```

## Componentes suportados

Matematica e Lingua Portuguesa (uma ou outra por vez, no seletor "Componente").
Matematica cobre tambem a Educacao Infantil (campo BNCC ETQRT); Portugues por ora so o
Fundamental. Acrescentar disciplina = uma linha em `backend/servidor/disciplinaMatematica.js`.

## Certificado do backhomologa

O servidor `backhomologa.educandus.com.br` serve a cadeia de certificado **incompleta**
(so a folha, sem o intermediario GlobalSign). O navegador disfarca buscando o
intermediario sozinho; o Node NAO faz isso e recusa com `UNABLE_TO_VERIFY_LEAF_SIGNATURE`.

Como o Express e quem fala com o backhomologa, isso vale para o CLI e para o front.
Solucao: o intermediario oficial (`backend/certificados/gsgccr6-alphassl-2025.pem`) e
fornecido ao Node via `NODE_EXTRA_CA_CERTS`, ja embutido nos scripts do
`backend/package.json`. A verificacao TLS continua LIGADA — so completamos a cadeia que o
servidor deveria ter servido. Se um dia ele servir `fullchain`, o certificado pode sair.

## Decisoes

- **Frontend e backend separados** (13/08/2026): dois `package.json`, rodam em paralelo.
  Antes era um projeto so — confundia, porque nao ficava claro que havia servidor.
- **Copia isolada, nao nucleo compartilhado.** O `nucleo-conteudo/` foi copiado do PWA,
  nao referenciado. Evita tocar no PWA, ao custo de divergencia: uma correcao de formato
  feita la nao chega aqui sozinha (precisa replicar a mao).
- **Formato tecnico so e conhecido apos o download.** O backend do AVA so distingue HTML5
  de Flash (campo `converted`); o motor (Construct 2/3, Animate, html-educandus) sai do
  `detectarFormato` no download e vai pro indice do acervo.
- **Duas versoes = dois IDs.** O nome nunca diferencia conteudos; a identidade e o ID.
- **Acesso so admin Educandus (role 1).** O login recusa qualquer outro papel.
- **Credencial nunca fica no codigo.** Login por usuario/senha em runtime; `.env` fora do git.
