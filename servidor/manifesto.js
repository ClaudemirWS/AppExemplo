// Geracao do manifesto.json da pasta de conteudos.
//
// Le o indice.json de dentro de cada .zip e monta o manifesto que o PWA consome.
// Compartilhado entre o exportador (npm run exportar, reconstruir do zero) e o
// DOWNLOAD (que chama isto ao fim de cada conteudo, para o manifesto ficar sempre
// coerente com os zips — sem passo manual). Escreve manifesto.json na propria pasta.

import { promises as fs } from "node:fs";
import path from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { r2Configurado, listarNomes, lerObjeto, subirObjeto } from "./r2Cliente.js";
import { obterRaizAcervo } from "../adaptadores/fsAcervo.js";

function indiceDeBytes(bytes) {
  const arq = unzipSync(new Uint8Array(bytes), { filter: f => f.name === "indice.json" });
  if (!arq["indice.json"]) throw new Error("indice.json ausente");
  return JSON.parse(strFromU8(arq["indice.json"]));
}

async function lerIndiceDoZip(caminhoZip) {
  return indiceDeBytes(await fs.readFile(caminhoZip));
}

// Monta UM item do manifesto a partir do indice.json de um conteudo. Fonte unica —
// usada pela geracao a partir do disco E do R2. Alem dos campos que o PWA le, carrega
// os 5 que a ABA ACERVO do downloader precisa e que antes ficavam so no indice.json:
// externalId (aula-pai), convertido, paginasBaixadas, paginasNaoSuportadas, paginas[].
// Sao aditivos: o PWA ignora o que nao usa.
export function montarItemManifesto(indice, arquivo, bytesZip, tipoIdPadrao = 1) {
  return {
    id: String(indice.id),
    arquivo,
    nome: indice.nome,
    tipoId: indice.tipoId ?? tipoIdPadrao,
    habilidadeCodigo: indice.habilidadeCodigo || indice.habilidade || "",
    icone: indice.icone || "",
    iconeCaminho: indice.iconeCaminho || "",
    disciplinaId: indice.disciplinaId ?? null,
    disciplina: indice.disciplina || "",
    formato: indice.formato,
    formatos: indice.formatos,
    seriesIds: indice.seriesIds || [],
    segmentosIds: indice.segmentosIds || [],
    classificacoes: indice.classificacoes || [],
    totalPaginas: indice.totalPaginas,
    // Impressao digital de versao (externalId -> "id_vN").
    versoes: indice.versoes || {},
    // Campos que a aba Acervo do downloader le (identidade, versao/pagina, faltantes):
    externalId: indice.externalId || "",
    convertido: indice.convertido || null,
    paginasBaixadas: indice.paginasBaixadas ?? (indice.paginas || []).length,
    paginasNaoSuportadas: indice.paginasNaoSuportadas || [],
    paginas: indice.paginas || [],
    bytesZip
  };
}

function montarManifesto(conteudos, versaoSemente, serieFiltro) {
  return {
    versaoSemente,
    geradoEm: new Date().toISOString(),
    serie: serieFiltro,
    total: conteudos.length,
    conteudos
  };
}

// Gera e grava o manifesto da pasta. Opcoes:
//   versaoSemente (default 1), serieFiltro (null), tipoIdPadrao (1=Aula),
//   silencioso (nao loga cada item).
// Devolve o objeto manifesto.
export async function gerarManifesto(dirConteudos, opcoes = {}) {
  const {
    versaoSemente = Number(process.env.ACERVO_VERSAO_SEMENTE || 1),
    serieFiltro = null,
    tipoIdPadrao = 1,
    silencioso = false
  } = opcoes;

  let arquivos;
  try {
    arquivos = (await fs.readdir(dirConteudos)).filter(n => n.endsWith(".zip"));
  } catch {
    return null; // pasta ainda nao existe
  }

  const conteudos = [];
  for (const arquivo of arquivos.sort()) {
    let indice;
    try {
      indice = await lerIndiceDoZip(path.join(dirConteudos, arquivo));
    } catch {
      if (!silencioso) console.warn(`  manifesto: pulado (zip sem indice.json): ${arquivo}`);
      continue;
    }
    if (serieFiltro && !(indice.seriesIds || []).includes(serieFiltro)) continue;

    const stat = await fs.stat(path.join(dirConteudos, arquivo));
    conteudos.push(montarItemManifesto(indice, arquivo, stat.size, tipoIdPadrao));
    if (!silencioso) console.log(`  ${arquivo}  (${(stat.size / 1024 / 1024).toFixed(1)} MB)  ${indice.nome}`);
  }

  const manifesto = montarManifesto(conteudos, versaoSemente, serieFiltro);
  await fs.writeFile(
    path.join(dirConteudos, "manifesto.json"),
    JSON.stringify(manifesto, null, 2),
    "utf-8"
  );
  return manifesto;
}

