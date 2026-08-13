import {
  ATRASO_RETRY_MS,
  EXTENSOES_TEXTO,
  LIMITE_BLOB_MIDIA_BYTES,
  LOG_DOWNLOAD,
  TENTATIVAS_DOWNLOAD,
  USAR_BLOB_MIDIAS_GRANDES
} from "./constantes.js";
import { downloadFoiCancelado, verificarCancelamento } from "./cancelamento.js";

function aguardar(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function obterStatusHttpErro(erro) {
  const statusDireto = Number(erro?.status || erro?.response?.status);
  const match = String(erro?.message || "").match(/\bHTTP\s+(\d{3})\b|\bstatus\s+(\d{3})\b/i);
  const statusMensagem = Number(match?.[1] || match?.[2]);

  return Number.isFinite(statusDireto) && statusDireto > 0
    ? statusDireto
    : Number.isFinite(statusMensagem) && statusMensagem > 0
      ? statusMensagem
      : 0;
}

function deveTentarNovamente(erro) {
  if (downloadFoiCancelado(erro)) {
    return false;
  }

  const status = obterStatusHttpErro(erro);

  if (!status) {
    // Sem status HTTP = erro de rede (CORS, conexão recusada etc.) — não adianta tentar de novo no browser.
    return false;
  }

  return status === 408 || status === 429 || status >= 500;
}

async function executarComTentativas(descricao, tarefa, tentativas = TENTATIVAS_DOWNLOAD) {
  let ultimoErro = null;

  for (let tentativa = 1; tentativa <= tentativas; tentativa += 1) {
    try {
      return await tarefa(tentativa);
    } catch (erro) {
      ultimoErro = erro;
      console.warn(
        `${LOG_DOWNLOAD} RETRY_ERRO tentativa=${tentativa}/${tentativas} descricao=${descricao} motivo=${erro?.message || "erro desconhecido"}`
      );

      if (!deveTentarNovamente(erro)) {
        break;
      }

      if (tentativa < tentativas) {
        await aguardar(ATRASO_RETRY_MS * tentativa);
      }
    }
  }

  throw ultimoErro || new Error(`Falha em ${descricao}`);
}

function estimarBytesBase64(base64) {
  const texto = String(base64 || "");
  const padding = texto.endsWith("==") ? 2 : texto.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((texto.length * 3) / 4) - padding);
}

