import { CODIGO_DOWNLOAD_CANCELADO } from "./constantes.js";

function criarErroCancelamento() {
  const erro = new Error("Download cancelado.");
  erro.codigo = CODIGO_DOWNLOAD_CANCELADO;
  return erro;
}

export function downloadFoiCancelado(erro) {
  return (
    erro?.codigo === CODIGO_DOWNLOAD_CANCELADO ||
    erro?.name === "AbortError" ||
    /download cancelado/i.test(String(erro?.message || ""))
  );
}

export function verificarCancelamento(cancelToken) {
  if (cancelToken?.cancelado) {
    throw criarErroCancelamento();
  }
}

export async function cancelarDownloadConteudo() {
  // Cancelamento via AbortController — não requer plugin nativo.
}
