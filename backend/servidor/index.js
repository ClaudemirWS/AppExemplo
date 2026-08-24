import express from "express";
import path from "node:path";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { login, estruturaFiltro } from "./avaApi.js";
import { varrerCatalogo } from "./catalogo.js";
import { baixarConteudo, montarClassificacao } from "./baixarConteudo.js";
import { obterRaizAcervo } from "../adaptadores/fsAcervo.js";
import { PASTA_CONTEUDOS_OFFLINE, MENSAGEM_AULA_INDISPONIVEL_OFFLINE } from "../nucleo-conteudo/constantes.js";
import { unzipSync, unzip, zipSync, Zip, ZipPassThrough, strFromU8, strToU8 } from "fflate";
import {
  removerDoManifestoR2,
  lerIndisponiveis,
  registrarIndisponivel,
  removerIndisponivel,
  lerVerificacoes,
  registrarVerificacoes
} from "./manifesto.js";
import { verificarLista } from "./verificadorVersao.js";
import { r2Configurado, subirObjeto, apagarObjeto, lerObjeto } from "./r2Cliente.js";
import { ehAdminEducandus } from "./autorizacao.js";
import {
  resolverDiscipline,
  segmentoEhInfantil,
  disciplinasDaEstrutura,
  DISCIPLINA_MATEMATICA
} from "./disciplinaMatematica.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PORTA = Number(process.env.PORT || 3100);

const app = express();

// CORS com CREDENCIAIS. No Render, front (static) e back (web service) tem origens
// DIFERENTES, e o cookie de sessao (acervo_sid) so viaja cross-origin se:
//   - o backend ecoa a origem exata em Access-Control-Allow-Origin (nunca "*" com
//     credenciais — o navegador recusa), e
//   - envia Access-Control-Allow-Credentials: true, e
//   - o front faz fetch com credentials:"include".
// A origem permitida vem de FRONTEND_URL (a URL do static site no Render). Sem ela,
// so mesma-origem funciona (local, onde front e back compartilham o host via proxy).
const FRONTEND_URL = (process.env.FRONTEND_URL || "").replace(/\/+$/, "");
app.use((req, res, next) => {
  const origem = req.headers.origin;
  // Ecoa a origem se casar com a permitida (ou em dev/local, qualquer localhost).
  const permitida =
    (FRONTEND_URL && origem === FRONTEND_URL) ||
    (origem && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origem));
  if (permitida) {
    res.setHeader("Access-Control-Allow-Origin", origem);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    // Sem isto, o JS cross-origin NAO consegue ler o Content-Disposition (o navegador
    // esconde headers de resposta por padrao) — e o download da estrutura cairia no
    // nome-fallback "acervo-<id>.zip" em vez do nome bonito "Nome da Aula [id].zip".
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
  }
  if (req.method === "OPTIONS") {
    res.statusCode = permitida ? 204 : 403;
    return res.end();
  }
  next();
});

app.use(express.json());

// Le um cookie do header, sem dependencia (prototipo). Ex.: "acervo_sid=abc; x=1".
function lerCookie(req, nome) {
  const bruto = req.headers?.cookie || "";
  for (const par of bruto.split(";")) {
    const [k, ...v] = par.trim().split("=");
    if (k === nome) return decodeURIComponent(v.join("="));
  }
  return null;
}

// SESSOES POR USUARIO (multiusuario). Antes era um `let sessao` global — funcionava
// no PC de um operador so, mas no servidor dois admins se sobrescreviam (o login de
// um trocava o token do outro). Agora cada admin tem sua sessao, identificada por um
// cookie opaco (`sid`). Em memoria: some no restart do servico (aceitavel p/ prototipo;
// o admin so refaz login). O `Map` evita vazamento ilimitado via um teto simples.
const SESSOES = new Map(); // sid -> { token, usuario, papeis, criadaEm }
const NOME_COOKIE_SESSAO = "acervo_sid";
const MAX_SESSOES = 200;

function novoSid() {
  return crypto.randomUUID();
}

function guardarSessao(dados) {
  // Teto simples: se estourar, descarta a mais antiga (prototipo, sem TTL sofisticado).
  if (SESSOES.size >= MAX_SESSOES) {
    const maisAntiga = [...SESSOES.entries()].sort((a, b) => a[1].criadaEm - b[1].criadaEm)[0];
    if (maisAntiga) SESSOES.delete(maisAntiga[0]);
  }
  const sid = novoSid();
  SESSOES.set(sid, { ...dados, criadaEm: Date.now() });
  return sid;
}

