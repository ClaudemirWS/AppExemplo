// Modulos ES em conteudo do publicador.
//
// PROBLEMA QUE ESTE ARQUIVO RESOLVE
//
// A descoberta de recursos (`extrairRecursosHtml`) acha coisas por EXTENSAO de
// arquivo, e a reescrita (`reescreverTextoParaArquivosLocais`) so troca o que foi
// descoberto. As tres formas que um modulo ES usa para trazer dependencia passam
// batido:
//
//   import * as THREE from "https://cdn.skypack.dev/three@0.129.0";  // sem extensao
//   import * as THREE from "three";                                   // bare specifier
//   <script type="importmap">{"imports":{"three":"https://..."}}</script>
//
// Verificado contra o proprio codigo em 03/08/2026: os tres devolvem `[]`. Como
// nada e descoberto, nada e reescrito, e o import continua apontando para a
// internet. Offline a resolucao falha, o MODULO ABORTA INTEIRO, e tudo que ele
// construiria nunca acontece — foi o cubo 3D de "Areas de superficies planas II"
// desaparecendo, enquanto o resto da pagina (script classico) sobrevivia.
//
// POR QUE ISTO E SO REESCRITA, E NAO DESCOBERTA
//
// O ramo vendor de `adicionarRecursoNaFila` nao baixa arquivo: ele apenas registra
// o recurso e aponta para o espelho em `public/offline-vendor/`, que e mantido a
// mao. Entao, para dependencia que ja esta espelhada, o que falta e trocar o
// especificador no texto — nao ha o que descobrir nem baixar.
//
// A CONSEQUENCIA e que este mapa so pode apontar para arquivo que EXISTE no
// espelho. Apontar para o que nao existe troca "falha ao resolver" por "404", o
// que nao melhora nada. Ao acrescentar entrada aqui, conferir o arquivo no disco.

import { LOG_DOWNLOAD, VENDOR_THREE_0129 } from "./constantes.js";
import { formatoPermiteVendor } from "./politicasFormato.js";

// O que esta REALMENTE espelhado hoje, conferido em `public/offline-vendor/`:
//
//   three/0.129.0/build/three.module.js
//   three/0.129.0/examples/jsm/loaders/GLTFLoader.js
//   cdn.skypack.dev/three@0.129.0/build/three.module.js
//   cdn.skypack.dev/three@0.129.0/examples/jsm/loaders/GLTFLoader.js
//
// As duas arvores tem o mesmo conteudo: `filaRecursos.js` ja mapeia as URLs do
// skypack COM extensao para a arvore `three/0.129.0`, e este arquivo segue o mesmo
// destino para nao criar uma segunda convencao.
const MODULO_THREE = `/${VENDOR_THREE_0129}/build/three.module.js`;
const MODULO_GLTF_LOADER = `/${VENDOR_THREE_0129}/examples/jsm/loaders/GLTFLoader.js`;

// Chave = especificador normalizado (sem barra final, sem query). O mapa cobre as
// formas que um autor escreve para a MESMA dependencia: bare, com versao, e a URL
// do CDN sem extensao — que e justamente a que o skypack serve.
const MODULOS_CONHECIDOS = new Map([
  ["three", MODULO_THREE],
  ["three@0.129.0", MODULO_THREE],
  ["https://cdn.skypack.dev/three", MODULO_THREE],
  ["https://cdn.skypack.dev/three@0.129.0", MODULO_THREE],
  ["https://unpkg.com/three@0.129.0", MODULO_THREE],
  ["https://cdn.jsdelivr.net/npm/three@0.129.0", MODULO_THREE],
  ["three/examples/jsm/loaders/GLTFLoader.js", MODULO_GLTF_LOADER],
  ["three@0.129.0/examples/jsm/loaders/GLTFLoader.js", MODULO_GLTF_LOADER]
]);

function normalizarEspecificador(especificador) {
  return String(especificador || "")
    .trim()
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
}

/**
 * Caminho local do modulo, ou "" quando nao ha espelho para ele.
 *
 * `""` e informacao util: e o que permite avisar no log em vez de escrever um
 * caminho inventado.
 */
export function resolverModuloVendor(especificador) {
  return MODULOS_CONHECIDOS.get(normalizarEspecificador(especificador)) || "";
}

