import express from "express";
import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { login, estruturaFiltro } from "./avaApi.js";
import { varrerCatalogo } from "./catalogo.js";
import { baixarConteudo, montarClassificacao } from "./baixarConteudo.js";
import { obterRaizAcervo } from "../adaptadores/fsAcervo.js";
import { PASTA_CONTEUDOS_OFFLINE, MENSAGEM_AULA_INDISPONIVEL_OFFLINE } from "../nucleo-conteudo/constantes.js";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import {
  removerDoManifestoR2,
  lerIndisponiveis,
  registrarIndisponivel,
  removerIndisponivel
} from "./manifesto.js";
import { verificarLista } from "./verificadorVersao.js";
import { r2Configurado, subirObjeto, apagarObjeto, lerObjeto } from "./r2Cliente.js";
import { ehAdminEducandus } from "./autorizacao.js";
import {
  ehComponenteDaDisciplina,
  resolverDiscipline,
  segmentoEhInfantil,
  listarDisciplinas,
  disciplinaPorId,
  DISCIPLINA_MATEMATICA
} from "./disciplinaMatematica.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PORTA = Number(process.env.PORT || 3100);

const app = express();
app.use(express.json());

// Sessao unica em memoria. Ferramenta pessoal, um usuario, um processo.
let sessao = null;

// Cancelamento do download em curso. Um download por vez (single-user), entao um
// token de modulo basta. O loop consulta `.cancelado` entre itens, e o proprio
// nucleo o consulta entre recursos via `verificarCancelamento` — entao "Parar"
// interrompe no meio de uma aula, nao so entre aulas.
let cancelamentoDownload = null;

// Falha PERMANENTE = o conteudo nao e baixavel offline (nenhuma pagina em formato
// suportado). Re-tentar da o mesmo resultado e parece loop. Falhas de rede
// (404/timeout de um recurso) NAO entram aqui — essas valem retry.
function ehFalhaPermanente(erro) {
  return String(erro?.message || "").includes(MENSAGEM_AULA_INDISPONIVEL_OFFLINE);
}

function exigirSessao(res) {
  if (!sessao?.token) {
    res.status(401).json({ erro: "Nao autenticado." });
    return false;
  }
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

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, autenticado: Boolean(sessao?.token) });
});

// --- Login ---
app.post("/api/login", async (req, res) => {
  try {
    const { usuario, senha } = req.body || {};
    if (!usuario || !senha) {
      return res.status(400).json({ erro: "Informe usuario e senha." });
    }
    const dados = await login({ usuario, senha });

    // Autenticou no AVA, mas so admin Educandus (role_id 1) usa o downloader.
    // Recusamos ANTES de guardar a sessao: sem token em memoria, nenhuma rota abre.
    if (!ehAdminEducandus(dados.papeis)) {
      return res.status(403).json({
        erro: "Acesso restrito a administradores Educandus."
      });
    }

    sessao = { token: dados.token, usuario: dados.usuario, papeis: dados.papeis };
    res.json({
      ok: true,
      usuario: dados.usuario?.name || usuario,
      papel: dados.papeis?.[0]?.role_name || ""
    });
  } catch (erro) {
    res.status(502).json({ erro: erro.message });
  }
});

app.post("/api/logout", (_req, res) => {
  sessao = null;
  res.json({ ok: true });
});

// --- Disciplinas expostas no seletor "Componente" ---
app.get("/api/disciplinas", (_req, res) => {
  res.json({ disciplinas: listarDisciplinas() });
});

// --- Taxonomia (povoa os selects de segmento/serie) ---
// Depende da DISCIPLINA escolhida (query `disciplina`, default Matematica): so entram
// as series que tenham aquele componente. Para cada serie guardamos o id real da
// disciplina naquela serie (`disciplinaSerieId`) — no Fundamental e o proprio id; no
// Infantil de Matematica e o ETQRT (27). Series sem o componente ficam de fora (por
// isso o Infantil some quando a disciplina nao tem equivalente Infantil, ex.: Portugues).
app.get("/api/taxonomia", async (req, res) => {
  if (!exigirSessao(res)) return;
  try {
    const disciplinaAlvo = disciplinaPorId(req.query.disciplina || DISCIPLINA_MATEMATICA);
    const resposta = await estruturaFiltro(sessao.token, 1); // tipo 1 = Aula
    const segmentos = [];
    for (const seg of resposta?.data || []) {
      const infantil = segmentoEhInfantil(seg?.name);
      const series = [];
      for (const s of seg?.series || []) {
        const disc = (s?.disciplines || []).find(d => ehComponenteDaDisciplina(d, disciplinaAlvo));
        if (!disc || s?.id == null) continue;
        series.push({
          id: s.id,
          nome: s.name,
          disciplinaSerieId: disc.id != null ? Number(disc.id) : disciplinaAlvo.id
        });
      }
      if (series.length) {
        segmentos.push({ id: seg.id, nome: seg.name, infantil, series });
      }
    }
    res.json({ disciplina: disciplinaAlvo.id, segmentos });
  } catch (erro) {
    res.status(502).json({ erro: erro.message });
  }
});

