import {
  arquivoExiste,
  escreverArquivoBinario,
  escreverArquivoBlob,
  escreverArquivoTexto,
  obterUrlArquivoLocal,
  removerDiretorioSeExistir,
  renomearDiretorioPacote
} from "./arquivosPacote.js";
import {
  CONCORRENCIA_DOWNLOAD,
  CONCORRENCIA_ESCRITA,
  LIMITE_BYTES,
  LIMITE_RECURSOS,
  LOG_DOWNLOAD,
  PASTA_CONTEUDOS_OFFLINE
} from "./constantes.js";
import { downloadFoiCancelado, verificarCancelamento } from "./cancelamento.js";
import {
  normalizarCaminhoArquivo,
  obterCaminhoRelativoAoPacote,
  obterDiretorioUrl
} from "./caminhos.js";
import { obterBaseServidorConteudoLocal, usandoNativo } from "./ambiente.js";
import { executarComConcorrencia } from "./concorrencia.js";
import { emitirProgresso, limitarPercentual } from "./progresso.js";
import { baixarItemArquivo, baixarTexto } from "./httpConteudo.js";
import {
  adicionarRecursoDinamicoPublicador,
  adicionarRecursoNaFila,
  reescreverTextoParaArquivosLocais
} from "./filaRecursos.js";
import {
  detectarFormato,
  extrairRecursosHtml,
  removerRegistroServiceWorker
} from "./recursosHtml.js";
import { prepararFilaRecursos } from "./descobertaRecursos.js";
import { deveInjetarModeloHtml, devePreservarScriptDoFormato } from "./politicasFormato.js";
import { reescreverModulosDoFormato } from "./modulosEs.js";

const CAMINHO_VENDOR_MAIN_MODELO = "offline-vendor/classes.educandus.com.br/modelo_html/js/main.js";

