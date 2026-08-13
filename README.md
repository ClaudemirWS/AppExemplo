# backend-acervo

Downloader de acervo do AVA para **uso pessoal**. Lista o catalogo de Aulas
exatamente como o aluno ve no PWA (mesmos filtros, mesma contagem), permite
selecionar conteudos ou paginas isoladas, e baixa para `acervo/` **no mesmo
formato de pacote do PWA APP-Estudante**.

Nao e compartilhado nem publicado. Reproduz o contrato honesto da API do AVA — nao
usa nenhum truque para extrair alem do que a listagem normal entrega.

## Stack

- Node 24 (ESM)
- Express 5 (servidor: login, catalogo, fila de download, acervo)
- Vite 8 + React 19 (front)
- Nucleo de download copiado de `APP-Estudante/frontend/src/offline/conteudoOffline`
  (decisao: copia isolada, ver mais abaixo)

## Estrutura

```
nucleo-conteudo/   copia do downloader do PWA, adaptada para Node
adaptadores/       fsAcervo.js — persistencia em disco (o PWA usa Cache API)
servidor/          Express
web/               front Vite + React
scripts/           baixar.js — CLI para baixar um conteudo por ID
acervo/            pacotes baixados (ignorado no git)
```

## Rodar

```powershell
npm install
npm run dev        # sobe servidor (:3100) e front (:5173) juntos
```

CLI de download (o proprio usuario roda com sua credencial):

```powershell
npm run baixar -- --id <ID> --usuario <user> --senha <senha>
```

## Certificado do backhomologa

O servidor `backhomologa.educandus.com.br` serve a cadeia de certificado
**incompleta** (so a folha, sem o intermediario GlobalSign) — defeito ja
registrado no SPEC 4.1.1 do PWA. O navegador disfarca isso buscando o
intermediario sozinho; o Node NAO faz isso e recusa a conexao com
`UNABLE_TO_VERIFY_LEAF_SIGNATURE`.

Como o servidor Express e quem fala com o backhomologa (o navegador so fala com
o nosso servidor local), isso vale tanto para o CLI quanto para o front.

Solucao: o intermediario oficial da GlobalSign
(`certificados/gsgccr6-alphassl-2025.pem`, baixado da URL AIA do proprio
certificado) e fornecido ao Node via `NODE_EXTRA_CA_CERTS`, ja embutido nos
scripts do package.json. A verificacao TLS continua LIGADA e real — apenas
completamos a cadeia que o servidor deveria ter servido. Nada de desligar
seguranca.

Se um dia o backhomologa passar a servir `fullchain.pem`, isso deixa de ser
necessario e o certificado pode sair.

## Decisoes

- **Copia isolada, nao nucleo compartilhado.** O downloader do PWA foi copiado, nao
  referenciado. Isso evita tocar no PWA, ao custo de divergencia: uma correcao de
  formato feita la nao chega aqui sozinha.
- **Formato tecnico so e conhecido apos o download.** O backend do AVA nao guarda
  se um conteudo e Construct 2/3 ou Animate — so distingue HTML5 de Flash (campo
  `converted`). A listagem mostra "desconhecido" para o motor ate o conteudo ser
  baixado; no download o `detectarFormato` identifica e grava no indice do acervo.
- **Duas versoes = dois IDs.** Alguns conteudos tem versao antiga e nova no AVA,
  com IDs distintos. Ambos aparecem na listagem, como o aluno ve. O nome nunca
  diferencia conteudos; a identidade e o ID.
- **Escopo travado em Matematica**, como o PWA.
- **Credencial nunca fica no codigo.** Login por usuario/senha em runtime.
