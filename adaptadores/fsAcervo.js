// Adaptador de persistencia em disco — a contraparte Node de
// `nucleo-conteudo/arquivosPacote.js`, que no PWA grava na Cache API.
//
// Reimplementa as MESMAS 10 funcoes com as MESMAS assinaturas, para que o resto
// do nucleo (cacheRecursos, pacoteConteudo) rode sem saber que trocou de meio.
// A unica diferenca observavel e `obterUrlArquivoLocal`: no PWA devolve uma URL
// de mesma origem; aqui devolve o caminho absoluto no disco.
//
// O "caminho" logico do pacote (ex.: offline-conteudos/870989/pagina-1/index.html)
// vira um arquivo real sob RAIZ_ACERVO. `normalizarCaminhoArquivo` ja sanitiza os
// caracteres proibidos no Windows (< > : " | ? *), entao o mapeamento e direto.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizarCaminhoArquivo } from "../nucleo-conteudo/caminhos.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ_ACERVO_PADRAO = path.resolve(AQUI, "..", "acervo");

let raizAcervo = process.env.ACERVO_RAIZ
  ? path.resolve(process.env.ACERVO_RAIZ)
  : RAIZ_ACERVO_PADRAO;

export function definirRaizAcervo(caminho) {
  raizAcervo = path.resolve(caminho);
}

export function obterRaizAcervo() {
  return raizAcervo;
}

// Caminho logico -> caminho absoluto no disco. Passa por normalizarCaminhoArquivo
// (mesma normalizacao do PWA) e depois resolve sob a raiz. O `path.resolve` final
// mais a checagem de prefixo barram qualquer traversal que tenha escapado.
function caminhoDisco(caminhoLogico) {
  const relativo = normalizarCaminhoArquivo(caminhoLogico);
  const absoluto = path.resolve(raizAcervo, relativo);

  if (absoluto !== raizAcervo && !absoluto.startsWith(raizAcervo + path.sep)) {
    throw new Error(`Caminho fora do acervo: ${caminhoLogico}`);
  }

  return absoluto;
}

async function garantirPai(caminhoAbsoluto) {
  await fs.mkdir(path.dirname(caminhoAbsoluto), { recursive: true });
}

export async function removerDiretorioSeExistir(caminhoLogico) {
  const alvo = caminhoDisco(caminhoLogico);
  await fs.rm(alvo, { recursive: true, force: true });
}

export async function arquivoExiste(caminhoLogico) {
  try {
    await fs.access(caminhoDisco(caminhoLogico));
    return true;
  } catch {
    return false;
  }
}

export async function escreverArquivoTexto(caminhoLogico, texto) {
  const alvo = caminhoDisco(caminhoLogico);
  await garantirPai(alvo);
  await fs.writeFile(alvo, String(texto ?? ""), "utf-8");
}

export async function escreverArquivoBinario(caminhoLogico, base64) {
  const alvo = caminhoDisco(caminhoLogico);
  await garantirPai(alvo);
  await fs.writeFile(alvo, Buffer.from(String(base64 || ""), "base64"));
}

export async function escreverArquivoBlob(caminhoLogico, blob) {
  const alvo = caminhoDisco(caminhoLogico);
  await garantirPai(alvo);
  const buffer = Buffer.from(await blob.arrayBuffer());
  await fs.writeFile(alvo, buffer);
}

// Move a pasta temporaria para a definitiva. Como no APK (SPEC 23.12 causa 1),
// `rename` NAO cria o diretorio-pai do destino — entao criamos antes. E se o
// destino ja existe (redownload), removemos primeiro, porque rename sobre pasta
// existente falha no Windows.
export async function renomearDiretorioPacote(origemLogica, destinoLogico) {
  const origem = caminhoDisco(origemLogica);
  const destino = caminhoDisco(destinoLogico);

  try {
    await fs.access(origem);
  } catch {
    return; // nada a mover
  }

  await removerComRetry(destino);
  await fs.mkdir(path.dirname(destino), { recursive: true });

  // `fs.rename` de diretorio falha com EPERM no Windows quando algo esta com a
  // pasta aberta — tipico com OneDrive sincronizando a pasta em tempo real
  // (este projeto vive em OneDrive\Desktop) ou antivirus. O EPERM costuma ser
  // transitorio, entao tentamos com backoff; se insistir, caimos para copiar +
  // remover, que nao depende do rename atomico de diretorio.
  try {
    await renomearComRetry(origem, destino);
  } catch (erro) {
    if (erro?.code !== "EPERM" && erro?.code !== "EACCES" && erro?.code !== "EBUSY") {
      throw erro;
    }
    await fs.cp(origem, destino, { recursive: true });
    await removerComRetry(origem);
  }
}

function aguardar(ms) {
  return new Promise(resolve => { setTimeout(resolve, ms); });
}

async function renomearComRetry(origem, destino, tentativas = 5) {
  for (let i = 1; i <= tentativas; i += 1) {
    try {
      await fs.rename(origem, destino);
      return;
    } catch (erro) {
      const transitorio = erro?.code === "EPERM" || erro?.code === "EACCES" || erro?.code === "EBUSY";
      if (!transitorio || i === tentativas) throw erro;
      await aguardar(120 * i);
    }
  }
}

async function removerComRetry(alvo, tentativas = 5) {
  for (let i = 1; i <= tentativas; i += 1) {
    try {
      await fs.rm(alvo, { recursive: true, force: true });
      return;
    } catch (erro) {
      const transitorio = erro?.code === "EPERM" || erro?.code === "EACCES" || erro?.code === "EBUSY";
      if (!transitorio || i === tentativas) throw erro;
      await aguardar(120 * i);
    }
  }
}

export async function lerArquivoTexto(caminhoLogico) {
  const alvo = caminhoDisco(caminhoLogico);
  try {
    return await fs.readFile(alvo, "utf-8");
  } catch {
    throw new Error(`Arquivo nao encontrado: ${caminhoLogico}`);
  }
}

export async function lerArquivoBlob(caminhoLogico) {
  const alvo = caminhoDisco(caminhoLogico);
  let buffer;
  try {
    buffer = await fs.readFile(alvo);
  } catch {
    throw new Error(`Arquivo nao encontrado: ${caminhoLogico}`);
  }
  return new Blob([buffer]);
}

export async function listarSubdiretoriosCache(caminhoLogico) {
  const alvo = caminhoDisco(caminhoLogico);
  try {
    const entradas = await fs.readdir(alvo, { withFileTypes: true });
    return entradas.map(entrada => entrada.name);
  } catch {
    return [];
  }
}

// No PWA devolve uma URL de mesma origem servida pelo Service Worker. Aqui o
// pacote vive no disco, entao devolvemos o caminho absoluto — quem serve isso ao
// front e o servidor Express (rota de acervo), nao este adaptador.
export async function obterUrlArquivoLocal(caminhoLogico) {
  return caminhoDisco(caminhoLogico);
}
