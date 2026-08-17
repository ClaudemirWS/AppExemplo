import { montarUrlArquivo } from "./origensRemotas.js";
import {
  arquivoExiste,
  obterUrlArquivoLocal,
  removerDiretorioSeExistir
} from "./arquivosPacote.js";
import {
  CONVERTIDOS_AULA_INDISPONIVEIS_OFFLINE,
  FORMATOS_PUBLICADOR_OFFLINE,
  HOST_CONTEUDOS,
  LOG_DOWNLOAD,
  MENSAGEM_AULA_INDISPONIVEL_OFFLINE,
  PASTA_CONTEUDOS_OFFLINE
} from "./constantes.js";
import { usandoNativo } from "./ambiente.js";
import { cancelarDownloadConteudo, downloadFoiCancelado, verificarCancelamento } from "./cancelamento.js";
import { normalizarCaminhoArquivo } from "./caminhos.js";
import { emitirProgresso, limitarPercentual } from "./progresso.js";
import { baixarTexto } from "./httpConteudo.js";
import { cachearRecursosEmArquivos } from "./cacheRecursos.js";
import { montarUrlAulasew, obterUltimaVersaoLo } from "./publicador.js";
import {
  detectarFormato,
  extrairRecursosHtml
} from "./recursosHtml.js";

export { cancelarDownloadConteudo, downloadFoiCancelado };

const TTL_CACHE_DADOS_PUBLICADOR_MS = 5 * 60 * 1000;
const cacheDadosPublicadorPagina = new Map();
const promessasDadosPublicadorPagina = new Map();

function aulaInteiraIndisponivelOffline(detalhes) {
  return CONVERTIDOS_AULA_INDISPONIVEIS_OFFLINE.has(String(detalhes?.convertido || "").toUpperCase());
}

function agoraMs() {
  return Date.now();
}

function chaveDadosPublicador(pagina, versao) {
  return `${String(pagina?.externalId || "").trim()}|${String(versao || "").trim()}`;
}

function lerCacheDadosPublicador(chave) {
  const entrada = cacheDadosPublicadorPagina.get(chave);

  if (!entrada) {
    return undefined;
  }

  if (entrada.expiraEm <= agoraMs()) {
    cacheDadosPublicadorPagina.delete(chave);
    return undefined;
  }

  return entrada.valor;
}

function salvarCacheDadosPublicador(chave, valor) {
  cacheDadosPublicadorPagina.set(chave, {
    valor,
    expiraEm: agoraMs() + TTL_CACHE_DADOS_PUBLICADOR_MS
  });
}

async function baixarPaginaPorPublicador(pagina, conteudoId, onProgresso, opcoes = {}) {
  verificarCancelamento(opcoes.cancelToken);
  emitirProgresso(onProgresso, 1);
  const versao = await obterUltimaVersaoLo(pagina.externalId);

  if (!versao?.url) {
    throw new Error("Versao do publicador nao encontrada.");
  }

  const conteudoBaixado = await baixarTexto(versao.url, opcoes);

  if (!conteudoBaixado.texto.trim().startsWith("<")) {
    throw new Error("HTML inicial do publicador inválido.");
  }

  const formato = detectarFormato(conteudoBaixado.texto, extrairRecursosHtml(conteudoBaixado.texto));

  if (!FORMATOS_PUBLICADOR_OFFLINE.has(formato)) {
    return null;
  }

  const pacote = await cachearRecursosEmArquivos({
    html: conteudoBaixado.texto,
    urlBase: versao.url,
    conteudoId,
    ordem: pagina.ordem,
    externalId: pagina.externalId,
    versao: versao.versao,
    pastaBaseConteudo: opcoes.pastaBaseConteudo,
    espelharPublicador: true,
    onProgresso,
    cancelToken: opcoes.cancelToken
  });

  return {
    id: pagina.id,
    ordem: pagina.ordem,
    nome: pagina.nome,
    externalId: pagina.externalId,
    urlOriginal: versao.url,
    // Versao publicada usada nesta pagina (ex.: "12345_v9"). E o vN da pasta no
    // publicador — a verdade da ultima publicacao. O verificador de updates
    // compara isto com o vN atual do AVA para saber se a aula envelheceu.
    versaoPagina: versao.versao || "",
    ...pacote
  };
}

export async function obterUrlPublicadorPagina(pagina) {
  if (!pagina?.externalId) {
    return "";
  }

  const versao = await obterUltimaVersaoLo(pagina.externalId);
  return versao?.url || "";
}