// Monta o Set-Cookie da sessao com os atributos certos para cada cenario:
//   - HTTPS (Render): SameSite=None; Secure — obrigatorio para o cookie viajar
//     cross-origin (front e back em hosts diferentes). Sem isso o navegador nao envia.
//   - local http (front e back same-origin via proxy): SameSite=Lax, sem Secure
//     (Secure exigiria HTTPS, que nao ha no dev). `valor` vazio + maxAge=0 = apagar.
function montarCookieSessao(req, valor, apagar = false) {
  const seguro = req.secure || req.headers["x-forwarded-proto"] === "https";
  const sameSite = seguro ? "None" : "Lax";
  const partes = [
    `${NOME_COOKIE_SESSAO}=${apagar ? "" : valor}`,
    "HttpOnly",
    `SameSite=${sameSite}`,
    "Path=/"
  ];
  if (seguro) partes.push("Secure");
  if (apagar) partes.push("Max-Age=0");
  return partes.join("; ");
}

// Cancelamento do download em curso. POR SESSAO agora (sid -> token de cancelamento),
// senao o "Parar" de um admin abortaria o download de outro. O loop consulta
// `.cancelado` entre itens; o nucleo o consulta entre recursos via `verificarCancelamento`.
const CANCELAMENTOS = new Map(); // sid -> { cancelado, signal }

// Falha PERMANENTE = o conteudo nao e baixavel offline (nenhuma pagina em formato
// suportado). Re-tentar da o mesmo resultado e parece loop. Falhas de rede
// (404/timeout de um recurso) NAO entram aqui — essas valem retry.
function ehFalhaPermanente(erro) {
  return String(erro?.message || "").includes(MENSAGEM_AULA_INDISPONIVEL_OFFLINE);
}

// Resolve a sessao do cookie e a injeta em req.sessao. Retorna false (e responde 401)
// se nao houver sessao valida — mesma assinatura de uso de antes, mas por usuario.
function exigirSessao(req, res) {
  const sid = lerCookie(req, NOME_COOKIE_SESSAO);
  const sessao = sid ? SESSOES.get(sid) : null;
  if (!sessao?.token) {
    res.status(401).json({ erro: "Não autenticado." });
    return false;
  }
  req.sid = sid;
  req.sessao = sessao;
  return true;
}

// Le o indice.json de dentro de um .zip do acervo, sem descompactar tudo.
async function lerIndiceDoZip(caminhoZip) {
  const bytes = new Uint8Array(await fs.readFile(caminhoZip));
  // Descompacta so o indice.json (fflate nao tem leitura parcial, mas o unzip e
  // rapido e o indice esta na raiz; pegamos so ele do resultado).
  const arquivos = unzipSync(bytes, { filter: f => f.name === "indice.json" });
  const bruto = arquivos["indice.json"];
  if (!bruto) throw new Error("indice.json ausente no zip");
  return JSON.parse(strFromU8(bruto));
}

// Lista o acervo lendo cada .zip. Cada item: o indice + o nome do arquivo zip
// (para remover/servir depois).
// Lista o acervo. Com R2 configurado, le o manifesto.json do BUCKET (uma requisicao,
// ja com todos os campos que a aba precisa — o manifesto foi estendido). Sem R2, cai
// no disco: le o indice.json de cada zip local.
async function lerAcervo() {
  if (r2Configurado()) {
    try {
      const bytes = await lerObjeto("manifesto.json");
      const manifesto = JSON.parse(bytes.toString("utf-8"));
      // Cada conteudo do manifesto ja tem os campos da tabela + `arquivo`.
      return manifesto.conteudos || [];
    } catch {
      // Bucket ainda sem manifesto (nada baixado): acervo vazio.
      return [];
    }
  }

  const base = path.join(obterRaizAcervo(), PASTA_CONTEUDOS_OFFLINE);
  let entradas;
  try {
    entradas = await fs.readdir(base, { withFileTypes: true });
  } catch {
    return [];
  }
  const itens = [];
  for (const e of entradas) {
    if (!e.isFile() || !e.name.endsWith(".zip")) continue;
    try {
      const indice = await lerIndiceDoZip(path.join(base, e.name));
      itens.push({ ...indice, arquivo: e.name });
    } catch {
      // zip sem indice legivel: ignora na visao
    }
  }
  return itens;
}

app.get("/api/health", (req, res) => {
  const sid = lerCookie(req, NOME_COOKIE_SESSAO);
  res.json({ ok: true, autenticado: Boolean(sid && SESSOES.get(sid)?.token) });
});

// --- Login ---
app.post("/api/login", async (req, res) => {
  try {
    const { usuario, senha } = req.body || {};
    if (!usuario || !senha) {
      return res.status(400).json({ erro: "Informe usuário e senha." });
    }
    const dados = await login({ usuario, senha });

    // Autenticou no AVA, mas so admin Educandus (role_id 1) usa o downloader.
    // Recusamos ANTES de guardar a sessao: sem token em memoria, nenhuma rota abre.
    if (!ehAdminEducandus(dados.papeis)) {
      return res.status(403).json({
        erro: "Acesso restrito a administradores Educandus."
      });
    }

    const sid = guardarSessao({ token: dados.token, usuario: dados.usuario, papeis: dados.papeis });
    res.setHeader("Set-Cookie", montarCookieSessao(req, sid));
    res.json({
      ok: true,
      usuario: dados.usuario?.name || usuario,
      papel: dados.papeis?.[0]?.role_name || ""
    });
  } catch (erro) {
    res.status(502).json({ erro: erro.message });
  }
});

