// Varredura de catalogo para download em massa.
//
// Diferenca central em relacao ao PWA: o aluno pagina de 16 em 16; a ferramenta
// precisa da lista INTEIRA que casa o filtro, para marcar-todos e baixar em massa.
// Entao aqui paginamos ate o fim (meta.last_page) e acumulamos.
//
// Dois cuidados de corretude do backend (verificados no controller Laravel):
//   - a resposta agrupa por runs de type_id em data[*].content[*] — iteramos
//     todos os buckets, nunca assumimos um por tipo;
//   - DISTINCT sobre a linha inteira duplica LO ligado a varias series, e
//     meta.total vem inflado — deduplicamos por id.

import { listarBiblioteca } from "./avaApi.js";

function achatarItens(resposta) {
  const data = Array.isArray(resposta?.data) ? resposta.data : [];
  const itens = [];
  for (const bucket of data) {
    for (const lo of bucket?.content || []) {
      itens.push(lo);
    }
  }
  return itens;
}

function normalizarItem(lo) {
  const convertido = String(lo?.converted || "").toUpperCase() || null;
  // Motivo de indisponibilidade que o backend ja entrega, antes de baixar.
  // NAO = Flash/AS2 legado; VALBERTO = aula convertida (HTML5, baixavel).
  const motivoIndisponivel =
    convertido === "NAO" ? "Flash (nao disponivel offline)" : null;

  const classificacao = {
    serieId: lo?.serie_id ?? null,
    serieNome: lo?.serie_name || "",
    segmentoId: lo?.segment_id ?? null,
    segmentoNome: lo?.segment_name || ""
  };

  return {
    id: String(lo?.id),
    nome: lo?.name || lo?.title || "(sem nome)",
    tipoId: lo?.type_id ?? null,
    tipoNome: lo?.type_name || "",
    convertido,
    // Disciplina por ID (estavel) E nome (exibicao). Filtrar por id e mais robusto
    // que por nome — nome se repete/varia (mesma licao da homonimia de aulas).
    disciplinaId: lo?.discipline_id ?? null,
    disciplina: lo?.discipline_name || "",
    // Um conteudo pode estar em varias series/segmentos (o DISTINCT do backend o
    // repete por serie). Guardamos TODAS as classificacoes em que ele apareceu.
    classificacoes: [classificacao],
    // Campos singulares para o front atual — a 1a classificacao.
    serieId: classificacao.serieId,
    serieNome: classificacao.serieNome,
    segmentoId: classificacao.segmentoId,
    segmentoNome: classificacao.segmentoNome,
    habilidade: lo?.ability_code || "",
    imagem: lo?.image || "",
    motivoIndisponivel,
    // formato tecnico (Construct 2/3, Animate) so e conhecido apos baixar
    formato: null
  };
}

// Chave para nao repetir a mesma (serie,segmento) na lista de classificacoes.
function chaveClassificacao(c) {
  return `${c.segmentoId ?? ""}|${c.serieId ?? ""}`;
}

// Varre TODAS as paginas do filtro e devolve a lista completa, deduplicada por id.
// `porPagina` alto reduz idas ao backend; `limitePaginas` e uma trava de seguranca.
export async function varrerCatalogo(token, filtros = {}, { porPagina = 100, limitePaginas = 200 } = {}) {
  const porId = new Map();
  let pagina = 1;
  let ultimaPagina = 1;
  let paginasLidas = 0;

  do {
    const resposta = await listarBiblioteca(token, { ...filtros, pagina, porPagina });
    const meta = resposta?.meta || null;
    ultimaPagina = Number(meta?.last_page || 1);

    for (const lo of achatarItens(resposta)) {
      const item = normalizarItem(lo);
      if (!item.id) continue;
      const existente = porId.get(item.id);
      if (!existente) {
        porId.set(item.id, item);
      } else {
        // Ja visto: acumula a classificacao (serie/segmento) se for nova.
        const nova = item.classificacoes[0];
        const jaTem = existente.classificacoes.some(
          c => chaveClassificacao(c) === chaveClassificacao(nova)
        );
        if (!jaTem) existente.classificacoes.push(nova);
      }
    }

    paginasLidas += 1;
    pagina += 1;
  } while (pagina <= ultimaPagina && paginasLidas < limitePaginas);

  const itens = [...porId.values()];
  const truncado = paginasLidas >= limitePaginas && pagina <= ultimaPagina;

  return {
    itens,
    total: itens.length,
    paginasLidas,
    ultimaPagina,
    // Sem silenciar corte: se a trava pegou, o front avisa em vez de fingir
    // que cobriu tudo (SPEC: no silent caps).
    truncado
  };
}