export async function obterDadosPublicadorPagina(pagina) {
  // Nem todo HTML vem do publicador versionado. Conteudos novos criados como
  // arquivo unico podem chegar com `external_id = null` e `path` absoluto no
  // backend (ex.: /uploads/lo/arquivo.html). Nesses casos a propria URL da
  // pagina e a fonte online e precisa ser preservada no mapa do player.
  const urlDireta = pagina?.url || pagina?.caminho || "";
  const versao = pagina?.externalId
    ? await obterUltimaVersaoLo(pagina.externalId)
    : urlDireta
      ? { url: urlDireta, versao: "direta" }
      : null;

  if (!versao?.url) {
    return null;
  }

  const chaveCache = pagina?.externalId
    ? chaveDadosPublicador(pagina, versao.versao)
    : `url-direta:${versao.url}`;
  const valorEmCache = lerCacheDadosPublicador(chaveCache);

  if (valorEmCache !== undefined) {
    return valorEmCache;
  }

  if (promessasDadosPublicadorPagina.has(chaveCache)) {
    return promessasDadosPublicadorPagina.get(chaveCache);
  }

  const promessa = (async () => {
    try {
      const conteudoBaixado = await baixarTexto(versao.url);
      const formato = detectarFormato(conteudoBaixado.texto, extrairRecursosHtml(conteudoBaixado.texto));
      const resultado = {
        url: versao.url,
        formato,
        versao: versao.versao
      };

      salvarCacheDadosPublicador(chaveCache, resultado);
      return resultado;
    } catch {
      const resultado = {
        url: versao.url,
        formato: "",
        versao: versao.versao
      };

      salvarCacheDadosPublicador(chaveCache, resultado);
      return resultado;
    }
  })();

  promessasDadosPublicadorPagina.set(chaveCache, promessa);

  try {
    return await promessa;
  } finally {
    promessasDadosPublicadorPagina.delete(chaveCache);
  }
}

async function baixarPaginaPorUrlAntiga(pagina, conteudoId, onProgresso, opcoes = {}) {
  verificarCancelamento(opcoes.cancelToken);

  if ((!pagina?.url && !pagina?.caminho) || pagina.tipoId === 9) {
    return null;
  }

  const caminhoOriginal = pagina.caminho?.startsWith("http") ? pagina.caminho : "";
  const urlsBase = [
    caminhoOriginal,
    montarUrlAulasew(pagina.caminho),
    pagina.url,
    montarUrlArquivo(pagina.caminho)
  ].filter(Boolean);
  const urlsTentativa = Array.from(
    new Set(
      urlsBase.flatMap(url => {
        if (!usandoNativo()) {
          return [url];
        }

        try {
          const urlDownload = new URL(url);
          if (urlDownload.hostname === HOST_CONTEUDOS) {
            urlDownload.protocol = "http:";
            return [urlDownload.toString(), url];
          }
        } catch {
          // Mantem a URL original quando nao for uma URL absoluta valida.
        }

        return [url];
      })
    )
  );
  let conteudoBaixado = null;

  for (const url of urlsTentativa) {
    try {
      conteudoBaixado = {
        url,
        ...(await baixarTexto(url, opcoes))
      };
      break;
    } catch {
      // Tentamos as bases conhecidas do AVA antes de desistir da pagina.
    }
  }

  if (!conteudoBaixado) {
    return null;
  }

  const { texto, tipo, url } = conteudoBaixado;

  if (tipo && !tipo.includes("html") && !texto.trim().startsWith("<")) {
    return null;
  }

  const pacote = await cachearRecursosEmArquivos({
    html: texto,
    urlBase: url,
    conteudoId,
    ordem: pagina.ordem,
    externalId: pagina.externalId || "",
    versao: "",
    pastaBaseConteudo: opcoes.pastaBaseConteudo,
    onProgresso,
    cancelToken: opcoes.cancelToken
  });

  return {
    id: pagina.id,
    ordem: pagina.ordem,
    nome: pagina.nome,
    externalId: pagina.externalId || "",
    urlOriginal: url,
    // Caminho antigo (sem publicador): NAO ha vN a capturar. Fica vazio de
    // proposito — o verificador marca estas como "nao versionavel", nunca como
    // atualizadas.
    versaoPagina: "",
    ...pacote
  };
}

async function baixarPagina(pagina, conteudoId, onProgresso, opcoes = {}) {
  verificarCancelamento(opcoes.cancelToken);

  if (pagina?.externalId) {
    return baixarPaginaPorPublicador(pagina, conteudoId, onProgresso, opcoes);
  }

  return baixarPaginaPorUrlAntiga(pagina, conteudoId, onProgresso, opcoes);
}

export async function obterUrlLocalPagina(paginaOffline) {
  if (!paginaOffline?.caminhoIndex) {
    return "";
  }

  return obterUrlArquivoLocal(paginaOffline.caminhoIndex);
}

export async function pacoteOfflineDisponivel(pacoteOffline) {
  const paginas = pacoteOffline?.paginas || [];

  if (!paginas.length) {
    return false;
  }

  for (const pagina of paginas) {
    if (!pagina?.caminhoIndex || !(await arquivoExiste(pagina.caminhoIndex))) {
      return false;
    }
  }

  return true;
}