app.post("/api/logout", (req, res) => {
  const sid = lerCookie(req, NOME_COOKIE_SESSAO);
  if (sid) SESSOES.delete(sid);
  res.setHeader("Set-Cookie", montarCookieSessao(req, "", true));
  res.json({ ok: true });
});

// Componentes que a CONTA logada tem direito, derivados do filterStructureObjective
// (a mesma fonte do seletor do AVA), unindo Aula(1) e Jogo(2). Como o downloader usa a
// mesma conta do AVA, isto reproduz o recorte por grupo (Flash + segmentos) do AVA.
async function disciplinasDisponiveis(token) {
  const vistos = new Map(); // id -> rotulo
  for (const tipo of [1, 2]) {
    let estrutura = null;
    try {
      estrutura = await estruturaFiltro(token, tipo);
    } catch {
      estrutura = null; // um tipo indisponivel nao derruba o outro
    }
    for (const d of disciplinasDaEstrutura(estrutura)) {
      if (!vistos.has(d.id)) vistos.set(d.id, d.rotulo);
    }
  }
  return [...vistos.entries()]
    .map(([id, rotulo]) => ({ id, rotulo }))
    .sort((a, b) => String(a.rotulo).localeCompare(String(b.rotulo), "pt-BR"));
}

// --- Disciplinas expostas no seletor "Componente" (dinamicas, escopadas pela conta) ---
app.get("/api/disciplinas", async (req, res) => {
  if (!exigirSessao(req, res)) return;
  try {
    res.json({ disciplinas: await disciplinasDisponiveis(req.sessao.token) });
  } catch (erro) {
    res.status(502).json({ erro: erro.message });
  }
});

// --- Taxonomia (povoa os selects de segmento/serie) ---
// Depende da DISCIPLINA escolhida (query `disciplina`, default Matematica): so entram
// as series que tenham aquele componente. Para cada serie guardamos o id real da
// disciplina naquela serie (`disciplinaSerieId`) — no Fundamental e o proprio id; no
// Infantil de Matematica e o ETQRT (27). Series sem o componente ficam de fora (por
// isso o Infantil some quando a disciplina nao tem equivalente Infantil, ex.: Portugues).
app.get("/api/taxonomia", async (req, res) => {
  if (!exigirSessao(req, res)) return;
  try {
    const alvoId = Number(req.query.disciplina || DISCIPLINA_MATEMATICA);
    const resposta = await estruturaFiltro(req.sessao.token, 1); // tipo 1 = Aula
    const segmentos = [];
    for (const seg of resposta?.data || []) {
      const infantil = segmentoEhInfantil(seg?.name);
      const series = [];
      for (const s of seg?.series || []) {
        // Casamento por id (modelo flat): a serie so entra se ofertar exatamente o
        // componente escolhido. No Infantil o campo BNCC ja e o proprio componente.
        const disc = (s?.disciplines || []).find(d => Number(d?.id) === alvoId);
        if (!disc || s?.id == null) continue;
        series.push({ id: s.id, nome: s.name, disciplinaSerieId: alvoId });
      }
      if (series.length) {
        segmentos.push({ id: seg.id, nome: seg.name, infantil, series });
      }
    }
    res.json({ disciplina: alvoId, segmentos });
  } catch (erro) {
    res.status(502).json({ erro: erro.message });
  }
});

// --- Varredura de catalogo (lista completa do filtro) ---
app.get("/api/catalogo", async (req, res) => {
  if (!exigirSessao(req, res)) return;
  try {
    const { tipo, segment, serie, word, infantil, disciplina, disciplinaSerie } = req.query;
    const temSegmento = Boolean(segment);
    const temSerie = Boolean(serie);
    const ehInfantil = infantil === "true" || infantil === "1";

    // "Todos": tipo vazio => Aula(1) + Jogo(2); disciplina vazia => todas as disciplinas.
    // O AVA exige type e discipline especificos por scan, entao varremos cada combinacao
    // e mesclamos por id (mesma tatica do reindex). Com filtros unicos, e um scan so.
    const tipos = tipo ? [Number(tipo)] : [1, 2];
    const disciplinas = disciplina
      ? [Number(disciplina)]
      : (await disciplinasDisponiveis(req.sessao.token)).map(d => d.id);

    const porId = new Map();
    let paginasLidas = 0;
    let truncado = false;

    for (const t of tipos) {
      for (const dId of disciplinas) {
        const discipline = resolverDiscipline({
          temSegmento,
          ehInfantil,
          temSerie,
          disciplinaSerieId: disciplinaSerie ? Number(disciplinaSerie) : null,
          disciplinaId: dId
        });
        const r = await varrerCatalogo(req.sessao.token, {
          tipo: t,
          discipline,
          segment: temSegmento ? Number(segment) : null,
          serie: temSerie ? Number(serie) : null,
          word: word || ""
        });
        paginasLidas += r.paginasLidas;
        truncado = truncado || r.truncado;
        for (const item of r.itens) {
          const existente = porId.get(item.id);
          if (!existente) { porId.set(item.id, item); continue; }
          // Ja visto (outra disciplina/tipo): acumula classificacoes novas.
          for (const c of item.classificacoes || []) {
            const jaTem = existente.classificacoes.some(
              x => (x.segmentoId ?? "") === (c.segmentoId ?? "") && (x.serieId ?? "") === (c.serieId ?? "")
            );
            if (!jaTem) existente.classificacoes.push(c);
          }
        }
      }
    }

    const itens = [...porId.values()];
    res.json({ itens, total: itens.length, paginasLidas, truncado });
  } catch (erro) {
    res.status(502).json({ erro: erro.message });
  }
});

