// Normalizacao das paginas/LOs de um conteudo — portada de
// `api/normalizacaoConteudoApi.js` do PWA (logica pura, sem navegador).
//
// Transforma a resposta crua de listLosLos/singleView no formato que
// `pacoteConteudo.baixarPacoteConteudo` espera: paginas com
// {id, externalId, ordem, tipoId, convertido, caminho, url}.
//
// Mantida fiel ao PWA de proposito: a mesma priorizacao/deduplicacao garante que
// o downloader escolha exatamente a mesma pagina que o aluno veria.

import { montarUrlArquivo, obterBaseConteudosAulasew } from "./origensRemotas.js";

function normalizarTexto(valor = "") {
  return String(valor || "").trim();
}

function normalizarConvertido(valor) {
  return normalizarTexto(valor).toUpperCase() || null;
}

export function normalizarUrlConteudoBruta(caminho) {
  if (!caminho) {
    return "";
  }

  const texto = String(caminho);

  if (texto.startsWith("http")) {
    // Em Node nao ha proxy; a URL absoluta conhecida ja e a final.
    return texto;
  }

  const caminhoLimpo = texto.replace(/^\/+/, "");

  if (caminhoLimpo.startsWith("aulasew/")) {
    return new URL(caminhoLimpo.slice("aulasew/".length), obterBaseConteudosAulasew()).toString();
  }

  return montarUrlArquivo(caminhoLimpo);
}

function prioridadePagina(pagina) {
  const convertido = normalizarConvertido(pagina?.convertido);
  const tipoId = Number(pagina?.tipoId || 0);
  const released = pagina?.released !== false;

  return [
    released ? 1 : 0,
    convertido === "SIM" ? 2 : convertido === "VALBERTO" ? 1 : 0,
    tipoId === 1 ? 2 : tipoId > 0 ? 1 : 0,
    pagina?.url ? 1 : 0
  ];
}

function compararPrioridadePagina(a, b) {
  const prioridadeA = prioridadePagina(a);
  const prioridadeB = prioridadePagina(b);

  for (let indice = 0; indice < prioridadeA.length; indice += 1) {
    if (prioridadeA[indice] !== prioridadeB[indice]) {
      return prioridadeB[indice] - prioridadeA[indice];
    }
  }

  const tipoA = Number(a?.tipoId || Number.MAX_SAFE_INTEGER);
  const tipoB = Number(b?.tipoId || Number.MAX_SAFE_INTEGER);
  if (tipoA !== tipoB) {
    return tipoA - tipoB;
  }

  const idA = Number(a?.id || Number.MAX_SAFE_INTEGER);
  const idB = Number(b?.id || Number.MAX_SAFE_INTEGER);
  return idA - idB;
}

function chavePaginaNormalizada(pagina) {
  const ordem = Number(pagina?.ordem || 0);
  const externalId = normalizarTexto(pagina?.externalId);
  const url = normalizarTexto(pagina?.url);
  const caminho = normalizarTexto(pagina?.caminho);
  const nome = normalizarTexto(pagina?.nome).toLowerCase();

  return [ordem, externalId, url, caminho, nome].join("|");
}

function removerPaginasDuplicadas(paginas = []) {
  const porChave = new Map();

  for (const pagina of paginas) {
    const chave = chavePaginaNormalizada(pagina);
    const atual = porChave.get(chave);

    if (!atual || compararPrioridadePagina(pagina, atual) < 0) {
      porChave.set(chave, pagina);
    }
  }

  return Array.from(porChave.values()).sort((a, b) => {
    const ordemA = Number(a?.ordem || 0);
    const ordemB = Number(b?.ordem || 0);

    if (ordemA !== ordemB) {
      return ordemA - ordemB;
    }

    return compararPrioridadePagina(a, b);
  });
}

function paginaValida(pagina) {
  return Boolean(pagina && (pagina.url || pagina.caminho || pagina.externalId || pagina.id));
}

function normalizarPagina(pagina, indice = 0) {
  return {
    id: String(pagina?.id || indice + 1),
    externalId: String(pagina?.external_id || pagina?.externalId || ""),
    nome: pagina?.name || pagina?.nome || `Pagina ${indice + 1}`,
    ordem: Number(pagina?.order || pagina?.ordem || indice + 1),
    tipoId: pagina?.type_id || pagina?.tipoId || null,
    convertido: normalizarConvertido(pagina?.converted || pagina?.convertido),
    caminho: pagina?.path || pagina?.caminho || "",
    url: normalizarUrlConteudoBruta(pagina?.path || pagina?.url || pagina?.caminho || ""),
    released: pagina?.released
  };
}

function construirPaginaUnica(dados, singleView, conteudo) {
  const caminho = singleView?.path || dados?.path || conteudo?.caminho || "";
  const externalId = singleView?.external_id || dados?.external_id || conteudo?.externalId || "";

  if (!caminho && !externalId) {
    return [];
  }

  return [
    normalizarPagina(
      {
        id: dados?.id || singleView?.id || conteudo?.id,
        external_id: externalId,
        name: dados?.name || singleView?.name || conteudo?.nome || "Conteudo",
        order: 1,
        type_id: dados?.type_id || singleView?.type_id || conteudo?.tipoId || null,
        converted: dados?.converted || singleView?.converted || conteudo?.convertido || null,
        path: caminho,
        released: dados?.released ?? singleView?.released ?? true
      },
      0
    )
  ];
}

// Recebe as respostas cruas de listLosLos (resposta) e singleView e devolve os
// detalhes normalizados prontos para baixarPacoteConteudo.
export function normalizarDetalhesConteudo(resposta, conteudo, singleView) {
  const dados = Array.isArray(resposta?.data) ? resposta.data[0] : resposta?.data || {};
  const paginasBrutas = Array.isArray(dados?.children) ? dados.children : [];
  const paginasNormalizadas = paginasBrutas.map(normalizarPagina).filter(paginaValida);
  const paginas = removerPaginasDuplicadas(
    paginasNormalizadas.length ? paginasNormalizadas : construirPaginaUnica(dados, singleView, conteudo)
  );
  const convertido = normalizarConvertido(dados?.converted || singleView?.converted || conteudo?.convertido);
  const tipoId = dados?.type_id || singleView?.type_id || conteudo?.tipoId || null;
  const caminho = normalizarUrlConteudoBruta(singleView?.path || dados?.path || conteudo?.caminho || "");
  const tipoFluxo =
    convertido === "VALBERTO"
      ? "valberto"
      : paginas.length
        ? "html-convertido"
        : caminho
          ? "midia-direta"
          : "indisponivel";

  return {
    id: String(dados?.id || singleView?.id || conteudo?.id),
    externalId: String(dados?.external_id || singleView?.external_id || conteudo?.externalId || ""),
    nome: dados?.name || singleView?.name || conteudo?.nome || "Conteudo",
    resumo: dados?.resume || singleView?.resume || "",
    objetivo: dados?.objective || singleView?.objective || "",
    convertido,
    tipoId,
    caminho,
    tipoFluxo,
    paginas
  };
}