export async function baixarPacoteConteudo(detalhes, onProgresso, opcoes = {}) {
  const conteudoId = String(detalhes?.id || "");

  if (aulaInteiraIndisponivelOffline(detalhes)) {
    console.warn(
      `${LOG_DOWNLOAD} PACOTE_INDISPONIVEL conteudo=${conteudoId} convertido=${detalhes?.convertido || ""}`
    );
    throw new Error(MENSAGEM_AULA_INDISPONIVEL_OFFLINE);
  }

  const paginas = detalhes?.paginas?.length
    ? detalhes.paginas
    : detalhes?.caminho
      ? [
          {
            id: detalhes.id,
            externalId: detalhes.externalId || "",
            ordem: 1,
            nome: detalhes.nome,
            caminho: detalhes.caminho,
            url: detalhes.caminho?.startsWith("http")
              ? detalhes.caminho
              : montarUrlAulasew(detalhes.caminho)
          }
        ]
      : [];

  const paginasOffline = [];
  const paginasNaoSuportadas = [];
  const paginasComErro = [];

  emitirProgresso(onProgresso, 0);

  for (const [indicePagina, pagina] of paginas.entries()) {
    verificarCancelamento(opcoes.cancelToken);

    const pesoPagina = paginas.length ? 100 / paginas.length : 100;
    const progressoPagina = percentualPagina => {
      emitirProgresso(onProgresso, indicePagina * pesoPagina + (limitarPercentual(percentualPagina) / 100) * pesoPagina);
    };
    const identificadorPagina = `ordem=${pagina.ordem} id=${pagina.id || ""} externalId=${pagina.externalId || ""}`;

    try {
      console.info(`${LOG_DOWNLOAD} PAGINA_INICIO ${identificadorPagina}`);
      const pacotePagina = await baixarPagina(pagina, conteudoId, progressoPagina, opcoes);

      if (pacotePagina) {
        paginasOffline.push(pacotePagina);
        console.info(`${LOG_DOWNLOAD} PAGINA_FIM ${identificadorPagina} recursos=${pacotePagina.quantidadeRecursos || 0}`);
      } else {
        paginasNaoSuportadas.push({
          id: pagina.id,
          ordem: pagina.ordem,
          nome: pagina.nome,
          externalId: pagina.externalId || "",
          motivo: "Formato nao disponivel offline."
        });
        console.warn(`${LOG_DOWNLOAD} PAGINA_INDISPONIVEL ${identificadorPagina} motivo=Formato nao disponivel offline.`);
      }
    } catch (erro) {
      if (downloadFoiCancelado(erro)) {
        await removerDiretorioSeExistir(
          opcoes.pastaBaseConteudo || `${PASTA_CONTEUDOS_OFFLINE}/${normalizarCaminhoArquivo(conteudoId)}`
        );
        throw erro;
      }

      paginasComErro.push({
        id: pagina.id,
        ordem: pagina.ordem,
        nome: pagina.nome,
        externalId: pagina.externalId || "",
        motivo: erro?.message || "Falha ao preparar pagina offline."
      });
      console.warn(`${LOG_DOWNLOAD} PAGINA_ERRO ${identificadorPagina} motivo=${erro?.message || "erro desconhecido"}`);
    }

    emitirProgresso(onProgresso, (indicePagina + 1) * pesoPagina);
  }

  if (paginasComErro.length) {
    const resumoFalhas = paginasComErro
      .map(pagina => `pagina ${pagina.ordem}: ${pagina.motivo}`)
      .join("; ");

    console.warn(`${LOG_DOWNLOAD} PACOTE_ERRO conteudo=${conteudoId} falhas=${resumoFalhas}`);
    throw new Error(`Não foi possível salvar todas as páginas offline. ${resumoFalhas}`);
  }

  if (paginasNaoSuportadas.length) {
    const resumoFalhas = paginasNaoSuportadas
      .map(pagina => `pagina ${pagina.ordem}: ${pagina.motivo}`)
      .join("; ");

    console.warn(`${LOG_DOWNLOAD} PACOTE_INCOMPLETO conteudo=${conteudoId} falhas=${resumoFalhas}`);
  }

  if (!paginasOffline.length) {
    console.warn(`${LOG_DOWNLOAD} PACOTE_INDISPONIVEL conteudo=${conteudoId} motivo=nenhuma_pagina_suportada`);
    throw new Error(MENSAGEM_AULA_INDISPONIVEL_OFFLINE);
  }

  return {
    versao: 3,
    conteudoId,
    publicadorId: detalhes?.externalId || "",
    totalPaginas: paginas.length,
    baixadoEm: new Date().toISOString(),
    armazenamento: usandoNativo() ? "servidor-local" : "arquivos",
    pastaBaseConteudo: opcoes.pastaBaseConteudo || `${PASTA_CONTEUDOS_OFFLINE}/${normalizarCaminhoArquivo(conteudoId)}`,
    paginas: paginasOffline.sort((a, b) => Number(a.ordem) - Number(b.ordem)),
    paginasNaoSuportadas
  };
}