// --- Fila de download em massa (SSE) ---
// Recebe a lista de ids marcados e baixa um a um, emitindo eventos de progresso.
app.post("/api/download", async (req, res) => {
  if (!exigirSessao(req, res)) return;
  // Aceita `itens` (id + classificacoes/disciplina/habilidade) ou, por
  // compatibilidade, `ids` cru.
  const itensEntrada = Array.isArray(req.body?.itens)
    ? req.body.itens
    : Array.isArray(req.body?.ids)
      ? req.body.ids.map(id => ({ id }))
      : [];
  const metaPorId = new Map(itensEntrada.map(i => [String(i.id), i]));
  const ids = [...metaPorId.keys()];
  if (!ids.length) {
    return res.status(400).json({ erro: "Nenhum id informado." });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Impede o proxy (Vite/nginx) de bufferizar o stream — sem isso os eventos
    // chegam em lote e o item que ja esta baixando aparece "na fila" na tela.
    "X-Accel-Buffering": "no"
  });
  // Manda os headers imediatamente; senao o Express pode segurar ate encher buffer.
  res.flushHeaders?.();
  const enviar = (evento, dados) => {
    res.write(`event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`);
    // Empurra cada evento na hora (quando o compression/stack expõe flush).
    res.flush?.();
  };

  // NAO usar req.on("close") para cancelar a fila: sob o proxy do Vite esse evento
  // dispara logo no inicio (a conexao e reciclada), e como falso-positivo matava a
  // fila depois do 1o item — comprovado no log real (FILA_REQ_CLOSE no item 1/15).
  //
  // O cancelamento real vem do cliente: o botao "Cancelar" aborta o fetch, o
  // servidor detecta a escrita falhar (res.writableEnded / erro no write) e para.
  let clienteDesconectou = false;
  res.on("close", () => {
    // `res` close = a RESPOSTA terminou. So tratamos como desconexao real se ainda
    // nao terminamos de enviar tudo (senao e o fim normal do stream).
    if (!res.writableFinished) {
      clienteDesconectou = true;
    }
  });

  // Token de cancelamento desta corrida, POR SESSAO. `.cancelado` e lido pelo loop e
  // pelo nucleo (verificarCancelamento) — o "Parar" do PROPRIO admin seta isso via
  // /download/cancelar. Guardado por sid para o Parar de um nao abortar o de outro.
  const controlador = new AbortController();
  const tokenCancelamento = { cancelado: false, signal: controlador.signal };
  CANCELAMENTOS.set(req.sid, tokenCancelamento);
  const paradoPeloUsuario = () => tokenCancelamento.cancelado;

  enviar("inicio", { total: ids.length });

  // Quantas vezes re-tentar a AULA INTEIRA se ela terminar com erro. O objetivo e
  // baixar todos os selecionados — nao pular por uma falha transitoria de rede.
  const TENTATIVAS_CONTEUDO = Number(process.env.ACERVO_TENTATIVAS_CONTEUDO || 4);

  const deveParar = () => clienteDesconectou || paradoPeloUsuario();

  // Ids baixados com sucesso: ao baixar, a copia local passa a ser a versao publicada
  // mais recente, entao a aula fica "em dia". Persistimos isso no fim (registrarVerificacoes)
  // para a coluna "Atualizacao" refletir "em dia" com a data de agora, sem exigir um
  // Verificar manual depois.
  const baixadosOk = [];

  for (const [indice, id] of ids.entries()) {
    if (deveParar()) {
      console.warn(`[AVA_DOWNLOAD] FILA_INTERROMPIDA no indice ${indice} (id=${id}) — ${paradoPeloUsuario() ? "parado pelo usuario" : "cliente desconectou"}`);
      break;
    }
    console.info(`[AVA_DOWNLOAD] FILA_ITEM ${indice + 1}/${ids.length} id=${id}`);
    enviar("item-inicio", { id, indice, total: ids.length });

    let ultimoErro = null;
    let sucesso = false;

    for (let tentativa = 1; tentativa <= TENTATIVAS_CONTEUDO && !deveParar(); tentativa += 1) {
      if (tentativa > 1) {
        enviar("progresso", { id, pct: 0, retentando: tentativa });
        console.warn(`[AVA_DOWNLOAD] CONTEUDO_RETRY id=${id} tentativa=${tentativa}/${TENTATIVAS_CONTEUDO}`);
      }
      try {
        const { detalhes, indice: indiceAcervo } = await baixarConteudo({
          token: req.sessao.token,
          conteudoId: id,
          cancelToken: tokenCancelamento,
          // Classificacao real do catalogo, para gravar no indice do acervo.
          metadadosCatalogo: metaPorId.get(id) || null,
          // O nucleo emite { percentual } (objeto), nao um numero. Ler o campo.
          onProgresso: p => enviar("progresso", { id, pct: Math.round(Number(p?.percentual) || 0) })
        });
        enviar("item-fim", {
          id,
          nome: detalhes.nome,
          formato: indiceAcervo.formato,
          formatos: indiceAcervo.formatos,
          paginas: indiceAcervo.paginasBaixadas,
          status: "ok"
        });
        // Baixou: se estava marcado como indisponivel (publicador consertou), limpa.
        try {
          await removerIndisponivel(id);
        } catch (e) {
          console.warn(`[AVA_DOWNLOAD] INDISP_LIMPAR_FALHOU id=${id}: ${e?.message || e}`);
        }
        sucesso = true;
        baixadosOk.push(id);
        break;
      } catch (erro) {
        ultimoErro = erro;
        // Cancelamento do usuario nao e "erro a re-tentar": sai na hora.
        if (paradoPeloUsuario()) break;
        // Falha PERMANENTE (o conteudo simplesmente nao e baixavel offline —
        // nenhuma pagina suportada, ou paginas com erro de formato) NAO deve
        // re-tentar: re-baixar da o mesmo resultado e parece loop. So falhas de
        // rede se beneficiam do retry.
        if (ehFalhaPermanente(erro)) {
          console.warn(`[AVA_DOWNLOAD] CONTEUDO_INVIAVEL id=${id} — nao re-tenta: ${erro?.message || ""}`);
          break;
        }
        // espera crescente entre tentativas da aula inteira
        if (tentativa < TENTATIVAS_CONTEUDO && !deveParar()) {
          await new Promise(r => setTimeout(r, 1500 * tentativa));
        }
      }
    }

    if (!sucesso && !deveParar()) {
      const indisponivel = ehFalhaPermanente(ultimoErro);
      const motivo = ultimoErro?.message || "Falha ao baixar.";
      // Indisponivel PERSISTE (sobrevive a reiniciar o servidor): registra num arquivo
      // separado, com o que sabemos do item pelo catalogo. Erro transitorio NAO — pode
      // voltar a funcionar sozinho e nao queremos marca-lo.
      if (indisponivel) {
        const meta = metaPorId.get(id) || {};
        try {
          await registrarIndisponivel({
            id,
            nome: meta.nome || "",
            habilidade: meta.habilidade || "",
            serieNome: meta.serieNome || "",
            motivo
          });
        } catch (e) {
          console.warn(`[AVA_DOWNLOAD] INDISP_REGISTRAR_FALHOU id=${id}: ${e?.message || e}`);
        }
      }
      enviar("item-fim", {
        id,
        status: indisponivel ? "indisponivel" : "erro",
        motivo
      });
    } else if (!sucesso && paradoPeloUsuario()) {
      enviar("item-fim", { id, status: "cancelado" });
    }
  }

  // Marca os baixados como "em dia" (versao recem-baixada = a mais recente), com a data
  // de agora. Assim o "Atualizar" do acervo reflete na coluna "Atualizacao" sem precisar
  // de um Verificar manual. Best-effort: falha aqui nao invalida o download.
  if (baixadosOk.length) {
    try {
      await registrarVerificacoes(baixadosOk.map(id => ({ id, situacao: "atualizado", paginas: [] })));
      console.info(`[AVA_DOWNLOAD] VERIFICACAO_ATUALIZADO ok ids=${baixadosOk.join(",")}`);
    } catch (e) {
      console.warn(`[AVA_DOWNLOAD] VERIFICACAO_ATUALIZADO_FALHOU: ${e?.message || e}`);
    }
  } else {
    console.info(`[AVA_DOWNLOAD] VERIFICACAO_ATUALIZADO pulado (nenhum baixado com sucesso)`);
  }

  const foiCancelado = clienteDesconectou || paradoPeloUsuario();
  enviar("fim", { cancelado: foiCancelado });
  res.end();
  // Libera o token desta sessao so se ainda for o desta corrida (evita apagar o de
  // um novo download que o mesmo admin tenha comecado).
  if (CANCELAMENTOS.get(req.sid) === tokenCancelamento) {
    CANCELAMENTOS.delete(req.sid);
  }
});

