// Orquestrador de download de UM conteudo, compartilhado pelo CLI e pelo servidor.
//
// Junta as tres pecas: busca as paginas na API do AVA, normaliza como o PWA faz,
// e chama o downloader do nucleo. Ao terminar, grava um indice.json no acervo com
// o formato detectado de cada pagina — e daqui que sai a coluna "tipo" da
// listagem, como efeito do download (decisao do usuario: formato so apos baixar).

import path from "node:path";
import { promises as fs } from "node:fs";
import { zipSync } from "fflate";
import { listarPaginas, verConteudo } from "./avaApi.js";
import { normalizarDetalhesConteudo } from "../nucleo-conteudo/normalizacaoPaginas.js";
import { baixarPacoteConteudo } from "../nucleo-conteudo/pacoteConteudo.js";
import { obterRaizAcervo } from "../adaptadores/fsAcervo.js";
import { PASTA_CONTEUDOS_OFFLINE } from "../nucleo-conteudo/constantes.js";
import { normalizarCaminhoArquivo } from "../nucleo-conteudo/caminhos.js";
import { gerarManifesto, mesclarManifestoR2 } from "./manifesto.js";
import { r2Configurado, subirObjeto } from "./r2Cliente.js";

// Le a arvore de uma pasta como { "caminho/rel": Uint8Array } — para zipar.
async function lerArvore(base) {
  const arquivos = {};
  async function andar(dir, prefixo) {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      const rel = prefixo ? `${prefixo}/${e.name}` : e.name;
      if (e.isDirectory()) await andar(abs, rel);
      else arquivos[rel] = new Uint8Array(await fs.readFile(abs));
    }
  }
  await andar(base, "");
  return arquivos;
}

