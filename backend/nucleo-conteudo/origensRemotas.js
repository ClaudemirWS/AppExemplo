// Origens remotas do publicador e do backend, para o nucleo rodar em Node.
//
// No PWA estas funcoes vivem em `api/urlsRemotasApi.js` e `api/clienteApi.js` e
// decidem entre proxy seguro (no navegador) e HTTP direto. Em Node nao ha CORS
// nem mixed content, entao aqui e sempre HTTP/HTTPS direto ao publicador — que e
// justamente o caminho que aquele codigo ja tomava quando `window` era undefined.
//
// Os valores vem de env com os defaults de homologacao, iguais aos do PWA.

const BASE_CONTEUDOS =
  process.env.ACERVO_BASE_CONTEUDOS || "http://conteudos.educandus.com.br";
const BASE_AULASPRE =
  process.env.ACERVO_BASE_AULASPRE || "http://aulaspre.educandus.com.br";
const BASE_BACKEND = (
  process.env.ACERVO_BASE_BACKEND || "https://backhomologa.educandus.com.br"
).replace(/\/+$/, "");

// Espelho de `urlsRemotasApi.obterBaseConteudosAulasew` no ramo HTTP direto.
export function obterBaseConteudosAulasew() {
  return `${BASE_CONTEUDOS}/aulasew/`;
}

// Espelho de `urlsRemotasApi.obterBaseRepositorioLosPre` no ramo HTTP direto.
export function obterBaseRepositorioLosPre() {
  return `${BASE_AULASPRE}/repositorioLosPre/`;
}

// Espelho de `clienteApi.montarUrlArquivo`: resolve caminho de arquivo/midia
// contra a base do backend. Usado por pacoteConteudo.js para itens de midia
// direta.
export function montarUrlArquivo(caminho) {
  return new URL(
    String(caminho || "").replace(/^\/+/, ""),
    `${BASE_BACKEND}/`
  ).toString();
}