function obterCharset(textoOuTipo = "") {
  const texto = String(textoOuTipo || "");
  const match = texto.match(/charset=["']?([\w-]+)/i);
  return match?.[1]?.toLowerCase() || "";
}

function decodificarBase64ComoTexto(base64, charset = "utf-8") {
  const binario = atob(String(base64 || ""));
  const bytes = Uint8Array.from(binario, caractere => caractere.charCodeAt(0));
  const codificacao = charset.includes("8859") || charset.includes("latin") ? "iso-8859-1" : "utf-8";

  return new TextDecoder(codificacao).decode(bytes);
}

export function normalizarCharsetHtml(texto) {
  return String(texto || "")
    .replace(/charset=["']?iso-8859-1["']?/gi, "charset=\"UTF-8\"")
    .replace(/charset=["']?latin1["']?/gi, "charset=\"UTF-8\"");
}

function deveBaixarComoTexto(url, tipo = "") {
  const tipoNormalizado = tipo.toLowerCase();

  return (
    EXTENSOES_TEXTO.test(url) ||
    /(?:^|\/)(?:appmanifest|offline)(?:[?#].*)?$/i.test(url) ||
    tipoNormalizado.includes("text") ||
    tipoNormalizado.includes("javascript") ||
    tipoNormalizado.includes("json") ||
    tipoNormalizado.includes("css") ||
    tipoNormalizado.includes("xml") ||
    tipoNormalizado.includes("svg")
  );
}

const EXTENSOES_MIDIA = /\.(?:mp3|m4a|ogg|wav|webm|mp4)(?:[?#].*)?$/i;

export function deveUsarBlobParaMidia({
  url,
  tipo = "",
  bytes = 0,
  habilitado = USAR_BLOB_MIDIAS_GRANDES,
  limiteBytes = LIMITE_BLOB_MIDIA_BYTES
}) {
  if (!habilitado || Number(bytes) < Number(limiteBytes)) {
    return false;
  }

  const tipoNormalizado = String(tipo).toLowerCase();
  return tipoNormalizado.startsWith("audio/") || tipoNormalizado.startsWith("video/") || EXTENSOES_MIDIA.test(url);
}

async function blobComoBase64(blob) {
  // No PWA usava FileReader.readAsDataURL. Em Node 24 o Blob tem arrayBuffer(),
  // e Buffer converte para base64 direto — mesmo resultado, sem FileReader.
  const buffer = Buffer.from(await blob.arrayBuffer());
  return buffer.toString("base64");
}

// Timeout por requisicao (ms). Em Node, um `fetch` sem timeout que abre a conexao
// mas nao recebe resposta pendura PARA SEMPRE — e trava a fila inteira de downloads
// atras dele. O PWA nao sofria disso (o navegador tem timeouts proprios).
//
// Generoso de proposito (120s): o objetivo NAO e desistir rapido, e sim impedir o
// pendura infinito. Um arquivo grande e legitimo (c3runtime.js de 1,5 MB em rede
// lenta) tem de caber aqui; so estoura quem realmente parou. Um timeout vira 408,
// que o executarComTentativas repete — a intencao e completar, nao pular.
const TIMEOUT_REQUISICAO_MS = Number(process.env.ACERVO_TIMEOUT_ARQUIVO_MS || 120000);

// Combina o cancelamento do usuario com um timeout — o que disparar primeiro aborta.
function montarSignal(cancelToken) {
  const doTimeout = AbortSignal.timeout(TIMEOUT_REQUISICAO_MS);
  const doUsuario = cancelToken?.signal;
  if (doUsuario && typeof AbortSignal.any === "function") {
    return AbortSignal.any([doUsuario, doTimeout]);
  }
  return doTimeout;
}

async function requisitarArquivo(url, responseType = "text", opcoes = {}) {
  verificarCancelamento(opcoes.cancelToken);

  let resposta;
  try {
    resposta = await fetch(url, { signal: montarSignal(opcoes.cancelToken) });
  } catch (erro) {
    // Timeout vira erro de status 0 (rede) — o retry de httpConteudo NAO repete
    // erro sem status, entao promovemos a um erro tratavel: 408 (timeout) faz o
    // executarComTentativas repetir, e apos as tentativas a pagina falha e a fila
    // SEGUE para a proxima, em vez de pendurar.
    if (erro?.name === "TimeoutError" || erro?.name === "AbortError") {
      const timeout = new Error(`Tempo esgotado ao baixar ${url}`);
      timeout.status = 408;
      throw timeout;
    }
    throw erro;
  }

  if (!resposta.ok) {
    const erro = new Error(`Falha HTTP ${resposta.status} ao baixar ${url}`);
    erro.status = resposta.status;
    throw erro;
  }

  const tipo = resposta.headers.get("content-type") || "";

  if (responseType === "blob") {
    return {
      dados: await resposta.blob(),
      tipo,
      urlFinal: resposta.url || url
    };
  }

  return {
    dados: await resposta.text(),
    tipo,
    urlFinal: resposta.url || url
  };
}

export async function baixarTexto(url, opcoes = {}) {
  verificarCancelamento(opcoes.cancelToken);
  console.info(`${LOG_DOWNLOAD} TEXTO_INICIO url=${url}`);
  const resposta = await executarComTentativas(`texto:${url}`, () => requisitarArquivo(url, "text", opcoes));
  const dados = resposta.dados;
  const texto = typeof dados === "string" ? dados : JSON.stringify(dados || "");
  console.info(`${LOG_DOWNLOAD} TEXTO_FIM bytes=${new Blob([texto]).size} url=${url}`);

  return {
    texto,
    tipo: resposta.tipo
  };
}

export async function baixarItemArquivo(url, opcoes = {}) {
  verificarCancelamento(opcoes.cancelToken);

  if (deveBaixarComoTexto(url)) {
    const arquivo = await baixarTexto(url, opcoes);

    return {
      bytes: new Blob([arquivo.texto]).size,
      base64: "",
      texto: normalizarCharsetHtml(arquivo.texto),
      tipo: arquivo.tipo
    };
  }

  const resposta = await executarComTentativas(`binario:${url}`, () => requisitarArquivo(url, "blob", opcoes));
  const tipo = resposta.tipo || "application/octet-stream";
  const blob = resposta.dados;

  if (deveBaixarComoTexto(url, tipo)) {
    const base64 = await blobComoBase64(blob);
    const textoInicial = decodificarBase64ComoTexto(base64, obterCharset(tipo) || "utf-8");
    const texto = obterCharset(textoInicial)
      ? decodificarBase64ComoTexto(base64, obterCharset(textoInicial))
      : textoInicial;

    return {
      bytes: blob.size,
      base64: "",
      texto: normalizarCharsetHtml(texto),
      tipo
    };
  }

  if (
    deveUsarBlobParaMidia({
      url: resposta.urlFinal || url,
      tipo,
      bytes: blob.size,
      habilitado: opcoes.usarBlobMidiasGrandes,
      limiteBytes: opcoes.limiteBlobMidiaBytes
    })
  ) {
    return {
      bytes: blob.size,
      base64: "",
      blob,
      texto: "",
      tipo
    };
  }

  const base64 = await blobComoBase64(blob);

  return {
    bytes: estimarBytesBase64(base64),
    base64,
    texto: "",
    tipo
  };
}