function serializarTextoParaHtml(valor) {
  return JSON.stringify(String(valor || ""))
    .replace(/<\//gi, "<\\/")
    .replace(/</g, "\\u003C");
}

function serializarObjetoParaHtml(valor) {
  return JSON.stringify(valor || {})
    .replace(/<\//gi, "<\\/")
    .replace(/</g, "\\u003C");
}

function injetarBootstrapModeloClassico(html, { recursosInline = {}, mainModelo = "" } = {}) {
  const bloco = [
    "<script>",
    `window.__AVA_RECURSOS_INLINE = Object.assign({}, window.__AVA_RECURSOS_INLINE || {}, ${serializarObjetoParaHtml(recursosInline)});`,
    `window.__AVA_MODELO_HTML_MAIN_FONTE = ${serializarTextoParaHtml(mainModelo)};`,
    "window.__AVA_MODELO_HTML_MAIN_CARREGADO = Boolean(window.__AVA_MODELO_HTML_MAIN_CARREGADO);",
    `window.__AVA_MODELO_HTML_BOOTSTRAP = { recursosInline: Object.keys(window.__AVA_RECURSOS_INLINE || {}).length, mainInline: Boolean(window.__AVA_MODELO_HTML_MAIN_FONTE) };`,
    "</script>"
  ].join("");

  const padraoReadxml = /<script\b[^>]*\bsrc=["'][^"']*readxml\.js(?:\?[^"']*)?["'][^>]*>\s*<\/script>|<script\b[^>]*\bsrc=["'][^"']*readxml\.js(?:\?[^"']*)?["'][^>]*>/i;

  if (padraoReadxml.test(html)) {
    return html.replace(padraoReadxml, correspondencia => `${bloco}${correspondencia}`);
  }

  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${bloco}</head>`);
  }

  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${bloco}</body>`);
  }

  return `${html}${bloco}`;
}

export async function cachearRecursosEmArquivos({
  html,
  urlBase,
  conteudoId,
  ordem,
  externalId,
  versao,
  pastaBaseConteudo,
  espelharPublicador = false,
  onProgresso,
  cancelToken
}) {
  verificarCancelamento(cancelToken);

  const diretorioBase = obterDiretorioUrl(urlBase);
  const pastaConteudo = pastaBaseConteudo || `${PASTA_CONTEUDOS_OFFLINE}/${normalizarCaminhoArquivo(conteudoId)}`;
  const pastaPagina = `${pastaConteudo}/pagina-${ordem || 1}`;
  const pastaPaginaTemporaria = `${pastaPagina}-tmp`;
  const caminhoIndex = `${pastaPagina}/index.html`;
  const caminhoIndexTemporario = `${pastaPaginaTemporaria}/index.html`;
  const fila = [];
  const recursos = new Map();
  const caminhosBaixados = new Set();
  const falhas = [];
  let bytes = new Blob([html]).size;
  let itensProcessados = 0;
  let totalEstimado = 1;
  let ultimoPercentual = 0;
  const progressoPagina = percentual => {
    ultimoPercentual = Math.max(ultimoPercentual, limitarPercentual(percentual));
    emitirProgresso(onProgresso, ultimoPercentual);
  };

  progressoPagina(2);
  const formatoInicial = await prepararFilaRecursos({
    fila,
    html,
    urlBase,
    diretorioBase,
    externalId,
    espelharPublicador
  });

  totalEstimado = Math.max(fila.length, 1);
  progressoPagina(10);
  await removerDiretorioSeExistir(pastaPaginaTemporaria);

  const urlsEmDownload = new Set();
  const caminhosEmDownload = new Set();

  async function baixarProximoItem() {
    verificarCancelamento(cancelToken);

    const itemFila = fila.shift();

    if (!itemFila) {
      return false;
    }

    const { original, url, caminhoPreferencial, origem, vendor, opcional } = itemFila;

    if (!url || url.startsWith("data:") || recursos.has(url)) {
      return true;
    }

    const caminho = caminhoPreferencial || obterCaminhoRelativoAoPacote(url, diretorioBase);

    if (!vendor && (caminhosBaixados.has(caminho) || caminhosEmDownload.has(caminho))) {
      return true;
    }

    if (urlsEmDownload.has(url)) {
      return true;
    }

    if (vendor) {
      console.info(`${LOG_DOWNLOAD} VENDOR caminho=${caminho} url=${url}`);
      recursos.set(url, {
        original,
        url,
        caminho,
        origem,
        vendor: true,
        texto: "",
        base64: "",
        bytes: 0
      });
      itensProcessados += 1;
      progressoPagina(10 + (itensProcessados / Math.max(totalEstimado, 1)) * 68);
      return true;
    }

    urlsEmDownload.add(url);
    caminhosEmDownload.add(caminho);

    try {
      console.info(`${LOG_DOWNLOAD} RECURSO_INICIO origem=${origem} caminho=${caminho} url=${url}`);
      const item = await baixarItemArquivo(url, { cancelToken });
      bytes += item.bytes;

      if (bytes > LIMITE_BYTES) {
        return false;
      }

      item.original = original;
      item.url = url;
      item.caminho = caminho;
      item.origem = origem;
      item.vendor = false;
      recursos.set(url, item);
      caminhosBaixados.add(caminho);
      console.info(`${LOG_DOWNLOAD} RECURSO_FIM bytes=${item.bytes} texto=${Boolean(item.texto)} gravado=${Boolean(item.gravado)} caminho=${caminho} url=${url}`);

      // Não varrer links de recursos externos — evita crawl recursivo de sites de terceiros.
      if (item.texto && !caminho.startsWith("externos/") && !devePreservarScriptDoFormato(formatoInicial, item.caminho)) {
        extrairRecursosHtml(item.texto).forEach(recursoInterno => {
          if (espelharPublicador && deveInjetarModeloHtml(formatoInicial) && item.caminho === "xml/lo.xml") {
            adicionarRecursoNaFila(fila, recursoInterno, diretorioBase.toString(), diretorioBase, {
              origem: item.caminho,
              formato: formatoInicial
            });
          } else if (espelharPublicador) {
            adicionarRecursoDinamicoPublicador(fila, recursoInterno, url, diretorioBase, item.caminho, {
              formato: formatoInicial
            });
          } else {
            adicionarRecursoNaFila(fila, recursoInterno, url, diretorioBase, {
              origem: item.caminho,
              formato: formatoInicial
            });
          }
        });
        totalEstimado = Math.max(totalEstimado, itensProcessados + fila.length + urlsEmDownload.size);
      }
    } catch (erro) {
      if (downloadFoiCancelado(erro)) {
        throw erro;
      }

      console.warn(`${LOG_DOWNLOAD} RECURSO_ERRO origem=${origem} caminho=${caminho} url=${url} motivo=${erro?.message || "erro desconhecido"}`);
      if (falhas.length < 100) {
        falhas.push({
          url,
          caminho,
          origem,
          opcional,
          motivo: erro?.message || "Falha ao baixar recurso"
        });
      }
    } finally {
      urlsEmDownload.delete(url);
      caminhosEmDownload.delete(caminho);
      itensProcessados += 1;
      progressoPagina(10 + (itensProcessados / Math.max(totalEstimado, 1)) * 68);
    }

    return true;
  }

  const trabalhadoresDownload = Array.from({ length: CONCORRENCIA_DOWNLOAD }, async () => {
    while (recursos.size < LIMITE_RECURSOS && bytes <= LIMITE_BYTES) {
      verificarCancelamento(cancelToken);
      const continuou = await baixarProximoItem();

      if (!continuou) {
        break;
      }
    }
  });

  await Promise.all(trabalhadoresDownload);

  progressoPagina(80);

  if (bytes <= LIMITE_BYTES) {
    while (fila.length && recursos.size < LIMITE_RECURSOS) {
      verificarCancelamento(cancelToken);
      const continuou = await baixarProximoItem();

      if (!continuou) {
        break;
      }
    }
  }

  const recursosOffline = Array.from(recursos.values());
  const htmlSemServiceWorker = removerRegistroServiceWorker(html);
  let htmlReescrito = reescreverTextoParaArquivosLocais(htmlSemServiceWorker, "index.html", recursosOffline);

  // Import map e import de modulo no proprio index.html. Vem DEPOIS da reescrita
  // por recurso descoberto porque trata o que ela nao alcanca por construcao:
  // especificador sem extensao de arquivo (ver `modulosEs.js`).
  htmlReescrito = reescreverModulosDoFormato(htmlReescrito, formatoInicial, {
    ehHtml: true,
    descricao: "index.html"
  });

  let mainModeloInline = "";
  const recursosInlineModelo = {};

  if (deveInjetarModeloHtml(formatoInicial)) {
    for (const item of recursosOffline) {
      if (item.vendor || !item.texto || item.caminho === "xml/lo.xml" || !/\.(?:js|css)$/i.test(item.caminho)) {
        continue;
      }

      recursosInlineModelo[item.caminho] = reescreverTextoParaArquivosLocais(item.texto, "index.html", recursosOffline);
    }

    const baseVendorLocal = obterBaseServidorConteudoLocal();
    if (!usandoNativo() && baseVendorLocal) {
      try {
        const urlMainModelo = new URL(`/${CAMINHO_VENDOR_MAIN_MODELO}`, baseVendorLocal).toString();
        const mainModelo = await baixarTexto(urlMainModelo, { cancelToken });
        mainModeloInline = mainModelo.texto;
      } catch (erro) {
        console.warn(
          `${LOG_DOWNLOAD} RECURSO_ERRO origem=modelo-html caminho=${CAMINHO_VENDOR_MAIN_MODELO} url=${CAMINHO_VENDOR_MAIN_MODELO} motivo=${erro?.message || "Falha ao preparar main.js inline"}`
        );
      }
    }

    htmlReescrito = injetarBootstrapModeloClassico(htmlReescrito, {
      recursosInline: recursosInlineModelo,
      mainModelo: mainModeloInline
    });
  }

  await escreverArquivoTexto(caminhoIndexTemporario, htmlReescrito);

  const recursosParaEscrever = recursosOffline.filter(item => !item.vendor && !item.gravado);
  let escritos = 0;

  await executarComConcorrencia(recursosParaEscrever, CONCORRENCIA_ESCRITA, async item => {
    const caminhoArquivo = `${pastaPaginaTemporaria}/${item.caminho}`;

    if (item.texto) {
      // No modelo classico, o readxml.js lê o xml/lo.xml e injeta os caminhos no
      // DOM do index.html. Entao as URLs do XML precisam ser reescritas com a base
      // efetiva da pagina, e nao com a base do proprio arquivo xml/lo.xml.
      const caminhoBaseReescrita =
        deveInjetarModeloHtml(formatoInicial) && item.caminho === "xml/lo.xml" ? "index.html" : item.caminho;
      const textoReescrito = devePreservarScriptDoFormato(formatoInicial, item.caminho)
        ? item.texto
        : reescreverModulosDoFormato(
            reescreverTextoParaArquivosLocais(item.texto, caminhoBaseReescrita, recursosOffline),
            formatoInicial,
            { ehHtml: /\.html?$/i.test(item.caminho), descricao: item.caminho }
          );
      await escreverArquivoTexto(caminhoArquivo, textoReescrito);

      if (/^informacoes\.xml$/i.test(item.caminho)) {
        await escreverArquivoTexto(`${pastaPaginaTemporaria}/Informacoes.xml`, textoReescrito);
        await escreverArquivoTexto(`${pastaPaginaTemporaria}/informacoes.xml`, textoReescrito);
      }
    } else if (item.blob) {
      await escreverArquivoBlob(caminhoArquivo, item.blob, item.tipo);
    } else {
      await escreverArquivoBinario(caminhoArquivo, item.base64);

      if (item.caminho === "icons/loading-logo.png") {
        await escreverArquivoBinario(`${pastaPaginaTemporaria}/loading-logo.png`, item.base64);
      }
    }

    escritos += 1;
    progressoPagina(80 + (escritos / Math.max(recursosParaEscrever.length, 1)) * 18);
  });

  progressoPagina(99);
  await removerDiretorioSeExistir(pastaPagina);
  await renomearDiretorioPacote(pastaPaginaTemporaria, pastaPagina);

  if (!(await arquivoExiste(caminhoIndex))) {
    throw new Error("Pacote offline incompleto apos salvar arquivos.");
  }

  const formato = detectarFormato(
    html,
    recursosOffline.map(item => item.original)
  );

  return {
    formato,
    externalId,
    versao,
    caminhoIndex,
    diretorio: pastaPagina,
    urlLocal: await obterUrlArquivoLocal(caminhoIndex),
    quantidadeRecursos: recursosOffline.filter(item => !item.vendor).length,
    dependenciasVendor: recursosOffline.filter(item => item.vendor).map(item => item.caminho),
    falhas,
    serviceWorkerRemovido: htmlSemServiceWorker !== html,
    bytes
  };
}
