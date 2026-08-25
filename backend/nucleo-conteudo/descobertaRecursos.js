import {
  CONCORRENCIA_LISTAGEM,
  DIRETORIOS_COMUNS,
  DIRETORIOS_CONSTRUCT,
  DIRETORIOS_ESPELHO
} from "./constantes.js";
import { normalizarCaminhoArquivo, resolverUrl } from "./caminhos.js";
import { executarComConcorrencia } from "./concorrencia.js";
import { baixarTexto } from "./httpConteudo.js";
import {
  adicionarRecursoNaFila
} from "./filaRecursos.js";
import {
  detectarFormato,
  extrairLinksApache,
  extrairRecursosHtml,
  extrairRecursosJson
} from "./recursosHtml.js";

async function listarDiretorioApache(urlDiretorio, visitados = new Set()) {
  const urlNormalizada = urlDiretorio.endsWith("/") ? urlDiretorio : `${urlDiretorio}/`;

  if (visitados.has(urlNormalizada) || visitados.size > 80) {
    return [];
  }

  visitados.add(urlNormalizada);

  let html;
  try {
    html = (await baixarTexto(urlNormalizada)).texto;
  } catch {
    return [];
  }

  const links = extrairLinksApache(html);
  if (!links) {
    return [];
  }

  const arquivos = [];

  for (const link of links) {
    const url = resolverUrl(urlNormalizada, link);

    if (!url) {
      continue;
    }

    if (link.endsWith("/")) {
      arquivos.push(...(await listarDiretorioApache(url, visitados)));
    } else {
      arquivos.push(url);
    }
  }

  return arquivos;
}

async function adicionarArquivosDeDiretoriosConhecidos(fila, html, diretorioBase, formato = "") {
  const recursos = extrairRecursosHtml(html);
  const diretorios = new Set();

  for (const recurso of recursos) {
    const caminho = normalizarCaminhoArquivo(recurso);
    const primeiroDiretorio = DIRETORIOS_COMUNS.find(dir => caminho.startsWith(dir));

    if (primeiroDiretorio) {
      diretorios.add(primeiroDiretorio);
    }
  }

  await executarComConcorrencia(Array.from(diretorios), CONCORRENCIA_LISTAGEM, async diretorio => {
    const arquivos = await listarDiretorioApache(resolverUrl(diretorioBase.toString(), diretorio));

    for (const urlArquivo of arquivos) {
      adicionarRecursoNaFila(fila, urlArquivo, diretorioBase.toString(), diretorioBase, {
        origem: "listagem-apache",
        formato
      });
    }
  });
}

async function adicionarArquivosPorListagemCompleta(fila, diretorioBase, diretorios = [], formato = "") {
  const todosArquivos = [];
  const diretoriosListagem = ["", ...diretorios];

  await executarComConcorrencia(diretoriosListagem, CONCORRENCIA_LISTAGEM, async diretorio => {
    const urlDiretorio = diretorio ? resolverUrl(diretorioBase.toString(), diretorio) : diretorioBase.toString();
    const arquivos = await listarDiretorioApache(urlDiretorio);
    todosArquivos.push(...arquivos);
  });

  for (const urlArquivo of Array.from(new Set(todosArquivos))) {
    adicionarRecursoNaFila(fila, urlArquivo, diretorioBase.toString(), diretorioBase, {
      origem: "espelho-publicador",
      formato
    });
  }
}

async function adicionarArquivosPublicador(fila, diretorioBase, formato = "") {
  // A raiz do LO **nao** e uma listagem: o Apache serve o `index.html` da propria
  // aula, entao `extrairLinksApache` devolve null e a varredura recursiva da raiz
  // nao descobre nada. Os SUBDIRETORIOS, por nao terem index, sao listaveis
  // normalmente.
  //
  // Por isso os diretorios conhecidos entram aqui explicitamente. Sem eles, so
  // chegava ao pacote o que o HTML citava — e `media/` nao e citado: o runtime do
  // Construct monta esses caminhos sozinho. Resultado observado em 04/08/2026:
  // 51 arquivos de `images/` (citados no HTML) e ZERO de `media/`, com a aula
  // abrindo muda e 404 por audio no console.
  //
  // Diretorio que nao existe apenas responde 404 e e ignorado.
  await adicionarArquivosPorListagemCompleta(fila, diretorioBase, DIRETORIOS_ESPELHO, formato);

  if (formato === "html-modelo-classico") {
    adicionarRecursoNaFila(fila, "xml/lo.xml", diretorioBase.toString(), diretorioBase, {
      caminhoPreferencial: "xml/lo.xml",
      origem: "modelo-html",
      formato
    });

    adicionarRecursoNaFila(
      fila,
      "https://classes.educandus.com.br/modelo_html/js/main.js",
      diretorioBase.toString(),
      diretorioBase,
      {
        origem: "modelo-html",
        formato
      }
    );
  }

  if (formato === "html-educandus") {
    // `informacoes.xml` traz os textos das falas; o Start.js o carrega por
    // XMLHttpRequest ("informacoes.xml", nome fixo) — nao aparece no HTML, entao a
    // varredura do documento nao o pega. Enfileirado por nome, como o `xml/lo.xml`
    // do modelo classico. A gravacao ja trata variantes de caixa (cacheRecursos).
    adicionarRecursoNaFila(fila, "informacoes.xml", diretorioBase.toString(), diretorioBase, {
      caminhoPreferencial: "informacoes.xml",
      origem: "html-educandus",
      formato
    });

    // Pastas proprias destas aulas (nomes reais no servidor, com maiuscula/portugues).
    // Nao estao em DIRETORIOS_ESPELHO. Varrer por seguranca: se a aula carregar algo
    // nao citado no HTML, ainda vem. Diretorio inexistente responde 404 e e ignorado.
    await adicionarArquivosPorListagemCompleta(
      fila,
      diretorioBase,
      ["Imagens/", "Audios/", "Biblioteca/", "JavaScripts/"],
      formato
    );
  }
}