// Gera o manifesto lendo os zips que estao NO BUCKET R2 (nao no disco) e o DEVOLVE —
// nao sobe (quem sobe e o chamador, que ja tem o cliente). Le a lista real de objetos
// (listarNomes) e o indice.json de cada zip; assim o manifesto sempre reflete o que
// esta de fato no bucket, mesmo que um upload anterior tenha falhado no meio.
export async function gerarManifestoR2(opcoes = {}) {
  const {
    versaoSemente = Number(process.env.ACERVO_VERSAO_SEMENTE || 1),
    serieFiltro = null,
    tipoIdPadrao = 1,
    silencioso = false
  } = opcoes;

  if (!r2Configurado()) throw new Error("R2 nao configurado.");

  const zips = (await listarNomes()).filter(n => n.endsWith(".zip")).sort();
  const conteudos = [];
  for (const arquivo of zips) {
    let bytes;
    let indice;
    try {
      bytes = await lerObjeto(arquivo);
      indice = indiceDeBytes(bytes);
    } catch {
      if (!silencioso) console.warn(`  manifesto R2: pulado (zip sem indice.json): ${arquivo}`);
      continue;
    }
    if (serieFiltro && !(indice.seriesIds || []).includes(serieFiltro)) continue;
    conteudos.push(montarItemManifesto(indice, arquivo, bytes.length, tipoIdPadrao));
  }

  return montarManifesto(conteudos, versaoSemente, serieFiltro);
}

// --- Manifesto INCREMENTAL no R2 (rapido: nao rele os zips do bucket) ---------
//
// O `gerarManifestoR2` acima baixa TODOS os zips inteiros so para ler o indice de
// cada um — mais de 1 min com 110 zips, e roda a cada download (o "trava no 100%").
// As funcoes abaixo evitam isso: baixam o manifesto atual (um JSON pequeno),
// mesclam/removem so o que mudou na rodada, e sobem. O indice de cada item baixado
// ja esta em memoria (o download acabou de te-lo), entao nao precisa reler zip nenhum.

// Le o manifesto atual do bucket; se nao existir, devolve um manifesto vazio.
export async function lerManifestoR2() {
  if (!r2Configurado()) throw new Error("R2 nao configurado.");
  try {
    const bytes = await lerObjeto("manifesto.json");
    const m = JSON.parse(bytes.toString("utf-8"));
    if (!Array.isArray(m.conteudos)) m.conteudos = [];
    return m;
  } catch {
    return montarManifesto([], Number(process.env.ACERVO_VERSAO_SEMENTE || 1), null);
  }
}

// Mescla `itens` (cada um: {indice, arquivo, bytesZip}) no manifesto existente do R2 e
// sobe. Um item com id ja presente e SUBSTITUIDO (rebaixou por cima); id novo e
// acrescentado. Devolve o manifesto resultante. Nao rele nenhum zip.
export async function mesclarManifestoR2(itens, opcoes = {}) {
  const { tipoIdPadrao = 1 } = opcoes;
  const manifesto = await lerManifestoR2();
  const porId = new Map(manifesto.conteudos.map(c => [String(c.id), c]));

  for (const { indice, arquivo, bytesZip } of itens) {
    porId.set(String(indice.id), montarItemManifesto(indice, arquivo, bytesZip, tipoIdPadrao));
  }

  const conteudos = [...porId.values()].sort((a, b) => String(a.arquivo).localeCompare(String(b.arquivo)));
  const novo = montarManifesto(conteudos, manifesto.versaoSemente, manifesto.serie ?? null);
  await subirObjeto("manifesto.json", Buffer.from(JSON.stringify(novo, null, 2)), "application/json");
  return novo;
}

