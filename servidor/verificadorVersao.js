// Verificacao de versao de um conteudo do acervo — logica pura, compartilhada pelo
// CLI (scripts/verificar-updates.mjs) e pela rota do servidor (aba Acervo).
//
// A versao de cada pagina (LO) vive no caminho da pasta do publicador
// ({externalId}_vN). O acervo grava esse mapa em `versoes` ({externalId: "id_vN"}).
// Aqui comparamos o vN GRAVADO com o vN ATUAL do AVA (obterUltimaVersaoLo). Se o AVA
// tem um numero maior, a pagina envelheceu. NAO baixa a aula — so consulta a listagem
// de versoes de cada LO.

import { obterUltimaVersaoLo } from "../nucleo-conteudo/publicador.js";

// "12345_v9" -> 9 ; sem _vN -> null (nao versionavel).
export function extrairNumeroVersao(rotulo) {
  const m = /_v(\d+)\/?$/.exec(String(rotulo || "").trim());
  return m ? Number(m[1]) : null;
}

// Verifica UM conteudo a partir do seu registro (indice.json OU item do manifesto —
// ambos tem `id`, `nome`, `versoes` e `paginas`). Devolve:
//   { id, nome, situacao, paginas, motivo? }
// situacao: "atualizado" | "desatualizado" | "nao-versionavel" | "erro".
export async function verificarConteudo(registro) {
  const gravadas = registro.versoes && typeof registro.versoes === "object" ? registro.versoes : {};
  const externalIds = Object.keys(gravadas);

  if (!externalIds.length) {
    const motivo = (registro.paginas || []).some(p => p.externalId)
      ? "acervo antigo: rebaixe uma vez para gravar as versoes"
      : "conteudo sem publicador versionado (caminho antigo)";
    return { id: String(registro.id), nome: registro.nome, situacao: "nao-versionavel", motivo, paginas: [] };
  }

  const paginas = [];
  let temDesatualizada = false;
  let houveErro = false;

  for (const externalId of externalIds) {
    const rotuloGravado = gravadas[externalId];
    const numGravado = extrairNumeroVersao(rotuloGravado);
    try {
      const atual = await obterUltimaVersaoLo(externalId);
      const numAtual = extrairNumeroVersao(atual?.versao);
      const desatualizada = numGravado != null && numAtual != null && numAtual > numGravado;
      if (desatualizada) temDesatualizada = true;
      paginas.push({ externalId, versaoGravada: rotuloGravado, versaoAtual: atual?.versao || "", numGravado, numAtual, desatualizada });
    } catch (erro) {
      houveErro = true;
      paginas.push({ externalId, versaoGravada: rotuloGravado, erro: erro.message });
    }
  }

  const situacao = temDesatualizada ? "desatualizado" : houveErro ? "erro" : "atualizado";
  return { id: String(registro.id), nome: registro.nome, situacao, paginas };
}

// Verifica uma LISTA de registros. Devolve { total, resultados }.
export async function verificarLista(registros) {
  const resultados = [];
  for (const reg of registros) {
    resultados.push({ arquivo: reg.arquivo, ...(await verificarConteudo(reg)) });
  }
  return { total: resultados.length, resultados };
}