async function adicionarManifestosConstruct(fila, diretorioBase, externalId = "", formato = "") {
  // Arquivos que o runtime do Construct busca EM TEMPO DE EXECUCAO: nao aparecem
  // como `src`/`href` no HTML, entao a varredura do documento nao os encontra e
  // precisam ser tentados pelo nome.
  //
  // `data.js` e o modelo do projeto no Construct 2; `data.json`, no Construct 3.
  // Tentar os dois em qualquer formato e barato — o que nao existir responde 404 e
  // e ignorado — e evita que uma classificacao errada deixe o pacote sem o arquivo
  // mais importante do export. Foi exatamente essa a falha: um C2 classificado
  // como C3 baixava sem `data.js` e abria em branco.
  //
  // `offline.js`/`offline.json` sao o MANIFESTO do Construct (o `fileList` que o SW
  // cacheia) — a lista AUTORITATIVA de todos os assets, inclusive os que o jogo
  // carrega em RUNTIME e ficam na RAIZ (ex.: `imagem0_0.png` das formas), que nao
  // aparecem no HTML nem no `data.js` e nao sao pegos pela listagem da raiz (a raiz
  // serve o index). Sem `offline.js` aqui, essas imagens faltavam e o Construct as
  // pintava de MAGENTA (textura ausente). O `offline.js` tem conteudo JSON.
  const candidatos = [
    "data.js",
    "data.json",
    "appmanifest.json",
    "offline.js",
    "offline.json",
    "offlineClient.js",
    "sw.js",
    "xmlDom.js",
    "xpath.js",
    externalId ? `${externalId}.txt` : ""
  ].filter(Boolean);

  for (const nome of candidatos) {
    const url = resolverUrl(diretorioBase.toString(), nome);

    try {
      const arquivo = await baixarTexto(url);
      adicionarRecursoNaFila(fila, nome, diretorioBase.toString(), diretorioBase, {
        caminhoPreferencial: nome,
        origem: "construct",
        formato
      });

      // offline.js tem conteudo JSON (fileList), apesar da extensao .js.
      const ehManifestoJson = nome.endsWith(".json") || nome === "offline.js";
      const recursos = ehManifestoJson ? extrairRecursosJson(arquivo.texto) : extrairRecursosHtml(arquivo.texto);

      for (const recurso of recursos) {
        adicionarRecursoNaFila(fila, recurso, url, diretorioBase, {
          origem: nome,
          formato
        });
      }
    } catch {
      // Arquivos complementares variam entre exports; a falta de um deles nao invalida o pacote.
    }
  }
}

export async function prepararFilaRecursos({
  fila,
  html,
  urlBase,
  diretorioBase,
  externalId = "",
  espelharPublicador = false
}) {
  const recursosHtmlInicial = extrairRecursosHtml(html);
  const formatoInicial = detectarFormato(html, recursosHtmlInicial);

  recursosHtmlInicial.forEach(recurso => {
    adicionarRecursoNaFila(fila, recurso, urlBase, diretorioBase, {
      formato: formatoInicial
    });
  });

  // Construct 2 e 3 descobrem recursos do mesmo jeito: manifestos por nome (o
  // runtime os busca em tempo de execucao, entao nao estao no HTML) e listagem
  // completa dos diretorios do export.
  const ehConstruct = formatoInicial === "construct2" || formatoInicial === "construct3";

  if (ehConstruct) {
    await adicionarManifestosConstruct(fila, diretorioBase, externalId, formatoInicial);
  }

  if (espelharPublicador) {
    await adicionarArquivosPublicador(fila, diretorioBase, formatoInicial);
  } else if (ehConstruct) {
    await adicionarArquivosPorListagemCompleta(fila, diretorioBase, DIRETORIOS_CONSTRUCT, formatoInicial);
  } else {
    await adicionarArquivosDeDiretoriosConhecidos(fila, html, diretorioBase, formatoInicial);
  }

  return formatoInicial;
}
