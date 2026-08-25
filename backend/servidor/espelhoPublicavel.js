// Espelho PUBLICAVEL de uma aula — download que devolve os arquivos EXATAMENTE como o
// publicador (aulaspre) serve, sem as reescritas de PWA (offline-vendor, externos/,
// caminho relativo ao arquivo, strip de ?timestamp). Serve para instrumentar com o
// toolkit e REPUBLICAR no aulaspre como novo vN.
//
// Isolado de proposito: NAO reusa `cachearRecursosEmArquivos` (que reescreve) — reusa
// apenas a DESCOBERTA de recursos (`prepararFilaRecursos`) e copia byte-a-byte. Assim o
// caminho do PWA/acervo fica intocado.
//
// Regras:
//   - so arquivos MESMO-ORIGEM sob a pasta do `vN` entram (as refs de CDN — createjs,
//     jquery — ficam como estao no texto; produção carrega da CDN);
//   - texto NAO e normalizado (nada de mudar charset) — bytes crus;
//   - a versao de cada pagina e o ULTIMO vN do publicador (obterUltimaVersaoLo);
//   - qualquer pagina sem vN publicavel ABORTA tudo (sem zip parcial).

import { zipSync } from "fflate";
import { obterUltimaVersaoLo } from "../nucleo-conteudo/publicador.js";
import { prepararFilaRecursos } from "../nucleo-conteudo/descobertaRecursos.js";
import {
  obterCaminhoRelativoAoPacote,
  obterDiretorioUrl,
  resolverUrl
} from "../nucleo-conteudo/caminhos.js";
import { extrairRecursosHtml } from "../nucleo-conteudo/recursosHtml.js";
import { adicionarRecursoDinamicoPublicador } from "../nucleo-conteudo/filaRecursos.js";
import {
  CONCORRENCIA_DOWNLOAD,
  LIMITE_BYTES,
  LIMITE_RECURSOS,
  LOG_DOWNLOAD
} from "../nucleo-conteudo/constantes.js";

