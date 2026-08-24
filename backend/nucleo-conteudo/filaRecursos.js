import { HOSTS_VENDOR, PASTA_VENDOR_OFFLINE, VENDOR_THREE_0129 } from "./constantes.js";
import { obterBaseServidorConteudoLocal, usandoNativo } from "./ambiente.js";
import { normalizarCaminhoArquivo, obterCaminhoRelativo, resolverUrl, decodificarTolerante } from "./caminhos.js";
import { normalizarCharsetHtml } from "./httpConteudo.js";
import { recursoDinamicoInvalido } from "./recursosHtml.js";
import { formatoPermiteVendor } from "./politicasFormato.js";

function obterCaminhoVendor(url, formato = "") {
  if (!formatoPermiteVendor(formato, url)) {
    return "";
  }

  try {
    const objetoUrl = new URL(url);
    const caminho = objetoUrl.pathname.replace(/\/+$/, "");

    if (objetoUrl.hostname === "cdn.skypack.dev") {
      if (caminho === "/three@0.129.0/build/three.module.js") {
        return `${VENDOR_THREE_0129}/build/three.module.js`;
      }

      if (caminho === "/three@0.129.0/examples/jsm/loaders/GLTFLoader.js") {
        return `${VENDOR_THREE_0129}/examples/jsm/loaders/GLTFLoader.js`;
      }
    }

    if (!HOSTS_VENDOR.has(objetoUrl.hostname)) {
      return "";
    }

    return normalizarCaminhoArquivo(`${PASTA_VENDOR_OFFLINE}/${objetoUrl.hostname}${objetoUrl.pathname}`);
  } catch {
    return "";
  }
}

function obterUrlVendorLocal(caminhoVendor) {
  const normalizado = normalizarCaminhoArquivo(caminhoVendor);

  if (usandoNativo()) {
    const caminho = normalizado.split("/").map(parte => encodeURIComponent(parte)).join("/");
    return new URL(caminho, obterBaseServidorConteudoLocal()).toString();
  }

  // No web, @ é válido em caminhos de URL e o SW cacheia os arquivos com @ literal.
  const caminho = normalizado.split("/").map(parte => encodeURIComponent(parte).replace(/%40/g, "@")).join("/");
  return `/${caminho}`;
}

export function adicionarRecursoNaFila(fila, recurso, basePrimaria, basePacote, opcoes = {}) {
  if (opcoes.dinamico && recursoDinamicoInvalido(recurso)) {
    return;
  }

  const url = resolverUrl(basePrimaria, recurso) || resolverUrl(basePacote.toString(), recurso);

  if (!url) {
    return;
  }

  const vendor = obterCaminhoVendor(url, opcoes.formato || "");
  if (vendor) {
    fila.push({
      original: recurso,
      url,
      caminhoPreferencial: vendor,
      origem: opcoes.origem || "vendor",
      vendor: true
    });
    return;
  }

  fila.push({
    original: recurso,
    url,
    caminhoPreferencial: opcoes.caminhoPreferencial || "",
    origem: opcoes.origem || "varredura",
    vendor: false,
    opcional: Boolean(opcoes.opcional)
  });
}

export function adicionarRecursoDinamicoPublicador(fila, recurso, basePrimaria, diretorioBase, origem, opcoes = {}) {
  if (recursoDinamicoInvalido(recurso)) {
    return;
  }

  const texto = String(recurso || "").trim();
  const absoluto = /^[a-z][a-z0-9+.-]*:\/\//i.test(texto) || texto.startsWith("/");

  if (!absoluto && !texto.startsWith(".")) {
    adicionarRecursoNaFila(fila, texto, diretorioBase.toString(), diretorioBase, {
      dinamico: true,
      opcional: true,
      origem: `${origem}:raiz`,
      formato: opcoes.formato || ""
    });
  }

  adicionarRecursoNaFila(fila, texto, basePrimaria, diretorioBase, {
    dinamico: true,
    opcional: true,
    origem,
    formato: opcoes.formato || ""
  });
}

export function reescreverTextoParaArquivosLocais(texto, caminhoArquivo, recursos) {
  let textoReescrito = normalizarCharsetHtml(texto);

  for (const recurso of recursos) {
    const relativo = recurso.vendor ? obterUrlVendorLocal(recurso.caminho) : obterCaminhoRelativo(caminhoArquivo, recurso.caminho);
    const originalEhCaminhoAbsoluto = String(recurso.original || "").startsWith("/");

    textoReescrito = textoReescrito.split(recurso.url).join(relativo);

    // Sempre substituir o original quando diferente — inclui URLs relativas com query string (ex: arquivo.js?ts)
    if (recurso.original && recurso.original !== relativo) {
      textoReescrito = textoReescrito.split(recurso.original).join(relativo);
    }

    try {
      const url = new URL(recurso.url);
      if (!recurso.vendor && originalEhCaminhoAbsoluto) {
        textoReescrito = textoReescrito.split(`${url.pathname}${url.search}`).join(relativo);
        textoReescrito = textoReescrito.split(decodificarTolerante(url.pathname)).join(relativo);
      }
    } catch {
      // Recurso invalido ja foi descartado antes de chegar aqui.
    }
  }

  return textoReescrito;
}