// Remove o conteudo `id` do manifesto do R2 e sobe. Usada pelo DELETE — nao rele zips.
export async function removerDoManifestoR2(id) {
  const manifesto = await lerManifestoR2();
  const alvo = String(id);
  const conteudos = manifesto.conteudos.filter(c => String(c.id) !== alvo);
  const novo = montarManifesto(conteudos, manifesto.versaoSemente, manifesto.serie ?? null);
  await subirObjeto("manifesto.json", Buffer.from(JSON.stringify(novo, null, 2)), "application/json");
  return novo;
}

// --- Registro de INDISPONIVEIS -------------------------------------------------
//
// Conteudo que falhou PERMANENTEMENTE (nenhuma pagina em formato suportado; o
// publicador serve casca vazia) NAO gera zip. Guardar isso no `manifesto.json`
// quebraria a invariante "cada item de conteudos[] = um zip real" — a reconciliacao
// (`gerarManifestoR2`, que reconstroi a partir dos zips do bucket) apagaria o
// registro, e o PWA tentaria semear um item sem zip. Por isso os indisponiveis vivem
// num arquivo SEPARADO, `indisponiveis.json`, que so o downloader le/escreve.
//
// E so um SINAL para a UI ("ja tentei, nao da"): nao bloqueia re-tentar (o publicador
// pode consertar a aula). Um download bem-sucedido depois LIMPA o id daqui.
//
// Espelha o padrao do manifesto: R2 quando configurado, disco como fallback. Cada
// item: { id, nome, habilidade, serieNome, motivo, registradoEm }.

const NOME_INDISPONIVEIS = "indisponiveis.json";

function caminhoIndisponiveisDisco() {
  return path.join(obterRaizAcervo(), NOME_INDISPONIVEIS);
}

// Le a lista atual. Vazia se ainda nao existe (bucket/disco limpo).
export async function lerIndisponiveis() {
  if (r2Configurado()) {
    try {
      const bytes = await lerObjeto(NOME_INDISPONIVEIS);
      const dados = JSON.parse(bytes.toString("utf-8"));
      return Array.isArray(dados.itens) ? dados.itens : [];
    } catch {
      return [];
    }
  }
  try {
    const bruto = await fs.readFile(caminhoIndisponiveisDisco(), "utf-8");
    const dados = JSON.parse(bruto);
    return Array.isArray(dados.itens) ? dados.itens : [];
  } catch {
    return [];
  }
}

async function gravarIndisponiveis(itens) {
  const corpo = JSON.stringify({ atualizadoEm: new Date().toISOString(), itens }, null, 2);
  if (r2Configurado()) {
    await subirObjeto(NOME_INDISPONIVEIS, Buffer.from(corpo), "application/json");
  } else {
    await fs.writeFile(caminhoIndisponiveisDisco(), corpo, "utf-8");
  }
}

// Registra (ou atualiza) um indisponivel. `registro` = { id, nome, habilidade,
// serieNome, motivo }. Id ja presente e substituido (motivo/data atualizados).
export async function registrarIndisponivel(registro) {
  const itens = await lerIndisponiveis();
  const alvo = String(registro.id);
  const semAlvo = itens.filter(i => String(i.id) !== alvo);
  semAlvo.push({
    id: alvo,
    nome: registro.nome || "",
    habilidade: registro.habilidade || "",
    serieNome: registro.serieNome || "",
    motivo: registro.motivo || "",
    registradoEm: new Date().toISOString()
  });
  semAlvo.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  await gravarIndisponiveis(semAlvo);
  return semAlvo;
}

// Tira um id do registro (download passou a funcionar, ou item apagado). Se nao
// estava la, nao faz nada (nem reescreve). Devolve a lista resultante.
export async function removerIndisponivel(id) {
  const itens = await lerIndisponiveis();
  const alvo = String(id);
  if (!itens.some(i => String(i.id) === alvo)) return itens;
  const novos = itens.filter(i => String(i.id) !== alvo);
  await gravarIndisponiveis(novos);
  return novos;
}