// --- Parar o download em curso (do proprio admin) ---
app.post("/api/download/cancelar", (req, res) => {
  if (!exigirSessao(req, res)) return;
  const token = CANCELAMENTOS.get(req.sid);
  if (token) {
    token.cancelado = true;
    console.warn("[AVA_DOWNLOAD] CANCELAMENTO solicitado pelo usuario");
    return res.json({ ok: true, cancelando: true });
  }
  res.json({ ok: true, cancelando: false });
});

// --- Acervo baixado ---
app.get("/api/acervo", async (_req, res) => {
  try {
    res.json({ itens: await lerAcervo() });
  } catch (erro) {
    res.status(500).json({ erro: erro.message });
  }
});

// --- Conteudos INDISPONIVEIS (falha permanente, sem zip) ---
// Persistidos num arquivo separado (ver manifesto.js). O Catalogo le para sinalizar
// "indisponivel" mesmo apos reiniciar o servidor. So um sinal — nao bloqueia baixar.
app.get("/api/acervo/indisponiveis", async (_req, res) => {
  try {
    res.json({ itens: await lerIndisponiveis() });
  } catch (erro) {
    res.status(500).json({ erro: erro.message });
  }
});

// --- Historico de verificacoes (por aula, com data) ---
// Lido ao abrir a aba Acervo para a coluna "Atualizacao" ja vir preenchida com a
// ultima verificacao de cada aula. Mapa { id -> {situacao, verificadoEm, ...} }.
app.get("/api/acervo/verificacoes", async (_req, res) => {
  try {
    res.json({ itens: await lerVerificacoes() });
  } catch (erro) {
    res.status(500).json({ erro: erro.message });
  }
});