// --- Varredura de catalogo (lista completa do filtro) ---
app.get("/api/catalogo", async (req, res) => {
  if (!exigirSessao(res)) return;
  try {
    const { tipo, segment, serie, word, infantil, disciplina, disciplinaSerie } = req.query;
    const temSegmento = Boolean(segment);
    const temSerie = Boolean(serie);
    const discipline = resolverDiscipline({
      temSegmento,
      ehInfantil: infantil === "true" || infantil === "1",
      temSerie,
      disciplinaSerieId: disciplinaSerie ? Number(disciplinaSerie) : null,
      disciplinaId: disciplina ? Number(disciplina) : DISCIPLINA_MATEMATICA
    });
    const resultado = await varrerCatalogo(sessao.token, {
      tipo: tipo ? Number(tipo) : 1,
      discipline,
      segment: temSegmento ? Number(segment) : null,
      serie: temSerie ? Number(serie) : null,
      word: word || ""
    });
    res.json(resultado);
  } catch (erro) {
    res.status(502).json({ erro: erro.message });
  }
});

// --- Fila de download em massa (SSE) ---
// Recebe a lista de ids marcados e baixa um a um, emitindo eventos de progresso.
app.post("/api/download", async (req, res) => {
  if (!exigirSessao(res)) return;
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

  // Token de cancelamento desta corrida. `.cancelado` e lido pelo loop e pelo
  // nucleo (verificarCancelamento) — o botao "Parar" seta isso via /download/cancelar.
  const controlador = new AbortController();
  cancelamentoDownload = { cancelado: false, signal: controlador.signal };
  const tokenCancelamento = cancelamentoDownload;
  const paradoPeloUsuario = () => tokenCancelamento.cancelado;

  enviar("inicio", { total: ids.length });

  // Quantas vezes re-tentar a AULA INTEIRA se ela terminar com erro. O objetivo e
  // baixar todos os selecionados — nao pular por uma falha transitoria de rede.
  const TENTATIVAS_CONTEUDO = Number(process.env.ACERVO_TENTATIVAS_CONTEUDO || 4);

  const deveParar = () => clienteDesconectou || paradoPeloUsuario();

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
          token: sessao.token,
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

  const foiCancelado = clienteDesconectou || paradoPeloUsuario();
  enviar("fim", { cancelado: foiCancelado });
  res.end();
  // Libera o token so se ainda for o desta corrida (evita apagar o de um novo
  // download que tenha comecado).
  if (cancelamentoDownload === tokenCancelamento) {
    cancelamentoDownload = null;
  }
});

