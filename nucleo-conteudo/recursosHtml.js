import { EXTENSOES_RECURSO } from "./constantes.js";
import { normalizarCaminhoArquivo } from "./caminhos.js";

export function detectarFormato(html, recursos = []) {
  const texto = `${html}\n${recursos.join("\n")}`.toLowerCase();

  // Construct 2 ANTES do 3: o export do C2 tambem contem a palavra "construct" e
  // referencia `offlineClient.js`, entao a regra do C3 abaixo o capturaria.
  // O que separa os dois e o runtime — `c2runtime.js` contra `c3runtime.js` —, e
  // a diferenca importa: o C2 carrega o projeto de `data.js` e o C3 de
  // `data.json`. Classificado como C3, o pacote do C2 sai sem `data.js`, o
  // runtime nao acha o modelo do projeto e a aula abre em branco
  // ("Project model unavailable").
  if (texto.includes("c2runtime")) {
    return "construct2";
  }

  if (
    texto.includes("construct") ||
    texto.includes("c3runtime") ||
    texto.includes("offlineclient.js") ||
    texto.includes("scripts/main.js")
  ) {
    return "construct3";
  }

  if (texto.includes("adobe_animate_cc")) {
    return "animate-autonomo";
  }

  if (texto.includes("classes.educandus.com.br/modelo_html")) {
    return "html-modelo-classico";
  }

  if (texto.includes("assets/css/") || texto.includes("assets/js/")) {
    return "html-moderno";
  }

  // Aula HTML ARTESANAL da Educandus (feita a mao, nao exportada de ferramenta):
  // index.html com imgs/audios posicionados por CSS + scripts proprios em
  // `JavaScripts/` e libs (three.js etc.) em `Biblioteca/`. Pode ter um quadro 3D
  // gerado por codigo (new THREE.BoxGeometry). As DUAS pastas juntas sao a assinatura
  // — nenhum outro formato usa esse par. Vem por ultimo, antes do fallback "html",
  // para nao roubar Construct/Animate/modelo-classico.
  if (texto.includes("javascripts/") && texto.includes("biblioteca/")) {
    return "html-educandus";
  }

  return "html";
}

export function extrairRecursosHtml(html) {
  const recursos = new Set();
  const atributos = /\b(?:src|href|data-src|poster)\s*=\s*["']([^"']+)["']/gi;
  const urlsCss = /url\((?!['"]?data:)(['"]?)([^'")]+)\1\)/gi;
  const arquivosEmTexto = /["']([^"']+\.(?:html?|png|jpe?g|gif|webp|svg|json|js|mjs|css|xml|mp3|m4a|ogg|wav|webm|mp4|wasm|ttf|otf|woff2?|appcache|webmanifest|glb|gltf|bin)(?:\?[^"']*)?)["']/gi;
  const arquivosEmTagsXml =
    /<(?:js|css|imagem|image|img|video|audio|gif|arquivo|file|src|href)\b[^>]*>\s*([^<>\s]+\.(?:html?|png|jpe?g|gif|webp|svg|json|js|mjs|css|xml|mp3|m4a|ogg|wav|webm|mp4|wasm|ttf|otf|woff2?|appcache|webmanifest|glb|gltf|bin)(?:\?[^<>\s]*)?)\s*<\/(?:js|css|imagem|image|img|video|audio|gif|arquivo|file|src|href)>/gi;

  for (const match of html.matchAll(atributos)) {
    recursos.add(match[1]);
  }

  for (const match of html.matchAll(urlsCss)) {
    recursos.add(match[2]);
  }

  for (const match of html.matchAll(arquivosEmTexto)) {
    recursos.add(match[1]);
  }

  for (const match of html.matchAll(arquivosEmTagsXml)) {
    recursos.add(match[1]);
  }

  return Array.from(recursos).filter(
    recurso =>
      recurso &&
      !recurso.startsWith("#") &&
      !recurso.startsWith("data:") &&
      !recurso.startsWith("blob:") &&
      !recurso.startsWith("mailto:") &&
      !recurso.startsWith("javascript:")
  );
}

export function recursoDinamicoInvalido(recurso) {
  const texto = String(recurso || "").trim();

  if (
    !texto ||
    texto.includes("${") ||
    texto.includes(",") ||
    texto.includes("+") ||
    texto.includes("(") ||
    texto.includes("[") ||
    /^this\./i.test(texto) ||
    /^(?:e|t|s)\.[a-z_$]/i.test(texto) ||
    /^[a-z_$][\w$]*\.[a-z_$][\w$.]*$/i.test(texto) ||
    /\b(?:event|e|request)\.request\.url\b/i.test(texto) ||
    /\b(?:event|e)\.request\b/i.test(texto) ||
    /^(?:true|false|null|undefined)$/i.test(texto)
  ) {
    return true;
  }

  // Bare name without extension, path separator, or URL scheme — likely a JS identifier.
  const ehAbsoluto = /^[a-z][a-z0-9+.-]*:\/\//i.test(texto);
  const temExtensaoOuCaminho = texto.includes(".") || texto.includes("/");
  return !ehAbsoluto && !temExtensaoOuCaminho;
}

function coletarStringsDeArquivos(valor, recursos = new Set()) {
  if (typeof valor === "string" && EXTENSOES_RECURSO.test(valor) && !valor.startsWith(".")) {
    recursos.add(valor);
  } else if (Array.isArray(valor)) {
    valor.forEach(item => coletarStringsDeArquivos(item, recursos));
  } else if (valor && typeof valor === "object") {
    Object.values(valor).forEach(item => coletarStringsDeArquivos(item, recursos));
  }

  return recursos;
}

export function extrairRecursosJson(texto) {
  try {
    return Array.from(coletarStringsDeArquivos(JSON.parse(texto))).map(normalizarCaminhoArquivo).filter(Boolean);
  } catch {
    return [];
  }
}

export function extrairLinksApache(html) {
  if (!/Index of /i.test(html)) {
    return null;
  }

  return Array.from(html.matchAll(/<a\s+href=["']([^"']+)["']/gi))
    .map(match => match[1])
    .filter(href => href && !href.startsWith("?") && !href.startsWith("/") && !href.startsWith("../"));
}

export function removerRegistroServiceWorker(html) {
  return String(html || "")
    .replace(/<script\b[^>]*\bsrc=["'][^"']*register-sw\.js[^"']*["'][^>]*>\s*<\/script>/gi, "")
    .replace(/navigator\.serviceWorker\.register\s*\(/gi, "void(");
}