// --- Verificar atualizacoes (versao nova de alguma pagina) ---
// Compara o vN gravado de cada aula com o vN atual do publicador. NAO baixa aulas.
// Verifica SO os ids enviados (selecao da tela) — mais rapido e nao estoura no free
// tier. Persiste o resultado com data (registrarVerificacoes) para a coluna sobreviver
// ao reload. Precisa de sessao (usa o token do login para consultar o publicador).
// Devolve { total, resultados:[{id, situacao, paginas}] }.
app.post("/api/acervo/verificar-updates", async (req, res) => {
  if (!exigirSessao(req, res)) return;
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    if (!ids.length) return res.status(400).json({ erro: "Nenhuma aula selecionada." });

    const acervo = await lerAcervo();
    const alvo = acervo.filter(item => ids.includes(String(item.id)));
    if (!alvo.length) return res.json({ total: 0, resultados: [] });

    const resultado = await verificarLista(alvo);
    // Persiste com carimbo de data (nao bloqueia a resposta se a gravacao falhar).
    try {
      await registrarVerificacoes(resultado.resultados);
    } catch (e) {
      console.warn(`[AVA_DOWNLOAD] VERIFICACAO_PERSIST_FALHOU: ${e?.message || e}`);
    }
    res.json(resultado);
  } catch (erro) {
    res.status(502).json({ erro: erro.message });
  }
});

// --- Remover um conteudo do acervo ---
// Apaga por ID: acha o .zip cujo indice.json tem esse id e o remove. Localizar
// pelo indice (nao pelo nome na URL) evita path traversal.
app.delete("/api/acervo/:id", async (req, res) => {
  const id = String(req.params.id || "");
  try {
    const itens = await lerAcervo();
    const alvo = itens.find(i => String(i.id) === id);
    if (!alvo) {
      return res.status(404).json({ erro: "Conteúdo não encontrado no acervo."});
    }

    if (r2Configurado()) {
      await apagarObjeto(alvo.arquivo);
      // Remove a entrada do manifesto de forma incremental (nao rele os zips).
      await removerDoManifestoR2(id);
    } else {
      const base = path.join(obterRaizAcervo(), PASTA_CONTEUDOS_OFFLINE);
      await fs.rm(path.join(base, alvo.arquivo), { force: true });
    }
    res.json({ ok: true, id });
  } catch (erro) {
    res.status(500).json({ erro: erro.message });
  }
});

