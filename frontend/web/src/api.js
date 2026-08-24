// Cliente do front -> servidor Express (/api). O navegador so fala com o nosso
// Express; quem fala com o AVA e o servidor.
//
// BASE da API: vazia por padrao (mesma origem — local, onde o dev server faz proxy
// de /api). No Render, front e back sao hosts DIFERENTES: define-se VITE_API_URL com
// a URL do backend. `credentials:"include"` em TODA chamada para o cookie de sessao
// (acervo_sid) viajar cross-origin — casa com o CORS-com-credenciais do backend.
const BASE_API = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");

async function json(caminho, opcoes = {}) {
  const resposta = await fetch(`${BASE_API}/api${caminho}`, {
    credentials: "include",
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
  // ids opcional: sem eles corrige TODO o acervo; com eles, so os selecionados.
  reindexarAcervo: (ids = []) =>
    json("/acervo/reindexar", { method: "POST", body: JSON.stringify({ ids }) }),
  // Verifica SO os ids selecionados; o backend persiste o resultado com data.
  verificarUpdates: ids =>
    json("/acervo/verificar-updates", { method: "POST", body: JSON.stringify({ ids }) }),
  // Historico da ultima verificacao por aula (para a coluna vir preenchida ao abrir).
  verificacoes: () => json("/acervo/verificacoes")
};

// Baixa a estrutura de LOs (zip) de um conteudo do acervo. NAO usa window.location
// (URL relativa cairia no frontend no Render, servindo o index.html -> "voltava pro
// catalogo"): busca via fetch em BASE_API com credenciais, le o blob e dispara o
// save no cliente. O nome do arquivo vem do Content-Disposition do servidor.
export async function baixarEstruturaLOs(id) {
  const resposta = await fetch(`${BASE_API}/api/acervo/${encodeURIComponent(id)}/estrutura`, {
    credentials: "include"
  });
  if (!resposta.ok) {
    const dados = await resposta.json().catch(() => ({}));
    throw new Error(dados?.erro || `HTTP ${resposta.status}`);
  }
  const blob = await resposta.blob();
  // Nome do arquivo: Content-Disposition (filename*=UTF-8''...) ou fallback.
  const cd = resposta.headers.get("Content-Disposition") || "";
  const m = /filename\*=UTF-8''([^;]+)/i.exec(cd) || /filename="?([^";]+)"?/i.exec(cd);
  const nome = m ? decodeURIComponent(m[1]) : `acervo-${id}.zip`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Download PUBLICAVEL (aulas Animate) via SSE: o servidor prepara o mirror verbatim do
// publicador (progresso por pagina) e, ao concluir, devolve um token. Aqui lemos o
// progresso e, no evento "pronto", buscamos o zip pelo token e disparamos o save.
// Callbacks: inicio({total}), pagina({pagina,total,nome}), fim({nome}), erro({motivo}).
// Retorna uma funcao para abortar.
export function baixarPublicavel(id, callbacks = {}) {
  const controlador = new AbortController();

  fetch(`${BASE_API}/api/acervo/${encodeURIComponent(id)}/publicavel`, {
    credentials: "include",
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

        const blocos = buffer.split("\n\n");
        buffer = blocos.pop() || "";
        for (const bloco of blocos) {
          const linhaEvento = bloco.match(/event: (.+)/)?.[1];
          const linhaDados = bloco.match(/data: (.+)/)?.[1];
          if (!linhaEvento || !linhaDados) continue;
          const dados = JSON.parse(linhaDados);

          if (linhaEvento === "pronto") {
            await salvarZipPublicavel(id, dados.token, dados.nome);
            callbacks.fim?.(dados);
          } else {
            callbacks[linhaEvento]?.(dados);
          }
        }
      }
    })
    .catch(erro => {
      if (erro.name !== "AbortError") callbacks.erro?.({ motivo: erro.message });
    });

  return () => controlador.abort();
}

// Busca o zip publicavel pelo token (uso unico) e dispara o save no cliente.
async function salvarZipPublicavel(id, token, nome) {
  const resposta = await fetch(
    `${BASE_API}/api/acervo/${encodeURIComponent(id)}/publicavel/zip?token=${encodeURIComponent(token)}`,
    { credentials: "include" }
  );
  if (!resposta.ok) {
    const dados = await resposta.json().catch(() => ({}));
    throw new Error(dados?.erro || `HTTP ${resposta.status}`);
  }
  const blob = await resposta.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome || `acervo-${id}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Download em massa via SSE. Recebe os ITENS selecionados (id + metadados de
// serie/segmento/disciplina), para o servidor gravar a classificacao real no
// acervo. Chama os callbacks conforme os eventos chegam.
export function baixarEmMassa(itens, callbacks = {}) {
  const controlador = new AbortController();

  fetch(`${BASE_API}/api/download`, {
    method: "POST",
    credentials: "include",
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
