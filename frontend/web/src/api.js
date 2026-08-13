// Cliente do front -> servidor local (/api). O navegador so fala com o nosso
// Express; quem fala com o AVA e o servidor.

async function json(caminho, opcoes = {}) {
  const resposta = await fetch(`/api${caminho}`, {
    headers: { "Content-Type": "application/json" },
    ...opcoes
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    throw new Error(dados?.erro || `HTTP ${resposta.status}`);
  }
  return dados;
}

export const api = {
  health: () => json("/health"),
  login: (usuario, senha) =>
    json("/login", { method: "POST", body: JSON.stringify({ usuario, senha }) }),
  logout: () => json("/logout", { method: "POST" }),
  disciplinas: () => json("/disciplinas"),
  taxonomia: disciplina => json(`/taxonomia${disciplina ? `?disciplina=${encodeURIComponent(disciplina)}` : ""}`),
  catalogo: filtros => {
    const q = new URLSearchParams();
    if (filtros.tipo) q.set("tipo", filtros.tipo); // 1 = Aula, 2 = Jogo (padrao 1 no servidor)
    if (filtros.segment) q.set("segment", filtros.segment);
    if (filtros.serie) q.set("serie", filtros.serie);
    if (filtros.word) q.set("word", filtros.word);
    if (filtros.infantil) q.set("infantil", "true");
    if (filtros.disciplina) q.set("disciplina", filtros.disciplina);
    if (filtros.disciplinaSerie) q.set("disciplinaSerie", filtros.disciplinaSerie);
    return json(`/catalogo?${q.toString()}`);
  },
  acervo: () => json("/acervo"),
  indisponiveis: () => json("/acervo/indisponiveis"),
  removerAcervo: id => json(`/acervo/${encodeURIComponent(id)}`, { method: "DELETE" }),
  cancelarDownload: () => json("/download/cancelar", { method: "POST" }),
  reindexarAcervo: () => json("/acervo/reindexar", { method: "POST" }),
  verificarUpdates: () => json("/acervo/verificar-updates")
};

// Download em massa via SSE. Recebe os ITENS selecionados (id + metadados de
// serie/segmento/disciplina), para o servidor gravar a classificacao real no
// acervo. Chama os callbacks conforme os eventos chegam.
export function baixarEmMassa(itens, callbacks = {}) {
  const controlador = new AbortController();

  fetch("/api/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itens }),
    signal: controlador.signal
  })
    .then(async resposta => {
      if (!resposta.ok || !resposta.body) {
        const dados = await resposta.json().catch(() => ({}));
        throw new Error(dados?.erro || `HTTP ${resposta.status}`);
      }
      const leitor = resposta.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await leitor.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Eventos SSE separados por linha em branco.
        const blocos = buffer.split("\n\n");
        buffer = blocos.pop() || "";
        for (const bloco of blocos) {
          const linhaEvento = bloco.match(/event: (.+)/)?.[1];
          const linhaDados = bloco.match(/data: (.+)/)?.[1];
          if (linhaEvento && linhaDados) {
            callbacks[linhaEvento]?.(JSON.parse(linhaDados));
          }
        }
      }
    })
    .catch(erro => {
      if (erro.name !== "AbortError") callbacks.erro?.({ motivo: erro.message });
    });

  return () => controlador.abort();
}
