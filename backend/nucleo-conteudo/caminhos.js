export function resolverUrl(base, caminho) {
  try {
    return new URL(caminho, base).toString();
  } catch {
    return "";
  }
}

export function normalizarCaminhoArquivo(caminho) {
  return String(caminho || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter(Boolean)
    .filter(parte => parte !== "." && parte !== "..")
    .map(parte => parte.replace(/[<>:"|?*]/g, "_"))
    .join("/");
}

export function obterDiretorioUrl(url) {
  const objetoUrl = new URL(url);
  const partes = objetoUrl.pathname.split("/");
  partes.pop();
  objetoUrl.pathname = `${partes.join("/")}/`;
  objetoUrl.search = "";
  objetoUrl.hash = "";
  return objetoUrl;
}

// decodeURIComponent tolerante: o publicador serve arquivos com acento em
// Latin-1 (ex.: %E2 = "â"), sequencia percent VALIDA mas UTF-8 invalida. O
// decode padrao lanca URIError e derrubava a pagina inteira (SPEC 23.12). Aqui,
// falhando, mantemos a string como veio — feio no nome, mas funciona porque
// gravacao e leitura usam a mesma string.
function decodificarTolerante(texto) {
  try {
    return decodeURIComponent(texto);
  } catch {
    return texto;
  }
}

export function obterCaminhoRelativoAoPacote(urlAbsoluta, diretorioBase) {
  const url = new URL(urlAbsoluta);
  const caminhoBase = decodificarTolerante(diretorioBase.pathname);
  const caminhoUrl = decodificarTolerante(url.pathname);

  if (url.origin === diretorioBase.origin && caminhoUrl.startsWith(caminhoBase)) {
    return normalizarCaminhoArquivo(caminhoUrl.slice(caminhoBase.length)) || "index.html";
  }

  return normalizarCaminhoArquivo(`externos/${url.hostname}${caminhoUrl}`);
}

export function obterCaminhoRelativo(deArquivo, paraArquivo) {
  const origem = normalizarCaminhoArquivo(deArquivo).split("/");
  const destino = normalizarCaminhoArquivo(paraArquivo).split("/");
  origem.pop();

  let indice = 0;
  while (origem[indice] && origem[indice] === destino[indice]) {
    indice += 1;
  }

  const retorno = origem.slice(indice).map(() => "..");
  const caminho = [...retorno, ...destino.slice(indice)].join("/");
  return caminho || destino.at(-1) || "";
}