// Import estatico e reexportacao: `import x from "y"`, `export {x} from "y"`.
// `[^;'"]*?` cobre a lista de bindings sem atravessar o fim da instrucao.
const IMPORT_COM_FROM = /\b(?:import|export)\b[^;'"]*?\bfrom\s*(['"])([^'"]+)\1/g;
// Import so por efeito colateral: `import "y"`.
const IMPORT_DIRETO = /\bimport\s*(['"])([^'"]+)\1/g;
// Import dinamico: `import("y")`.
const IMPORT_DINAMICO = /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g;

/**
 * Especificadores de modulo encontrados no texto, sem repeticao.
 *
 * Serve ao diagnostico e ao log: a reescrita usa os mesmos padroes, mas precisa
 * preservar o formato original de cada ocorrencia.
 */
export function extrairEspecificadoresDeModulo(texto) {
  const conteudo = String(texto || "");
  const encontrados = new Set();

  for (const padrao of [IMPORT_COM_FROM, IMPORT_DIRETO, IMPORT_DINAMICO]) {
    for (const match of conteudo.matchAll(padrao)) {
      if (match[2]) {
        encontrados.add(match[2]);
      }
    }
  }

  return [...encontrados];
}

/**
 * Troca especificadores conhecidos pelo caminho local, PRESERVANDO a forma da
 * instrucao.
 *
 * A substituicao acontece dentro do `import`/`export`, e nao no texto inteiro: um
 * `split("three").join(...)` cego trocaria a palavra em comentario, em nome de
 * variavel e em classe CSS (`img_tag_three` existe no acervo e seria atingido).
 *
 * Especificador desconhecido fica INTACTO e vai para o log. Reescrever para um
 * palpite trocaria um erro claro por um 404 silencioso.
 */
export function reescreverEspecificadoresDeModulo(texto, { descricao = "" } = {}) {
  const conteudo = String(texto || "");

  if (!conteudo) {
    return conteudo;
  }

  const naoMapeados = new Set();
  let resultado = conteudo;

  for (const padrao of [IMPORT_COM_FROM, IMPORT_DIRETO, IMPORT_DINAMICO]) {
    resultado = resultado.replace(new RegExp(padrao.source, padrao.flags), (trecho, aspas, especificador) => {
      // Caminho do proprio pacote nao passa por aqui: quem cuida dele e a
      // reescrita por recurso descoberto, que sabe a profundidade da pagina.
      if (especificador.startsWith(".") || especificador.startsWith("/")) {
        return trecho;
      }

      const local = resolverModuloVendor(especificador);

      if (!local) {
        naoMapeados.add(especificador);
        return trecho;
      }

      return trecho.split(`${aspas}${especificador}${aspas}`).join(`${aspas}${local}${aspas}`);
    });
  }

  if (naoMapeados.size > 0) {
    console.warn(
      `${LOG_DOWNLOAD} MODULO_NAO_MAPEADO ${descricao} especificadores=${[...naoMapeados].join(", ")}`
    );
  }

  return resultado;
}

const IMPORT_MAP = /(<script\b[^>]*\btype\s*=\s*["']importmap["'][^>]*>)([\s\S]*?)(<\/script\s*>)/gi;

/**
 * Reescreve os alvos de um import map para o espelho local.
 *
 * O import map e o unico jeito de um bare specifier resolver no navegador, e o
 * alvo dele e sempre remoto no conteudo do publicador. Reescrever o mapa conserta
 * de uma vez todos os `import ... from "three"` do LO, sem tocar em cada arquivo.
 *
 * Alvo desconhecido fica como esta: um mapa parcialmente reescrito continua valido,
 * e o que sobrou aparece no log.
 */
export function reescreverImportMap(html, { descricao = "" } = {}) {
  const conteudo = String(html || "");

  if (!conteudo.includes("importmap")) {
    return conteudo;
  }

  return conteudo.replace(IMPORT_MAP, (trecho, abertura, corpo, fechamento) => {
    let mapa;

    try {
      mapa = JSON.parse(corpo);
    } catch {
      // Import map invalido nao e nosso para consertar; o navegador ja o ignora.
      console.warn(`${LOG_DOWNLOAD} IMPORTMAP_INVALIDO ${descricao}`);
      return trecho;
    }

    if (!mapa || typeof mapa.imports !== "object" || !mapa.imports) {
      return trecho;
    }

    const naoMapeados = [];
    const importsLocais = {};

    for (const [chave, alvo] of Object.entries(mapa.imports)) {
      const local = resolverModuloVendor(alvo) || resolverModuloVendor(chave);

      if (local) {
        importsLocais[chave] = local;
      } else {
        importsLocais[chave] = alvo;
        naoMapeados.push(`${chave} -> ${alvo}`);
      }
    }

    if (naoMapeados.length > 0) {
      console.warn(`${LOG_DOWNLOAD} IMPORTMAP_NAO_MAPEADO ${descricao} ${naoMapeados.join(", ")}`);
    }

    return `${abertura}${JSON.stringify({ ...mapa, imports: importsLocais }, null, 2)}${fechamento}`;
  });
}

/**
 * Aplica as duas reescritas quando o formato permite vendor.
 *
 * O teste de formato reusa `formatoPermiteVendor`, que ja recusa `construct3` — o
 * export do Construct e autonomo e SPEC 9.2 proibe injetar vendor nele. Como o
 * gate e o mesmo do resto da politica de vendor, nao ha uma segunda regra para
 * manter em sincronia.
 */
export function reescreverModulosDoFormato(texto, formato, { ehHtml = false, descricao = "" } = {}) {
  // A URL e so para o gate por host; o que decide aqui e o formato.
  if (!formatoPermiteVendor(formato, "https://cdn.skypack.dev/")) {
    return texto;
  }

  const comImportMap = ehHtml ? reescreverImportMap(texto, { descricao }) : texto;
  return reescreverEspecificadoresDeModulo(comImportMap, { descricao });
}
