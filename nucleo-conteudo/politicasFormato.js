import { HOSTS_VENDOR } from "./constantes.js";

const HOSTS_VENDOR_ANIMATE = new Set(["code.createjs.com"]);
const FORMATOS_SCRIPT = new Set(["html", "html-moderno", "html-modelo-classico"]);
// Construct 2 e 3 seguem a MESMA politica: export autonomo, sem vendor externo e
// com os scripts preservados como vieram (SPEC 9.2). O que muda entre eles e so
// de onde o runtime le o projeto — `data.js` no 2, `data.json` no 3.
const FORMATOS_CONSTRUCT = new Set(["construct2", "construct3"]);
// Formatos cujos .js sao servidos como vieram, SEM reescrita de caminhos. Alem do
// Construct (export autonomo), o html-educandus: seus scripts carregam recursos por
// caminho relativo ao DOCUMENTO em runtime (ex.: `open("GET", "informacoes.xml")` no
// Start.js). A reescrita, que calcula o caminho relativo ao proprio arquivo .js
// (`JavaScripts/Start.js` -> `../informacoes.xml`), quebrava esse XHR: em runtime o
// script roda embutido no index.html, entao `../` sobe um nivel a mais e da 404 (o
// texto das falas sumia; visto na 870976, 12/08/2026). Preservado, o caminho fica
// literal e resolve certo contra a base da pagina.
const FORMATOS_SCRIPT_PRESERVADO = new Set(["construct2", "construct3", "html-educandus"]);

export function formatoPermiteVendor(formato, url) {
  if (!formato || FORMATOS_CONSTRUCT.has(formato)) {
    return false;
  }

  try {
    const hostname = new URL(url).hostname;

    if (formato === "animate-autonomo") {
      return HOSTS_VENDOR_ANIMATE.has(hostname);
    }

    if (FORMATOS_SCRIPT.has(formato)) {
      return HOSTS_VENDOR.has(hostname);
    }
  } catch {
    return false;
  }

  return false;
}

export function devePreservarScriptDoFormato(formato, caminho) {
  return FORMATOS_SCRIPT_PRESERVADO.has(formato) && /\.(?:js|mjs)$/i.test(caminho || "");
}

export function deveInjetarModeloHtml(formato) {
  return formato === "html-modelo-classico";
}
