// Cliente minimo da API do AVA para o downloader.
//
// Nao reusa a cadeia clienteApi/authApi do PWA de proposito: aquela monta uma
// "sessao de aluno" e REJEITA quem nao e aluno (montarSessaoAluno lanca
// "Acesso disponivel apenas para alunos"). Aqui o login e de admin, e so
// precisamos do token e das rotas de conteudo — nada de perfil/turmas/gamificacao.
//
// Espelha o contrato verificado no backend Laravel. NAO usa nenhum truque de
// escopo (nao fura cache, nao omite `private`, nao varre por id): manda
// `private: false` e respeita o que o backend devolver, como o PWA faz.

const BASE_BACKEND = (
  process.env.ACERVO_BASE_BACKEND || "https://backhomologa.educandus.com.br"
).replace(/\/+$/, "");
const BASE_API = `${BASE_BACKEND}/api/`;
const TIMEOUT_MS = Number(process.env.ACERVO_TIMEOUT_MS || 20000);

async function requisicao(caminho, { method = "GET", token = "", corpo = null } = {}) {
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), TIMEOUT_MS);
  const url = new URL(caminho, BASE_API).toString();

  let resposta;
  try {
    resposta = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        ...(corpo ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: controlador.signal
    });
  } catch (erro) {
    clearTimeout(timer);
    // O `fetch` do Node embrulha a causa real em erro.cause. Sem isso, tudo vira
    // um "fetch failed" opaco. Os codigos mais provaveis aqui:
    //   UNABLE_TO_VERIFY_LEAF_SIGNATURE / cadeia incompleta -> SPEC 4.1.1, o
    //   backhomologa serve so a folha, e o Node valida estrito como o openssl.
    const causa = erro?.cause;
    const codigo = causa?.code || erro?.code || "";
    const detalhe = causa?.message || erro?.message || "erro de rede";
    const nova = new Error(`Falha de conexao com ${url} — ${codigo ? codigo + ": " : ""}${detalhe}`);
    nova.codigo = codigo;
    nova.url = url;
    throw nova;
  }

  try {
    const texto = await resposta.text();
    let dados;
    try {
      dados = texto ? JSON.parse(texto) : null;
    } catch {
      dados = { success: false, raw: texto };
    }

    if (!resposta.ok || dados?.success === false) {
      const msg = dados?.error || dados?.message || `HTTP ${resposta.status}`;
      const erro = new Error(`Falha na API do AVA (${caminho}): ${msg}`);
      erro.status = resposta.status;
      throw erro;
    }

    return dados;
  } finally {
    clearTimeout(timer);
  }
}

// POST login {username,password,type:"username"} -> data.token
export async function login({ usuario, senha }) {
  const resposta = await requisicao("login", {
    method: "POST",
    corpo: { username: usuario, password: senha, type: "username" }
  });

  const dados = resposta?.data || resposta;
  const token = dados?.token || dados?.access_token;

  if (!token) {
    throw new Error("Login sem token na resposta.");
  }

  return {
    token,
    usuario: dados?.user || null,
    papeis: dados?.user_role || []
  };
}

// POST content/los/listLibraryFilter — catalogo paginado. Espelha o corpo do PWA.
// Filtros: type, segment, serie, discipline, thematic_unit, word (busca), page,
// page_size. Manda private:false como o PWA.
export async function listarBiblioteca(token, filtros = {}) {
  const {
    tipo = 1,
    segment = null,
    serie = null,
    discipline = 1,
    thematicUnit = null,
    ability = null,
    word = "",
    pagina = 1,
    porPagina = 16
  } = filtros;

  const corpo = {
    ability: ability || null,
    content: true,
    discipline,
    favorites: false,
    module: false,
    private: false,
    segment: segment ?? null,
    serie: serie ?? null,
    type: tipo,
    thematic_unit: thematicUnit || null
  };

  if (word && String(word).trim()) {
    corpo.word = String(word).trim();
  }

  return requisicao(`content/los/listLibraryFilter?page=${pagina}&page_size=${porPagina}`, {
    method: "POST",
    token,
    corpo
  });
}

// GET content/los/filterStructureObjective/{tipoId}[?bncc=module]
export async function estruturaFiltro(token, tipoId, { bncc = "" } = {}) {
  const query = bncc ? `?bncc=${encodeURIComponent(bncc)}` : "";
  return requisicao(`content/los/filterStructureObjective/${tipoId}${query}`, { token });
}

// GET content/los/listLosLos/{id} -> LO pai com children (paginas)
export async function listarPaginas(token, conteudoId) {
  return requisicao(`content/los/listLosLos/${conteudoId}`, { token });
}

// GET content/los/singleView/{id} -> metadados do LO (fallback de pagina unica)
export async function verConteudo(token, conteudoId) {
  return requisicao(`content/los/singleView/${conteudoId}`, { token });
}