// --- Baixar a estrutura de LOs de um conteudo ---
// Reempacota o zip do acervo no formato pedido pelo usuario:
//   Nome da Aula [externalId-da-aula]/<externalId-do-LO>/... (arquivos reais) + <externalId>.txt vazio
// Mapeia cada pasta pagina-N/ para o externalId daquela pagina (via indice.paginas).
// Feito no servidor porque ele ja tem o zip em disco (evita rebaixar 496 arquivos no front).
function nomeSeguroAcervo(texto, alt) {
  const limpo = String(texto || "")
    .replace(/[<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .trim();
  return limpo || alt;
}

app.get("/api/acervo/:id/estrutura", async (req, res) => {
  const id = String(req.params.id || "");
  try {
    const itens = await lerAcervo();
    const alvo = itens.find(i => String(i.id) === id);
    if (!alvo) return res.status(404).json({ erro: "Conteúdo não encontrado no acervo."});

    // Le o zip do R2 (fonte atual) ou do disco (fallback).
    const bytesRaw = r2Configurado()
      ? await lerObjeto(alvo.arquivo)
      : await fs.readFile(path.join(obterRaizAcervo(), PASTA_CONTEUDOS_OFFLINE, alvo.arquivo));
    // Descompacta de forma ASSINCRONA (nao trava o event loop como unzipSync — no free
    // tier isso importava). `origem` = { caminho: Uint8Array }.
    const origem = await new Promise((resolve, reject) =>
      unzip(new Uint8Array(bytesRaw), (err, dados) => (err ? reject(err) : resolve(dados)))
    );
    const indice = JSON.parse(strFromU8(origem["indice.json"]));

    // Mapa: "pagina-<ordem>" -> externalId daquela pagina.
    const extPorPagina = new Map();
    for (const p of indice.paginas || []) {
      if (p.externalId) extPorPagina.set(`pagina-${p.ordem}`, String(p.externalId));
    }

    const raiz = nomeSeguroAcervo(`${indice.nome} [${indice.externalId || indice.id}]`, `Conteudo [${id}]`);

    // Monta a lista de entradas do zip de saida (nome final -> bytes), sem ainda
    // recomprimir nada. A recompressao acontece ESCOANDO abaixo, um arquivo por vez.
    // `nomes` evita caminhos duplicados: o zip de origem ja pode conter um
    // <externalId>.txt dentro da pagina — sem esta guarda, o .txt vazio adicionado
    // abaixo colidiria e um dos dois se perderia ao reabrir o zip.
    const entradas = [];
    const nomes = new Set();
    for (const [caminho, conteudo] of Object.entries(origem)) {
      if (caminho === "indice.json") continue;               // metadado interno, nao entra
      const barra = caminho.indexOf("/");
      if (barra < 0) continue;                                // arquivo solto na raiz (ex.: thumb) — ignora
      const pastaPagina = caminho.slice(0, barra);            // "pagina-1"
      const resto = caminho.slice(barra + 1);                 // "appmanifest.json"
      const ext = extPorPagina.get(pastaPagina);
      if (!ext) continue;                                     // pagina sem externalId (legado) — sem "LO"
      const nome = `${raiz}/${ext}/${resto}`;
      if (nomes.has(nome)) continue;
      nomes.add(nome);
      entradas.push([nome, conteudo]);                        // arquivos reais na pasta do LO
    }
    // Um .txt vazio por LO — so se ainda nao existir esse caminho (ver nota acima).
    for (const ext of extPorPagina.values()) {
      const nome = `${raiz}/${ext}/${ext}.txt`;
      if (nomes.has(nome)) continue;
      nomes.add(nome);
      entradas.push([nome, strToU8("")]);
    }

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(`${raiz}.zip`)}`
    );

    // ESCOA o zip para o cliente em pedacos (fflate Zip streaming): cada chunk gerado
    // e escrito no res na hora, em vez de montar o zip inteiro em memoria + Buffer.from
    // (que duplicava tudo). Isso mantem o pico de RAM baixo — o que estourava no free
    // tier do Render (502). ZipPassThrough = STORE (sem recomprimir): os assets de aula
    // ja sao majoritariamente comprimidos, entao evita o custo de CPU/RAM da deflate.
    await new Promise((resolve, reject) => {
      const zip = new Zip((err, chunk, final) => {
        if (err) return reject(err);
        res.write(Buffer.from(chunk));
        if (final) resolve();
      });
      for (const [nome, bytes] of entradas) {
        const arq = new ZipPassThrough(nome);
        zip.add(arq);
        arq.push(bytes, true); // true = ultimo (e o unico) chunk deste arquivo
      }
      zip.end();
    });
    res.end();
  } catch (erro) {
    // Se ja comecamos a escoar o zip, nao da para trocar para JSON de erro — so encerra.
    if (res.headersSent) { res.end(); }
    else { res.status(500).json({ erro: erro.message }); }
  }
});

// --- Reindexar o acervo (sem re-baixar) ---
// Corrige os indice.json antigos que nao tem classificacao real. Faz UMA varredura
// completa do catalogo (por segmento, para o discipline certo — Infantil=27) e
// cruza por id com o que esta no disco, reescrevendo so os metadados.
app.post("/api/acervo/reindexar", async (req, res) => {
  if (!exigirSessao(req, res)) return;
  try {
    // 1. Ler o acervo atual (lista de zips). `ids` opcional no corpo restringe a
    //    correcao aos selecionados; ausente/vazio = corrige TODO o acervo.
    const base = path.join(obterRaizAcervo(), PASTA_CONTEUDOS_OFFLINE);
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    let doAcervo = await lerAcervo();
    if (ids.length) doAcervo = doAcervo.filter(item => ids.includes(String(item.id)));
    if (!doAcervo.length) {
      return res.json({ ok: true, reindexados: 0, naoEncontrados: 0 });
    }

    // 2. Varrer o catalogo inteiro por segmento E por disciplina, acumulando a
    //    classificacao real de cada id. tipo 1 = Aula, 2 = Jogo. Varre TODOS os
    //    componentes que a conta tem direito (derivados do filterStructureObjective)
    //    porque o acervo pode ter conteudo de qualquer um — reindexar so um deles
    //    deixaria os demais sem reclassificacao ("nao encontrado" a toa).
    const taxonomia = await estruturaFiltro(req.sessao.token, 1);
    const segmentos = (taxonomia?.data || []).map(s => ({
      id: s.id,
      infantil: segmentoEhInfantil(s?.name)
    }));
    const catalogoPorId = new Map();
    for (const disc of await disciplinasDisponiveis(req.sessao.token)) {
      for (const tipo of [1, 2]) {
        for (const seg of segmentos) {
          const discipline = resolverDiscipline({
            temSegmento: true,
            ehInfantil: seg.infantil,
            temSerie: false,
            disciplinaSerieId: null,
            disciplinaId: disc.id
          });
          const r = await varrerCatalogo(req.sessao.token, {
            tipo,
            discipline,
            segment: seg.id,
            serie: null
          });
          for (const item of r.itens) {
            const existente = catalogoPorId.get(item.id);
            if (!existente) {
              catalogoPorId.set(item.id, item);
            } else {
              // acumula classificacoes de segmentos diferentes
              for (const c of item.classificacoes || []) {
                const chave = `${c.segmentoId ?? ""}|${c.serieId ?? ""}`;
                if (!existente.classificacoes.some(x => `${x.segmentoId ?? ""}|${x.serieId ?? ""}` === chave)) {
                  existente.classificacoes.push(c);
                }
              }
            }
          }
        }
      }
    }

    // 3. Reescrever o indice.json DENTRO de cada zip com a classificacao encontrada.
    //    Abre o zip, atualiza o indice, re-zipa. So mexe em quem casou no catalogo.
    let reindexados = 0;
    let naoEncontrados = 0;
    for (const item of doAcervo) {
      const doCatalogo = catalogoPorId.get(String(item.id));
      if (!doCatalogo) {
        naoEncontrados += 1;
        continue;
      }
      const caminhoZip = path.join(base, item.arquivo);
      const bytes = new Uint8Array(await fs.readFile(caminhoZip));
      const arquivos = unzipSync(bytes);
      let indice;
      try {
        indice = JSON.parse(strFromU8(arquivos["indice.json"]));
      } catch {
        continue;
      }
      const cls = montarClassificacao(doCatalogo);
      Object.assign(indice, {
        disciplinaId: cls.disciplinaId,
        disciplina: cls.disciplina,
        habilidade: cls.habilidade,
        classificacoes: cls.classificacoes,
        seriesIds: cls.seriesIds,
        segmentosIds: cls.segmentosIds
      });
      arquivos["indice.json"] = strToU8(JSON.stringify(indice, null, 2));
      await fs.writeFile(caminhoZip, zipSync(arquivos, { level: 6 }));
      reindexados += 1;
    }

    console.info(`[AVA_DOWNLOAD] REINDEX ok=${reindexados} naoEncontrados=${naoEncontrados}`);
    res.json({ ok: true, reindexados, naoEncontrados });
  } catch (erro) {
    res.status(502).json({ erro: erro.message });
  }
});

// Bind: local fica em 127.0.0.1 (so a propria maquina). No Render (e qualquer host),
// precisa aceitar conexoes externas -> 0.0.0.0. Controlado por HOST; o Render deve
// definir HOST=0.0.0.0 nas envs. Default local, mais seguro para uso no PC.
const HOST = process.env.HOST || "127.0.0.1";
const servidorHttp = app.listen(PORTA, HOST, () => {
  console.log(`[acervo] servidor em http://${HOST}:${PORTA}`);
  console.log(`[acervo] acervo em ${obterRaizAcervo()}`);
});

// Mantem o processo vivo. Necessario porque o carregamento do @aws-sdk/client-s3
// (cliente R2) faz o socket do servidor deixar de "segurar" o event loop no Node —
// sem isto, o processo encerra logo apos o listen (o servidor subia e saia com
// exit 0, derrubando o `concurrently` junto). O keep-alive e barato e inofensivo.
servidorHttp.ref?.();
setInterval(() => {}, 1 << 30);