// Baixa a miniatura do card (imagem remota do catalogo) para dentro do pacote,
// como thumb.<ext>. Devolve o caminho LOGICO (offline-conteudos/<id>/thumb.<ext>)
// para o indice, ou "" se nao houver imagem / falhar (o card cai no fallback).
// Best-effort: nunca derruba o download por causa da miniatura.
async function baixarMiniatura(urlImagem, pastaAbs, id) {
  const url = String(urlImagem || "").trim();
  if (!url || !/^https?:\/\//i.test(url)) return "";
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) return "";
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length) return "";
    // Extensao pelo content-type ou pela URL; default png.
    const tipo = r.headers.get("content-type") || "";
    const ext =
      /jpe?g/i.test(tipo) || /\.jpe?g(?:[?#]|$)/i.test(url) ? "jpg"
      : /webp/i.test(tipo) || /\.webp(?:[?#]|$)/i.test(url) ? "webp"
      : /gif/i.test(tipo) || /\.gif(?:[?#]|$)/i.test(url) ? "gif"
      : "png";
    const nome = `thumb.${ext}`;
    await fs.writeFile(path.join(pastaAbs, nome), buf);
    return `${PASTA_CONTEUDOS_OFFLINE}/${id}/${nome}`;
  } catch {
    return ""; // rede/timeout: card usa fallback, nao e fatal
  }
}

// Zipa a pasta do conteudo (nome = ID) EM MEMORIA e APAGA a pasta descompactada.
// Devolve os bytes do zip — o chamador decide o destino (R2 ou disco). A pasta
// descompactada e sempre temporaria; o acervo guarda so o zip.
async function ziparEApagarPasta(pastaAbs, id) {
  const arvore = await lerArvore(pastaAbs);
  const zip = zipSync(arvore, { level: 6 });
  await fs.rm(pastaAbs, { recursive: true, force: true });
  return { arquivoZip: `${id}.zip`, zip };
}

// Nome da pasta do conteudo no acervo: "Nome da aula [ID]".
//
// O ID no fim garante unicidade (dois conteudos podem ter o mesmo nome; o id
// nunca colide) e mantem legivel. Sanitiza para nome de pasta do Windows:
//   - troca os proibidos (< > : " / \ | ? *) por espaco;
//   - colapsa espacos e apara;
//   - corta nomes muito longos (limite pratico de caminho no Windows).
// Acentos sao preservados (o NTFS aceita). NAO passa por normalizarCaminhoArquivo
// aqui porque aquele parte em "/" — a sanitizacao tem de achatar o nome antes.
export function nomePastaConteudo(nome, id) {
  const limpo = String(nome || "Conteudo")
    .replace(/[<>:"/\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .trim();
  return `${limpo || "Conteudo"} [${id}]`;
}

// Caminho-base (logico) do pacote dentro do acervo, usado no download e na
// gravacao/leitura do indice. Fonte unica para os tres concordarem.
export function pastaBaseDoConteudo(nome, id) {
  return `${PASTA_CONTEUDOS_OFFLINE}/${nomePastaConteudo(nome, id)}`;
}

// Consolida o formato do conteudo a partir das paginas baixadas. Um conteudo
// pode misturar formatos (SPEC 3.3), entao guardamos o conjunto e um rotulo
// principal (o formato da 1a pagina suportada) para exibir na coluna.
function resumirFormato(pacote) {
  const formatos = (pacote?.paginas || [])
    .map(p => p.formato)
    .filter(Boolean);
  const unicos = [...new Set(formatos)];

  return {
    principal: unicos[0] || "desconhecido",
    todos: unicos
  };
}

// Monta a secao de classificacao do indice a partir dos metadados REAIS do
// catalogo (serie/segmento/disciplina/habilidade). Um conteudo pode pertencer a
// varias series — por isso `classificacoes` e uma lista. Exportada para a
// reindexacao reusar a mesma forma.
export function montarClassificacao(metadadosCatalogo) {
  const classificacoes = (metadadosCatalogo?.classificacoes || []).filter(
    c => c && (c.serieId != null || c.segmentoId != null)
  );
  return {
    tipoId: metadadosCatalogo?.tipoId ?? null,
    disciplinaId: metadadosCatalogo?.disciplinaId ?? null,
    disciplina: metadadosCatalogo?.disciplina || "",
    habilidade: metadadosCatalogo?.habilidade || "",
    imagem: metadadosCatalogo?.imagem || "",
    classificacoes,
    // Listas achatadas, uteis para filtrar/agrupar sem varrer o array.
    seriesIds: [...new Set(classificacoes.map(c => c.serieId).filter(v => v != null))],
    segmentosIds: [...new Set(classificacoes.map(c => c.segmentoId).filter(v => v != null))]
  };
}

async function gravarIndiceAcervo(detalhes, pacote, { filtrosOrigem, metadadosCatalogo, pastaBaseLogica, iconeCaminhoLogico }) {
  const pasta = path.join(obterRaizAcervo(), normalizarCaminhoArquivo(pastaBaseLogica));
  await fs.mkdir(pasta, { recursive: true });

  const formato = resumirFormato(pacote);
  const classificacao = montarClassificacao(metadadosCatalogo);
  const indice = {
    id: detalhes.id,
    externalId: detalhes.externalId,
    nome: detalhes.nome,
    convertido: detalhes.convertido,
    tipoFluxo: detalhes.tipoFluxo,
    formato: formato.principal,
    formatos: formato.todos,
    totalPaginas: pacote.totalPaginas,
    paginasBaixadas: pacote.paginas.length,
    paginasNaoSuportadas: pacote.paginasNaoSuportadas || [],
    // Classificacao REAL do catalogo (nao o filtro da tela).
    tipoId: classificacao.tipoId,
    disciplinaId: classificacao.disciplinaId,
    disciplina: classificacao.disciplina,
    habilidade: classificacao.habilidade,
    // O card do PWA le `habilidadeCodigo` e `icone`.
    habilidadeCodigo: classificacao.habilidade,
    // `icone` = URL remota (fallback online). `iconeCaminho` = arquivo local no
    // pacote (o semeador monta a URL servivel a partir dele, para funcionar offline).
    icone: classificacao.imagem,
    iconeCaminho: iconeCaminhoLogico || "",
    classificacoes: classificacao.classificacoes,
    seriesIds: classificacao.seriesIds,
    segmentosIds: classificacao.segmentosIds,
    // Mantidos por compatibilidade: o filtro que estava ativo (pode ser null).
    serie: filtrosOrigem?.serie ?? null,
    segment: filtrosOrigem?.segment ?? null,
    baixadoEm: pacote.baixadoEm,
    // Impressao digital de versao do conteudo: mapa externalId -> vN publicado
    // (ex.: "12345_v9") de cada pagina que veio do publicador. E isto que o
    // verificador compara com o AVA para saber se a aula envelheceu. Paginas do
    // caminho antigo (sem externalId/vN) nao entram aqui — sao "nao versionaveis".
    versoes: Object.fromEntries(
      pacote.paginas
        .filter(p => p.externalId && p.versaoPagina)
        .map(p => [String(p.externalId), p.versaoPagina])
    ),
    paginas: pacote.paginas.map(p => ({
      ordem: p.ordem,
      nome: p.nome,
      externalId: p.externalId,
      formato: p.formato,
      bytes: p.bytes,
      // vN publicado usado nesta pagina ("" quando veio do caminho antigo).
      versaoPagina: p.versaoPagina || ""
    }))
  };

  await fs.writeFile(
    path.join(pasta, "indice.json"),
    JSON.stringify(indice, null, 2),
    "utf-8"
  );

  return indice;
}

// Baixa um conteudo por ID. `filtrosOrigem` (serie/segment) e so metadado para o
// indice — nao afeta o download. `paginas` opcional restringe a quais ordens
// baixar (para "baixar so algumas paginas").
export async function baixarConteudo({
  token,
  conteudoId,
  onProgresso = () => {},
  filtrosOrigem = null,
  metadadosCatalogo = null,
  ordensDesejadas = null,
  cancelToken = null
}) {
  // 1. Buscar paginas e metadados na API (as duas chamadas que o PWA faz).
  const [respostaPaginas, respostaSingle] = await Promise.all([
    listarPaginas(token, conteudoId),
    verConteudo(token, conteudoId).catch(() => null)
  ]);

  const singleView = respostaSingle?.data?.los || respostaSingle?.data || null;

  // 2. Normalizar como o PWA (mesma priorizacao/deduplicacao de paginas).
  const detalhes = normalizarDetalhesConteudo(respostaPaginas, { id: conteudoId }, singleView);

  // 3. Se o usuario pediu paginas especificas, filtrar por ordem.
  if (Array.isArray(ordensDesejadas) && ordensDesejadas.length) {
    const alvo = new Set(ordensDesejadas.map(Number));
    detalhes.paginas = detalhes.paginas.filter(p => alvo.has(Number(p.ordem)));
  }

  // Pasta legivel "Nome da aula [ID]" — fonte unica para download e indice.
  const pastaBaseLogica = pastaBaseDoConteudo(detalhes.nome, detalhes.id);

  // 4. Baixar (o nucleo detecta formato e grava no acervo).
  const pacote = await baixarPacoteConteudo(detalhes, onProgresso, {
    cancelToken,
    pastaBaseConteudo: pastaBaseLogica
  });

  const pastaAbs = path.join(obterRaizAcervo(), normalizarCaminhoArquivo(pastaBaseLogica));

  // 5.5. Baixa a MINIATURA do card (icone remoto do catalogo) para dentro do
  //      pacote, para funcionar offline. Sem isso, o card fica sem imagem sem rede.
  const iconeCaminhoLogico = await baixarMiniatura(
    metadadosCatalogo?.imagem,
    pastaAbs,
    detalhes.id
  );

  // 6. Indice do acervo. Passa o caminho LOCAL da miniatura (se baixou).
  const indice = await gravarIndiceAcervo(detalhes, pacote, {
    filtrosOrigem,
    metadadosCatalogo,
    pastaBaseLogica,
    iconeCaminhoLogico
  });

  // 7. Empacota em .zip (nome = ID) e apaga a pasta descompactada.
  const { arquivoZip, zip } = await ziparEApagarPasta(pastaAbs, detalhes.id);
  const bytesZip = zip.length;
  const versaoSemente = Number(process.env.ACERVO_VERSAO_SEMENTE || 1);

  // 8. Destino do zip + manifesto:
  //    - R2 configurado -> sobe o zip e ATUALIZA o manifesto de forma INCREMENTAL:
  //      baixa o manifesto atual (JSON pequeno), mescla SO este item (o `indice` ja
  //      esta em memoria) e sobe. Nao rele os zips do bucket — era isso que fazia o
  //      download "travar no 100%" (>1min relendo 110 zips).
  //    - senao -> grava em disco e regenera o manifesto local (comportamento antigo).
  //    Best-effort: uma falha aqui nao derruba o download ja concluido.
  if (r2Configurado()) {
    await subirObjeto(arquivoZip, zip, "application/zip").catch(e =>
      console.warn(`[AVA_DOWNLOAD] R2 falhou ao subir ${arquivoZip}: ${e.message}`)
    );
    try {
      await mesclarManifestoR2([{ indice, arquivo: arquivoZip, bytesZip }]);
    } catch (e) {
      console.warn(`[AVA_DOWNLOAD] R2 falhou ao atualizar manifesto: ${e.message}`);
    }
  } else {
    const dirConteudos = path.join(obterRaizAcervo(), PASTA_CONTEUDOS_OFFLINE);
    await fs.mkdir(dirConteudos, { recursive: true }).catch(() => {});
    await fs.writeFile(path.join(dirConteudos, arquivoZip), zip).catch(e =>
      console.warn(`[AVA_DOWNLOAD] falha ao gravar ${arquivoZip} em disco: ${e.message}`)
    );
    await gerarManifesto(dirConteudos, { versaoSemente, silencioso: true }).catch(() => {});
  }

  return { detalhes, pacote, indice, arquivoZip, bytesZip };
}