const TIMEOUT_MS = Number(process.env.ACERVO_TIMEOUT_ARQUIVO_MS || 120000);
const EXTENSAO_TEXTO_DESCOBERTA = /\.(?:html?|js|mjs|css|json|xml|svg)(?:[?#].*)?$/i;

// Erro tipado: pagina sem versao publicavel no publicador. O chamador (rota) o
// converte no evento SSE de erro e cancela o download inteiro.
export class PaginaSemVersaoError extends Error {
  constructor(pagina) {
    super(`Página "${pagina?.nome || pagina?.externalId || "?"}" sem versão publicável.`);
    this.name = "PaginaSemVersaoError";
    this.pagina = pagina;
  }
}

// Fetch de BYTES CRUS (sem a normalizacao de charset do httpConteudo). Timeout + 2
// retentativas em 5xx/408 (rede transitoria). Devolve { bytes: Uint8Array, tipo }.
function verificarAbortado(signal) {
  if (signal?.aborted) {
    throw new DOMException("Download cancelado.", "AbortError");
  }
}

async function baixarBytes(url, tentativas = 3, signal) {
  let ultimoErro = null;

  for (let tentativa = 1; tentativa <= tentativas; tentativa += 1) {
    verificarAbortado(signal);
    try {
      const timeout = AbortSignal.timeout(TIMEOUT_MS);
      const sinal = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const resposta = await fetch(url, { signal: sinal });
      if (!resposta.ok) {
        const erro = new Error(`HTTP ${resposta.status} ao baixar ${url}`);
        erro.status = resposta.status;
        throw erro;
      }
      return {
        bytes: new Uint8Array(await resposta.arrayBuffer()),
        tipo: resposta.headers.get("content-type") || ""
      };
    } catch (erro) {
      verificarAbortado(signal);
      ultimoErro = erro;
      const status = Number(erro?.status) || (erro?.name === "TimeoutError" ? 408 : 0);
      const repetivel = status === 408 || status === 429 || status >= 500;
      if (!repetivel || tentativa === tentativas) break;
    }
  }

  throw ultimoErro || new Error(`Falha ao baixar ${url}`);
}

// Espelha UMA pagina do publicador verbatim. `urlBaseDir` = a pasta do vN
// (`.../versoes/<id>_vN/`). Devolve { arquivos: Map<caminhoRelativo, Uint8Array> } com o
// index.html e todos os recursos MESMO-ORIGEM sob a pasta. Refs de CDN ficam no texto.
export async function espelharPaginaVerbatim({ urlBaseDir, externalId, signal }) {
  verificarAbortado(signal);
  const urlIndex = resolverUrl(urlBaseDir, "index.html");
  const diretorioBase = obterDiretorioUrl(urlIndex);
  const origem = diretorioBase.origin;

  const indexBaixado = await baixarBytes(urlIndex, 3, signal);
  const html = new TextDecoder("utf-8", { fatal: false }).decode(indexBaixado.bytes);

  const arquivos = new Map();
  arquivos.set("index.html", indexBaixado.bytes);

  const fila = [];
  const formato = await prepararFilaRecursos({
    fila,
    html,
    urlBase: urlIndex,
    diretorioBase,
    externalId,
    espelharPublicador: true
  });

  // O `<externalId>.txt` (marcador vazio) nao e citado no HTML nem listado na raiz
  // (a raiz serve o index). Enfileira por nome para vir junto, como o pacote atual tem.
  if (externalId) {
    fila.push({ url: resolverUrl(urlBaseDir, `${externalId}.txt`), caminhoPreferencial: `${externalId}.txt`, opcional: true });
  }

  const vistosUrl = new Set([urlIndex]);
  const vistosCaminho = new Set(["index.html"]);
  const falhas = [];
  let bytesTotais = indexBaixado.bytes.length;

  async function processarProximo() {
    verificarAbortado(signal);
    const item = fila.shift();
    if (!item) return false;

    const { url, caminhoPreferencial, vendor, opcional } = item;

    // CDN/vendor fica como esta no texto — nao empacotamos (produção carrega da CDN).
    if (!url || url.startsWith("data:") || vendor) return true;
    if (vistosUrl.has(url)) return true;

    const caminho = caminhoPreferencial || obterCaminhoRelativoAoPacote(url, diretorioBase);

    // `externos/...` = host diferente (ex.: code.jquery.com) — nao empacotar; a ref
    // original (CDN) permanece no texto verbatim.
    if (!caminho || caminho.startsWith("externos/")) return true;

    let urlObj;
    try { urlObj = new URL(url); } catch { return true; }
    if (urlObj.origin !== origem) return true; // so mesmo-origem (a pasta do publicador)
    if (vistosCaminho.has(caminho)) return true;

    vistosUrl.add(url);
    vistosCaminho.add(caminho);

    try {
      const baixado = await baixarBytes(url, 3, signal);
      bytesTotais += baixado.bytes.length;
      if (bytesTotais > LIMITE_BYTES) return false;
      arquivos.set(caminho, baixado.bytes);

      // Descoberta recursiva: HTML/JS/CSS podem referenciar mais recursos (ex.: o
      // manifesto dentro do .js aponta components/EDUCANDUS/...). Decodifica so para
      // DESCOBRIR — o que fica gravado sao os bytes crus acima.
      if (EXTENSAO_TEXTO_DESCOBERTA.test(caminho)) {
        const texto = new TextDecoder("utf-8", { fatal: false }).decode(baixado.bytes);
        for (const recurso of extrairRecursosHtml(texto)) {
          adicionarRecursoDinamicoPublicador(fila, recurso, url, diretorioBase, caminho, { formato });
        }
      }
    } catch (erro) {
      // Recurso opcional (ex.: o .txt marcador, tentado por nome) que nao existe: ignora.
      if (!opcional && falhas.length < 100) {
        falhas.push({ url, caminho, motivo: erro?.message || "Falha ao baixar recurso" });
      }
    }

    return true;
  }

  const trabalhadores = Array.from({ length: CONCORRENCIA_DOWNLOAD }, async () => {
    while (arquivos.size < LIMITE_RECURSOS && bytesTotais <= LIMITE_BYTES) {
      const continuou = await processarProximo();
      if (!continuou) break;
    }
  });
  await Promise.all(trabalhadores);

  // Drena o que sobrou na fila apos os trabalhadores (itens enfileirados no fim).
  while (fila.length && arquivos.size < LIMITE_RECURSOS && bytesTotais <= LIMITE_BYTES) {
    const continuou = await processarProximo();
    if (!continuou) break;
  }

  return { arquivos, falhas, formato };
}

// Monta o zip publicavel da aula INTEIRA. `detalhes` vem de normalizarDetalhesConteudo
// (paginas com externalId/ordem/nome). `onPagina(indice1, total, nome)` reporta o
// progresso por pagina. Devolve { nome, bytesZip } (o nome ja e "Titulo [externalId].zip").
export async function montarZipPublicavel({ detalhes, onPagina = () => {}, signal }) {
  verificarAbortado(signal);
  const paginas = (detalhes?.paginas || []).filter(p => p.externalId);
  if (!paginas.length) {
    throw new Error("Aula sem páginas versionáveis (sem external_id) — nada a publicar.");
  }

  // 1. PRE-CHECAGEM: resolve o ultimo vN de cada pagina ANTES de baixar bytes. Se
  //    faltar em qualquer uma, aborta (sem zip parcial).
  const versoes = [];
  for (const pagina of paginas) {
    verificarAbortado(signal);
    const versao = await obterUltimaVersaoLo(pagina.externalId);
    verificarAbortado(signal);
    if (!versao?.url) {
      throw new PaginaSemVersaoError(pagina);
    }
    versoes.push({ pagina, versao });
  }

  // 2. Espelha cada pagina e acumula sob "<externalId>/..." (sem o _vN — como o pacote
  //    atual). Progresso por pagina apos concluir.
  const raiz = nomeSeguroPasta(`${detalhes.nome} [${detalhes.externalId}]`, `Conteudo [${detalhes.externalId}]`);
  const entradas = {};
  const total = versoes.length;

  for (let i = 0; i < versoes.length; i += 1) {
    verificarAbortado(signal);
    const { pagina, versao } = versoes[i];
    const { arquivos } = await espelharPaginaVerbatim({
      urlBaseDir: versao.url,
      externalId: String(pagina.externalId),
      signal
    });
    for (const [caminho, bytes] of arquivos) {
      entradas[`${raiz}/${pagina.externalId}/${caminho}`] = bytes;
    }
    console.info(`${LOG_DOWNLOAD} PUBLICAVEL_PAGINA ${i + 1}/${total} externalId=${pagina.externalId} arquivos=${arquivos.size}`);
    onPagina(i + 1, total, pagina.nome);
  }

  verificarAbortado(signal);
  const bytesZip = zipSync(entradas, { level: 6 });
  return { nome: `${raiz}.zip`, bytesZip };
}

// Nome de pasta/zip seguro no Windows (espelha nomePastaConteudo do baixarConteudo, sem
// depender de import circular). Acentos preservados (NTFS aceita).
function nomeSeguroPasta(nome, alt) {
  const limpo = String(nome || "")
    .replace(/[<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .trim();
  return limpo || alt;
}
