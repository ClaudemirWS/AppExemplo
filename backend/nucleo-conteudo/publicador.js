import { obterBaseConteudosAulasew, obterBaseRepositorioLosPre } from "./origensRemotas.js";
import { resolverUrl } from "./caminhos.js";
import { baixarTexto } from "./httpConteudo.js";

const TTL_CACHE_VERSAO_MS = 5 * 60 * 1000;
const cacheUltimaVersaoPorLo = new Map();
const promessasUltimaVersaoPorLo = new Map();

export function montarUrlAulasew(caminho) {
  return resolverUrl(obterBaseConteudosAulasew(), String(caminho || "").replace(/^\/+/, ""));
}

function agoraMs() {
  return Date.now();
}

function lerCacheVersao(id) {
  const entrada = cacheUltimaVersaoPorLo.get(id);

  if (!entrada) {
    return undefined;
  }

  if (entrada.expiraEm <= agoraMs()) {
    cacheUltimaVersaoPorLo.delete(id);
    return undefined;
  }

  return entrada.valor;
}

function salvarCacheVersao(id, valor) {
  cacheUltimaVersaoPorLo.set(id, {
    valor,
    expiraEm: agoraMs() + TTL_CACHE_VERSAO_MS
  });
}

export function limparCachePublicador() {
  cacheUltimaVersaoPorLo.clear();
  promessasUltimaVersaoPorLo.clear();
}

export async function obterUltimaVersaoLo(externalId) {
  const id = String(externalId || "").trim();

  if (!id) {
    return null;
  }

  const valorEmCache = lerCacheVersao(id);
  if (valorEmCache !== undefined) {
    return valorEmCache;
  }

  if (promessasUltimaVersaoPorLo.has(id)) {
    return promessasUltimaVersaoPorLo.get(id);
  }

  const promessa = (async () => {
    const urlVersoes = `${obterBaseRepositorioLosPre()}${encodeURIComponent(id)}/versoes/`;
    const html = (await baixarTexto(urlVersoes)).texto;
    const versoes = Array.from(html.matchAll(new RegExp(`${id}_v(\\d+)/`, "g")))
      .map(match => Number(match[1]))
      .filter(Number.isFinite)
      .sort((a, b) => b - a);

    if (!versoes.length) {
      salvarCacheVersao(id, null);
      return null;
    }

    const pasta = `${id}_v${versoes[0]}`;
    const resultado = {
      externalId: id,
      versao: pasta,
      url: `${urlVersoes}${pasta}/`
    };

    salvarCacheVersao(id, resultado);
    return resultado;
  })();

  promessasUltimaVersaoPorLo.set(id, promessa);

  try {
    return await promessa;
  } finally {
    promessasUltimaVersaoPorLo.delete(id);
  }
}