// --- Parar o download em curso ---
app.post("/api/download/cancelar", (_req, res) => {
  if (cancelamentoDownload) {
    cancelamentoDownload.cancelado = true;
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

// --- Verificar atualizacoes (versao nova de alguma pagina) ---
// Compara o vN gravado de cada aula com o vN atual do publicador. NAO baixa aulas.
// Precisa de sessao (usa o token do login para consultar o publicador). Devolve
// { total, resultados:[{id, situacao, paginas}] } — a aba marca os "desatualizado".
app.get("/api/acervo/verificar-updates", async (_req, res) => {
  if (!exigirSessao(res)) return;
  try {
    const itens = await lerAcervo();
    if (!itens.length) return res.json({ total: 0, resultados: [] });
    res.json(await verificarLista(itens));
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
      return res.status(404).json({ erro: "Conteudo nao encontrado no acervo." });
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
    if (!alvo) return res.status(404).json({ erro: "Conteudo nao encontrado no acervo." });

    // Le o zip do R2 (fonte atual) ou do disco (fallback).
    const bytesRaw = r2Configurado()
      ? await lerObjeto(alvo.arquivo)
      : await fs.readFile(path.join(obterRaizAcervo(), PASTA_CONTEUDOS_OFFLINE, alvo.arquivo));
    const origem = unzipSync(new Uint8Array(bytesRaw));
    const indice = JSON.parse(strFromU8(origem["indice.json"]));

    // Mapa: "pagina-<ordem>" -> externalId daquela pagina.
    const extPorPagina = new Map();
    for (const p of indice.paginas || []) {
      if (p.externalId) extPorPagina.set(`pagina-${p.ordem}`, String(p.externalId));
    }

    const raiz = nomeSeguroAcervo(`${indice.nome} [${indice.externalId || indice.id}]`, `Conteudo [${id}]`);
    const saida = {};
    for (const [caminho, conteudo] of Object.entries(origem)) {
      if (caminho === "indice.json") continue;               // metadado interno, nao entra
      const barra = caminho.indexOf("/");
      if (barra < 0) continue;                                // arquivo solto na raiz (ex.: thumb) — ignora
      const pastaPagina = caminho.slice(0, barra);            // "pagina-1"
      const resto = caminho.slice(barra + 1);                 // "appmanifest.json"
      const ext = extPorPagina.get(pastaPagina);
      if (!ext) continue;                                     // pagina sem externalId (legado) — sem "LO"
      saida[`${raiz}/${ext}/${resto}`] = conteudo;            // arquivos reais na pasta do LO
    }
    // Um .txt vazio por LO, junto do conteudo.
    for (const ext of extPorPagina.values()) {
      saida[`${raiz}/${ext}/${ext}.txt`] = strToU8("");
    }

    const zip = zipSync(saida, { level: 6 });
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(`${raiz}.zip`)}`
    );
    res.end(Buffer.from(zip));
  } catch (erro) {
    res.status(500).json({ erro: erro.message });
  }
});

// --- Reindexar o acervo (sem re-baixar) ---
// Corrige os indice.json antigos que nao tem classificacao real. Faz UMA varredura
// completa do catalogo (por segmento, para o discipline certo — Infantil=27) e
// cruza por id com o que esta no disco, reescrevendo so os metadados.
app.post("/api/acervo/reindexar", async (_req, res) => {
  if (!exigirSessao(res)) return;
  try {
    // 1. Ler o acervo atual (lista de zips).
    const base = path.join(obterRaizAcervo(), PASTA_CONTEUDOS_OFFLINE);
    const doAcervo = await lerAcervo();
    if (!doAcervo.length) {
      return res.json({ ok: true, reindexados: 0, naoEncontrados: 0 });
    }

    // 2. Varrer o catalogo inteiro por segmento E por disciplina, acumulando a
    //    classificacao real de cada id. tipo 1 = Aula, 2 = Jogo. Varre TODAS as
    //    disciplinas expostas (Matematica, Portugues, ...) porque o acervo pode ter
    //    conteudo de qualquer uma — reindexar so Matematica deixaria os demais sem
    //    reclassificacao ("nao encontrado" a toa).
    const taxonomia = await estruturaFiltro(sessao.token, 1);
    const segmentos = (taxonomia?.data || []).map(s => ({
      id: s.id,
      infantil: segmentoEhInfantil(s?.name)
    }));
    const catalogoPorId = new Map();
    for (const disc of listarDisciplinas()) {
      for (const tipo of [1, 2]) {
        for (const seg of segmentos) {
          const discipline = resolverDiscipline({
            temSegmento: true,
            ehInfantil: seg.infantil,
            temSerie: false,
            disciplinaSerieId: null,
            disciplinaId: disc.id
          });
          const r = await varrerCatalogo(sessao.token, {
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

const servidorHttp = app.listen(PORTA, "127.0.0.1", () => {
  console.log(`[acervo] servidor em http://127.0.0.1:${PORTA}`);
  console.log(`[acervo] acervo em ${obterRaizAcervo()}`);
});

// Mantem o processo vivo. Necessario porque o carregamento do @aws-sdk/client-s3
// (cliente R2) faz o socket do servidor deixar de "segurar" o event loop no Node —
// sem isto, o processo encerra logo apos o listen (o servidor subia e saia com
// exit 0, derrubando o `concurrently` junto). O keep-alive e barato e inofensivo.
servidorHttp.ref?.();
setInterval(() => {}, 1 << 30);
