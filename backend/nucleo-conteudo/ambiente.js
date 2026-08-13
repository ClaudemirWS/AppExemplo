// Ambiente do nucleo em Node.
//
// `usandoNativo` continua falso (nunca houve caminho Capacitor aqui). As bases
// que no PWA vinham de `window.location.origin` agora sao injetaveis; sem
// injecao, ficam vazias e os ramos que dependiam delas (servidor de conteudo
// local, main.js do modelo classico) simplesmente nao disparam — o que e o
// comportamento correto num downloader que so espelha o publicador.

export const usandoNativo = () => false;

let baseServidorConteudoLocal = "";

// Chamado pelo host (servidor/CLI) se algum dia precisar servir vendor local.
// No downloader normal fica vazio.
export function definirBaseServidorConteudoLocal(base) {
  baseServidorConteudoLocal = String(base || "");
}

export function obterBaseServidorConteudoLocal() {
  return baseServidorConteudoLocal;
}
