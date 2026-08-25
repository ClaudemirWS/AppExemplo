import { useEffect, useMemo, useRef, useState } from "react";
import { api, baixarEmMassa, baixarEstruturaLOs, baixarPublicavel } from "./api.js";
import BarraAcao from "./BarraAcao.jsx";

// Icones dos botoes de acao. SVG inline (nao emoji): herdam a cor branca via
// `currentColor`, escalam nitido e nao dependem da fonte de emoji do SO — o 🗑
// saia colorido, brigando com o fundo do botao. Tracado do estilo Feather.
function IconeBaixar() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
function IconeLixeira() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

function classeFormato(f) {
  const t = String(f || "").toLowerCase();
  if (t.includes("construct2")) return "construct2";
  if (t.includes("construct3")) return "construct3";
  if (t.includes("animate")) return "animate";
  if (t.includes("html")) return "html";
  return "desconhecido";
}

// Rotulo AMIGAVEL do formato (so exibicao — nao altera a deteccao nem os dados).
// Os nomes tecnicos sao longos e "vazam" a implementacao; aqui encurtamos para a UI.
const ROTULO_FORMATO = {
  "construct2": "Construct 2",
  "construct3": "Construct 3",
  "animate-autonomo": "Animate",
  "html-modelo-classico": "HTML-Script",
  "html-moderno": "HTML-Unificado",
  "html-educandus": "HTML-Educandus",
  "html": "HTML"
};
function rotuloFormato(f) {
  return ROTULO_FORMATO[String(f || "").toLowerCase()] || f;
}

function selosDeFormato(item, estadoDownload) {
  // Enquanto ATUALIZA (rebaixa), a celula Formato vira a barra de progresso — o
  // mesmo visual "barra-selo" do Catalogo (na fila -> baixando % -> tentativa N).
  if (estadoDownload?.status === "baixando" || estadoDownload?.status === "fila") {
    const pct = estadoDownload.status === "fila" ? 0 : (estadoDownload.pct ?? 0);
    const rotulo = estadoDownload.status === "fila"
      ? "na fila"
      : estadoDownload.retentando
        ? `tentativa ${estadoDownload.retentando}`
        : `${pct}%`;
    return (
      <span className="barra-selo" title={rotulo}>
        <span className="progresso"><i style={{ width: `${pct}%` }} /></span>
        <span className="pct">{rotulo}</span>
      </span>
    );
  }
  if (estadoDownload?.status === "erro") {
    return <span className="selo erro" title={estadoDownload.motivo}>erro</span>;
  }
  const lista = item.formatos?.length ? item.formatos : [item.formato].filter(Boolean);
  if (!lista.length) return <span className="selo desconhecido">Desconhecido</span>;
  return lista.map((f, i) => (
    <span key={i} className={`selo ${classeFormato(f)}`} style={{ marginRight: 4 }} title={f}>{rotuloFormato(f)}</span>
  ));
}

// Detalhe POR PAGINA. Cada pagina de uma aula e um LO independente, com seu proprio
// externalId e seu proprio vN — nao existe "um vN da aula". A aula 2268, por exemplo,
// tem 5 paginas em v4/v4/v5/v6/v9, cada uma um LO diferente.
//
// Mescla as paginas BAIXADAS (indice.paginas) com as NAO SUPORTADAS
// (indice.paginasNaoSuportadas: formato incompativel, ex.: Flash numa aula mista),
// ordenadas por `ordem`, marcando cada uma com `baixada` e o `motivo` quando falhou.
// Devolve [{ordem, externalId, n, baixada, motivo}] — alimenta as colunas Versao
// (P1 - v4) e Paginas (P1: <LO>), e a sinalizacao de pagina faltante.
function detalhePorPagina(item) {
  const mapa = item.versoes && typeof item.versoes === "object" ? item.versoes : {};
  const baixadas = Array.isArray(item.paginas) ? item.paginas : [];
  const naoSuportadas = Array.isArray(item.paginasNaoSuportadas) ? item.paginasNaoSuportadas : [];
  const num = rotulo => {
    const m = /_v(\d+)\/?$/.exec(String(rotulo || ""));
    return m ? Number(m[1]) : null;
  };

  const lista = [
    ...baixadas.map(p => ({
      ordem: Number(p.ordem),
      externalId: p.externalId || "",
      n: num(p.versaoPagina ?? mapa[p.externalId]),
      baixada: true,
      motivo: ""
    })),
    ...naoSuportadas.map(p => ({
      ordem: Number(p.ordem),
      externalId: p.externalId || "",
      n: null,
      baixada: false,
      motivo: p.motivo || "Formato não disponível offline."
    }))
  ].sort((a, b) => a.ordem - b.ordem);

  if (lista.length) return lista;
  // Fallback: indice antigo sem `paginas` — usa so o mapa de versoes.
  return Object.entries(mapa).map(([ext, v], i) => ({
    ordem: i + 1, externalId: ext, n: num(v), baixada: true, motivo: ""
  }));
}

// Identidade tecnica do conteudo: external_id + se e Construct (convertido,
// baixavel offline) ou Flash (converted=NAO, NAO roda offline). Existe porque
// duas aulas podem ter o MESMO nome — a Flash antiga e a Construct nova — e sem
// isto o usuario nao distingue qual esta vendo (foi a origem da confusao 1792 vs 2268).
function selosDeIdentidade(item) {
  const conv = String(item.convertido || "").toUpperCase();
  const ehFlash = conv === "NAO";
  return (
    <span className="identidade">
      {item.externalId
        ? <span className="ext" title="external_id — ID da aula no publicador (as páginas são os LOs)">#{item.externalId}</span>
        : null}
      <span className={`selo ${ehFlash ? "flash" : "construct3"}`}
        title={ehFlash
          ? "Flash legado (converted=NAO): não roda offline"
          : "Convertido (Construct/HTML5): baixável e roda offline"}>
        {ehFlash ? "Flash (não-offline)" : "Convertido"}
      </span>
    </span>
  );
}

// Data amigavel e curta: "hoje 14:30", "ontem 09:12", ou "17/08 14:30".
function dataAmigavel(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const hoje = new Date();
  const soData = x => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  const ontem = new Date(hoje); ontem.setDate(hoje.getDate() - 1);
  if (soData(d) === soData(hoje)) return `hoje ${hh}:${mm}`;
  if (soData(d) === soData(ontem)) return `ontem ${hh}:${mm}`;
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${hh}:${mm}`;
}

// Coluna "Atualizacao" por linha. `r` = registro persistido da ultima verificacao
// { situacao, verificadoEm, paginasDesatualizadas } (undefined = nunca verificada).
// Mostra o selo da situacao + a data embaixo, num bloco compacto.
function seloAtualizacao(r) {
  if (!r) {
    return (
      <span className="atualizacao-nunca" title="Esta aula ainda não foi verificada. Selecione e clique em Verificar atualizações.">
        —
      </span>
    );
  }
  const data = dataAmigavel(r.verificadoEm);
  let selo;
  if (r.situacao === "desatualizado") {
    const quais = (r.paginasDesatualizadas || []).join(", ");
    selo = <span className="selo flash" title={quais ? `Páginas com versão nova: ${quais}` : "Versão nova no AVA"}>atualizar</span>;
  } else if (r.situacao === "atualizado") {
    selo = <span className="selo ok" title="Todas as páginas na versão mais recente">em dia</span>;
  } else if (r.situacao === "nao-versionavel") {
    selo = <span className="selo desconhecido" title="Sem versão a comparar">n/d</span>;
  } else {
    selo = <span className="selo erro" title="Falha ao consultar o AVA">erro</span>;
  }
  return (
    <span className="atualizacao-bloco">
      {selo}
      {data ? <small className="atualizacao-data" title={`Verificado em ${new Date(r.verificadoEm).toLocaleString("pt-BR")}`}>{data}</small> : null}
    </span>
  );
}

// Nomes de serie/segmento de um item, a partir das classificacoes reais.
function seriesDoItem(item) {
  return (item.classificacoes || []).map(c => c.serieNome).filter(Boolean);
}
function segmentosDoItem(item) {
  return (item.classificacoes || []).map(c => c.segmentoNome).filter(Boolean);
}

// Celula com um resumo curto clicavel que expande uma lista por pagina (P1 - v4,
// ou P1: <LO>) numa janelinha flutuante. Usada pelas colunas Versao e Paginas.
// `alerta` poe um ⚠ no resumo (ha pagina faltante). Cada linha:
// {chave, rotulo, valor, faltante?, titulo?} — `faltante` marca a pagina que nao baixou.
//
// O popover usa position:fixed ancorado ao botao (medido com getBoundingClientRect),
// para ESCAPAR do .tabela-wrap, que tem overflow-x:auto — dentro dele, um popover
// absoluto que transborda geraria barra de rolagem em vez de flutuar. Como fixed e
// relativo a viewport, fechamos ao rolar/redimensionar (a ancora se moveria).
function CelulaExpansivel({ aberto, onAlternar, resumo, titulo, linhas, alerta = false }) {
  const botaoRef = useRef(null);
  const [pos, setPos] = useState(null);

  useEffect(() => {
    if (!aberto || !botaoRef.current) { setPos(null); return undefined; }
    const medir = () => {
      const r = botaoRef.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 4, left: r.left });
    };
    medir();
    // Rolar/redimensionar move a ancora — fecha para nao ficar "solto" no lugar errado.
    const fechar = () => onAlternar();
    window.addEventListener("scroll", fechar, true); // captura o scroll do .tabela-wrap tambem
    window.addEventListener("resize", fechar);
    return () => {
      window.removeEventListener("scroll", fechar, true);
      window.removeEventListener("resize", fechar);
    };
  }, [aberto, onAlternar]);

  return (
    <div className="exp-wrap">
      <button
        ref={botaoRef}
        type="button"
        className={`exp-resumo${alerta ? " exp-resumo-alerta" : ""}`}
        aria-expanded={aberto}
        title={titulo}
        onClick={onAlternar}
      >
        {resumo}
        {alerta ? <span className="exp-aviso" aria-label="página faltante">⚠</span> : null}
        <span className="exp-seta">{aberto ? "▲" : "▼"}</span>
      </button>
      {aberto && pos && (
        <ul className="exp-lista" style={{ top: pos.top, left: pos.left }}>
          {linhas.map(l => (
            <li key={l.chave} className={l.faltante ? "exp-faltante" : ""} title={l.titulo || undefined}>
              <span className="exp-rotulo">{l.rotulo}</span>
              <span className="exp-valor">{l.valor}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Ordena séries pela PROGRESSÃO pedagógica, não alfabética: Berçário → Maternal →
// "N anos" (infantil) → "Nº Ano EF" (fundamental) → resto. O .sort() puro jogava
// "3 anos" no meio dos "Nº Ano" e "Berçário 1" pro fim.
function ordemSerie(nome) {
  const s = String(nome || "").toLowerCase();
  const n = Number((s.match(/\d+/) || [0])[0]);
  if (s.includes("berç") || s.includes("berc")) return 0 + n;   // Berçário 1/2
  if (s.includes("maternal")) return 100 + n;                   // Maternal
  if (s.includes("ano") && s.includes("ef")) return 300 + n;    // Nº Ano EF (fundamental)
  if (s.includes("ano")) return 200 + n;                        // "N anos" (infantil)
  return 900;                                                   // desconhecido → fim
}
function compararSerie(a, b) {
  const da = ordemSerie(a), db = ordemSerie(b);
  return da !== db ? da - db : String(a).localeCompare(b, "pt-BR");
}

export default function Acervo() {
  const [itens, setItens] = useState(null);
  const [erro, setErro] = useState("");
  const [removendo, setRemovendo] = useState(null);
  const [confirmacaoRemocao, setConfirmacaoRemocao] = useState(null);
  const [reindexando, setReindexando] = useState(false);
  const [verificando, setVerificando] = useState(false);
  // Mapa id -> { situacao, verificadoEm, paginasDesatualizadas } da ULTIMA verificacao.
  // Carregado do backend ao abrir (persistido) e atualizado apos verificar.
  const [updates, setUpdates] = useState(() => new Map());
  // Ids marcados nos checkboxes (Set). A verificacao age so sobre estes.
  const [selecionados, setSelecionados] = useState(() => new Set());
  // Estado do "Atualizar" (rebaixar por cima): id -> {status,pct,...}, igual ao
  // Catalogo. `atualizando` trava os botoes; `cancelarAtualizacao` para a fila.
  const [estadosDownload, setEstadosDownload] = useState(() => ({}));
  const [atualizando, setAtualizando] = useState(false);
  const [cancelarAtualizacao, setCancelarAtualizacao] = useState(null);
  const [parandoAtualizacao, setParandoAtualizacao] = useState(false);
  const [aviso, setAviso] = useState("");
  // Toast de qualquer ZIP (canto): { estado:"progresso"|"ok"|"erro"|"cancelado",
  // pagina, total, nomePagina, nomeAula, msg }. Some em 10s nos estados terminais.
  const [toast, setToast] = useState(null);
  const [toastVerificacao, setToastVerificacao] = useState(null);
  const [toastAtualizacao, setToastAtualizacao] = useState(null);
  // Apenas um ZIP pode ser preparado/entregue por vez. O ref fecha a pequena janela
  // entre o clique e o proximo render; o state atualiza a UI e identifica a linha.
  const downloadEstruturaRef = useRef(false);
  const cancelarEstruturaRef = useRef(null);
  const [downloadEstruturaId, setDownloadEstruturaId] = useState(null);
  const [fTipo, setFTipo] = useState(""); // "" = todos, "1" = Aula, "2" = Jogo
  const [fComponente, setFComponente] = useState(""); // "" = todos; nome da disciplina
  const [fSegmento, setFSegmento] = useState("");
  const [fSerie, setFSerie] = useState("");
  const [fAtualizacao, setFAtualizacao] = useState(""); // "", "atualizar", "em-dia", "nunca"
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);
  // Qual celula expansivel esta aberta: "<id>:versao" ou "<id>:paginas" (so uma por vez).
  const [expandido, setExpandido] = useState(null);

  // Fecha o popover ao clicar fora dele ou apertar Esc — como um dropdown normal.
  useEffect(() => {
    if (!expandido) return undefined;
    const aoClicarFora = e => { if (!e.target.closest(".exp-wrap")) setExpandido(null); };
    const aoTeclar = e => { if (e.key === "Escape") setExpandido(null); };
    document.addEventListener("mousedown", aoClicarFora);
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("mousedown", aoClicarFora);
      document.removeEventListener("keydown", aoTeclar);
    };
  }, [expandido]);

  // Escape fecha apenas uma confirmacao ainda nao iniciada. Durante a exclusao o
  // modal permanece bloqueado para nao sugerir que a operacao foi cancelada.
  useEffect(() => {
    if (!confirmacaoRemocao || removendo !== null) return undefined;
    const aoTeclar = e => {
      if (e.key === "Escape") setConfirmacaoRemocao(null);
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [confirmacaoRemocao, removendo]);

  function carregar() {
    setErro("");
    api.acervo()
      .then(r => setItens(r.itens || []))
      .catch(err => setErro(err.message));
    // Historico persistido da ultima verificacao (para a coluna vir preenchida).
    api.verificacoes()
      .then(r => setUpdates(new Map(Object.entries(r.itens || {}))))
      .catch(() => {});
  }

  useEffect(carregar, []);

  // Uma aula e Animate se qualquer pagina detectada e do formato Animate. So essas
  // ganham o download PUBLICAVEL (mirror verbatim do publicador, para republicar).
  function ehAnimate(item) {
    const fs = item.formatos?.length ? item.formatos : [item.formato].filter(Boolean);
    return fs.includes("animate-autonomo");
  }

  // Baixa a estrutura de LOs (zip). Duas vias:
  //   - Animate -> download PUBLICAVEL (mirror verbatim on-demand do publicador), com
  //     progresso no toast; o zip sai pronto para instrumentar e republicar.
  //   - demais  -> zip do R2, reescrito para o PWA. Apesar de nao termos progresso
  //     granular nessa via, o mesmo toast aparece imediatamente e fica indeterminado.
  async function baixarEstrutura(item) {
    if (downloadEstruturaRef.current) return;

    downloadEstruturaRef.current = true;
    setDownloadEstruturaId(String(item.id));
    setErro("");
    setToast({
      estado: "progresso",
      pagina: 0,
      total: 0,
      indeterminado: !ehAnimate(item),
      nomeAula: item.nome,
      msg: !ehAnimate(item) ? "Preparando o arquivo para download…" : "Resolvendo versões…"
    });

    const liberarDownload = () => {
      downloadEstruturaRef.current = false;
      cancelarEstruturaRef.current = null;
      setDownloadEstruturaId(null);
    };

    if (!ehAnimate(item)) {
      const controlador = new AbortController();
      cancelarEstruturaRef.current = () => controlador.abort();
      try {
        await baixarEstruturaLOs(item.id, { signal: controlador.signal });
        setToast({ estado: "ok", nomeAula: item.nome, msg: "Download pronto." });
      } catch (err) {
        if (err.name !== "AbortError") {
          setToast({
            estado: "erro",
            nomeAula: item.nome,
            msg: err.message || "Falha ao preparar o download."
          });
        }
      } finally {
        liberarDownload();
      }
      return;
    }

    try {
      cancelarEstruturaRef.current = baixarPublicavel(item.id, {
        inicio: d => setToast(t => ({ ...(t || {}), estado: "progresso", total: d.total, indeterminado: false })),
        pagina: d => setToast(t => ({ ...(t || {}), estado: "progresso", pagina: d.pagina, total: d.total, nomePagina: d.nome, indeterminado: false })),
        fim: () => {
          liberarDownload();
          setToast({ estado: "ok", nomeAula: item.nome, msg: "Download publicável pronto." });
        },
        erro: d => {
          liberarDownload();
          setToast({ estado: "erro", nomeAula: item.nome, msg: d.motivo || "Falha no download publicável." });
        }
      });
    } catch (err) {
      liberarDownload();
      setToast({
        estado: "erro",
        nomeAula: item.nome,
        msg: err.message || "Falha no download publicável."
      });
    }
  }

  function fecharOuCancelarToast() {
    if (!downloadEstruturaRef.current) {
      setToast(null);
      return;
    }

    const nomeAula = toast?.nomeAula || "Aula";
    cancelarEstruturaRef.current?.();
    downloadEstruturaRef.current = false;
    cancelarEstruturaRef.current = null;
    setDownloadEstruturaId(null);
    setToast({ estado: "cancelado", nomeAula, msg: "Download cancelado." });
  }

  async function remover(item) {
    setRemovendo(item.id);
    setErro("");
    try {
      await api.removerAcervo(item.id);
      setItens(prev => prev.filter(i => i.id !== item.id));
      setSelecionados(prev => {
        const proximo = new Set(prev);
        proximo.delete(String(item.id));
        return proximo;
      });
      setConfirmacaoRemocao(null);
    } catch (err) {
      setErro(err.message);
    } finally {
      setRemovendo(null);
    }
  }

  async function reindexar() {
    // Sem selecao = todo o acervo filtrado; com selecao, so os marcados (simetrico
    // ao Verificar). O backend aceita ids opcionais.
    const ids = selecionados.size ? [...selecionados] : filtrados.map(i => String(i.id));
    setReindexando(true);
    setErro("");
    setAviso("");
    try {
      const r = await api.reindexarAcervo(ids);
      setAviso(`Reindexados ${r.reindexados} conteúdos${r.naoEncontrados ? `, ${r.naoEncontrados} não achados no catálogo` : ""}.`);
      carregar();
    } catch (err) {
      setErro(err.message);
    } finally {
      setReindexando(false);
    }
  }

  // Pergunta ao servidor quais das aulas SELECIONADAS tem versao nova no AVA (nao
  // baixa nada). O backend persiste com data; aqui mesclamos no `updates` para nao
  // perder a verificacao anterior das aulas que NAO estavam selecionadas.
  async function verificar() {
    // Sem selecao = "todas": verifica o conjunto FILTRADO (o que o usuario ve),
    // nao so a pagina. Com selecao, age so sobre os marcados.
    const ids = selecionados.size ? [...selecionados] : filtrados.map(i => String(i.id));
    if (!ids.length) return; // acervo vazio / filtro sem resultado
    setVerificando(true);
    setErro("");
    setAviso("");
    setToastAtualizacao(null);
    setToastVerificacao({
      estado: "progresso",
      titulo: "Verificando atualizações",
      msg: `Consultando ${ids.length} conteúdo(s) no AVA…`
    });
    try {
      const r = await api.verificarUpdates(ids);
      const agora = new Date().toISOString();
      setUpdates(prev => {
        const mapa = new Map(prev);
        for (const x of r.resultados || []) {
          mapa.set(String(x.id), {
            situacao: x.situacao,
            verificadoEm: agora,
            paginasDesatualizadas: (x.paginas || []).filter(p => p.desatualizada).map(p => p.externalId).filter(Boolean)
          });
        }
        return mapa;
      });
      const resultados = r.resultados || [];
      const n = resultados.filter(x => x.situacao === "desatualizado").length;
      const naoVerificados = resultados.filter(x => x.situacao === "erro" || x.situacao === "nao-versionavel").length;
      const complemento = naoVerificados
        ? ` ${naoVerificados} conteúdo(s) não puderam ter a versão comparada.`
        : "";
      const mensagem = n
        ? `${n} conteúdo(s) possuem versão nova e foram marcados para atualizar.${complemento}`
        : `${r.total || resultados.length} conteúdo(s) verificados. Nenhuma atualização encontrada.${complemento}`;
      setAviso(mensagem);
      setToastVerificacao({
        estado: "ok",
        titulo: "Verificação concluída",
        msg: mensagem
      });
    } catch (err) {
      setToastVerificacao({
        estado: "erro",
        titulo: "Não foi possível verificar",
        msg: err.message || "Falha ao consultar atualizações."
      });
    } finally {
      setVerificando(false);
    }
  }

  // "Atualizar": rebaixa por cima as aulas SELECIONADAS — a MESMA acao do Catalogo
  // (baixarEmMassa via SSE). O servidor regrava o zip e a classificacao; o progresso
  // aparece na coluna Formato (barra-selo). So age sobre selecionados (botao travado
  // quando nao ha nenhum). Ao terminar, recarrega o acervo.
  function atualizarSelecionados() {
    const ids = [...selecionados];
    if (!ids.length) return;
    const itensSelecionados = (itens || [])
      .filter(i => selecionados.has(String(i.id)))
      .map(i => ({
        id: i.id,
        nome: i.nome || "",
        serieNome: (i.classificacoes || [])[0]?.serieNome || "",
        tipoId: i.tipoId ?? null,
        classificacoes: i.classificacoes || [],
        disciplinaId: i.disciplinaId ?? null,
        disciplina: i.disciplina || "",
        habilidade: i.habilidadeCodigo || i.habilidade || "",
        imagem: i.imagem || ""
      }));
    const totalAtualizacao = itensSelecionados.length;
    const nomePorId = new Map(itensSelecionados.map(i => [String(i.id), i.nome]));
    let concluidos = 0;
    let falhas = 0;
    setAtualizando(true);
    setErro("");
    setAviso("");
    setToastVerificacao(null);
    setToastAtualizacao({
      estado: "progresso",
      titulo: "Atualizando conteúdos",
      msg: `Preparando 0 de ${totalAtualizacao}…`,
      pct: 0
    });
    setEstadosDownload(prev => {
      const p = { ...prev };
      ids.forEach(id => { p[id] = { status: "fila", pct: 0 }; });
      return p;
    });

    const parar = baixarEmMassa(itensSelecionados, {
      "item-inicio": ({ id, indice }) => {
        setEstadosDownload(p => ({ ...p, [id]: { status: "baixando", pct: 0 } }));
        setToastAtualizacao({
          estado: "progresso",
          titulo: "Atualizando conteúdos",
          msg: `${concluidos} de ${totalAtualizacao} processados · ${nomePorId.get(String(id)) || `Conteúdo ${Number(indice) + 1}`}`,
          pct: totalAtualizacao ? Math.round((concluidos / totalAtualizacao) * 100) : 0
        });
      },
      progresso: ({ id, pct, retentando }) => {
        setEstadosDownload(p => ({ ...p, [id]: { status: "baixando", pct, retentando } }));
        const percentualGeral = totalAtualizacao
          ? Math.round(((concluidos + (Number(pct) || 0) / 100) / totalAtualizacao) * 100)
          : 0;
        setToastAtualizacao({
          estado: "progresso",
          titulo: "Atualizando conteúdos",
          msg: `${concluidos} de ${totalAtualizacao} processados · ${nomePorId.get(String(id)) || "Conteúdo atual"}${retentando ? ` · tentativa ${retentando}` : ""}`,
          pct: percentualGeral
        });
      },
      "item-fim": d => {
        setEstadosDownload(p => ({ ...p, [d.id]: d }));
        concluidos += 1;
        if (d.status !== "ok") falhas += 1;
        setToastAtualizacao({
          estado: "progresso",
          titulo: "Atualizando conteúdos",
          msg: `${concluidos} de ${totalAtualizacao} processados${falhas ? ` · ${falhas} com falha` : ""}`,
          pct: totalAtualizacao ? Math.round((concluidos / totalAtualizacao) * 100) : 100
        });
        // Baixou com sucesso = versao mais recente = "em dia". Marca na hora (o backend
        // tambem persiste isso; o carregar() do fim so confirma). Se falhou, nao marca.
        if (d.status === "ok") {
          setUpdates(prev => {
            const m = new Map(prev);
            m.set(String(d.id), {
              situacao: "atualizado",
              verificadoEm: new Date().toISOString(),
              paginasDesatualizadas: []
            });
            return m;
          });
        }
      },
      fim: ({ cancelado } = {}) => {
        setAtualizando(false);
        setCancelarAtualizacao(null);
        setToastAtualizacao(cancelado
          ? { estado: "cancelado", titulo: "Atualização interrompida", msg: `${concluidos} de ${totalAtualizacao} processados.` }
          : {
              estado: falhas === totalAtualizacao ? "erro" : "ok",
              titulo: falhas ? "Atualização concluída com avisos" : "Atualização concluída",
              msg: `${concluidos - falhas} de ${totalAtualizacao} atualizados${falhas ? ` · ${falhas} com falha` : ""}.`
            });
        carregar();
      },
      erro: ({ motivo }) => {
        setToastAtualizacao({
          estado: "erro",
          titulo: "Falha na atualização",
          msg: motivo || "O servidor encerrou a atualização antes de concluir."
        });
        setAtualizando(false);
        setCancelarAtualizacao(null);
        carregar();
      }
    });
    setCancelarAtualizacao(() => parar);
  }

  // Para de verdade: avisa o SERVIDOR (senao segue baixando a fila) e aborta o stream.
  async function pararAtualizacao() {
    setParandoAtualizacao(true);
    setToastAtualizacao(t => ({
      ...(t || {}),
      estado: "progresso",
      titulo: "Interrompendo atualização",
      msg: "Aguardando o processo atual parar…"
    }));
    try { await api.cancelarDownload(); } catch { /* aborta o stream mesmo assim */ }
    if (cancelarAtualizacao) cancelarAtualizacao();
    setAtualizando(false);
    setParandoAtualizacao(false);
    setCancelarAtualizacao(null);
    setToastAtualizacao({
      estado: "cancelado",
      titulo: "Atualização interrompida",
      msg: "Os conteúdos já concluídos foram preservados."
    });
    carregar();
  }

  // Opcoes de filtro derivadas do proprio acervo (segmento -> series).
  const { opcoesSegmento, seriesPorSegmento } = useMemo(() => {
    const segs = new Map(); // nome -> Set(series)
    for (const item of itens || []) {
      for (const c of item.classificacoes || []) {
        if (!c.segmentoNome) continue;
        if (!segs.has(c.segmentoNome)) segs.set(c.segmentoNome, new Set());
        if (c.serieNome) segs.get(c.segmentoNome).add(c.serieNome);
      }
    }
    return {
      opcoesSegmento: [...segs.keys()].sort(),
      seriesPorSegmento: segs
    };
  }, [itens]);

  const opcoesSerie = useMemo(() => {
    if (fSegmento && seriesPorSegmento.has(fSegmento)) {
      return [...seriesPorSegmento.get(fSegmento)].sort(compararSerie);
    }
    const todas = new Set();
    for (const set of seriesPorSegmento.values()) for (const s of set) todas.add(s);
    return [...todas].sort(compararSerie);
  }, [fSegmento, seriesPorSegmento]);

  // Componentes (disciplinas) presentes no acervo — derivados dos proprios itens.
  const opcoesComponente = useMemo(() => {
    const nomes = new Set();
    for (const item of itens || []) if (item.disciplina) nomes.add(item.disciplina);
    return [...nomes].sort();
  }, [itens]);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (itens || []).filter(item => {
      // tipoId ausente conta como Aula (1) — o mesmo default do resto do app.
      if (fTipo && String(item.tipoId ?? 1) !== fTipo) return false;
      if (fComponente && item.disciplina !== fComponente) return false;
      if (fSegmento && !segmentosDoItem(item).includes(fSegmento)) return false;
      if (fSerie && !seriesDoItem(item).includes(fSerie)) return false;
      // Filtro por situacao da ULTIMA verificacao (persistida em `updates`).
      if (fAtualizacao) {
        const r = updates.get(String(item.id));
        if (fAtualizacao === "nunca" && r) return false;
        if (fAtualizacao === "atualizar" && r?.situacao !== "desatualizado") return false;
        if (fAtualizacao === "em-dia" && r?.situacao !== "atualizado") return false;
      }
      // Busca por id (exato/parcial) OU nome (substring), sem diferenciar maiuscula.
      if (termo) {
        const casaId = String(item.id || "").toLowerCase().includes(termo);
        const casaNome = String(item.nome || "").toLowerCase().includes(termo);
        if (!casaId && !casaNome) return false;
      }
      return true;
    });
  }, [itens, fTipo, fComponente, fSegmento, fSerie, busca, fAtualizacao, updates]);

  // Paginacao do acervo: 10 por pagina. `pagina` e limitada ao total; a fatia sai
  // do `filtrados` (o filtro roda antes da paginacao).
  const POR_PAGINA = 10;
  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA));
  // Se o filtro (ou uma remocao) encolheu a lista, nao deixa a pagina passar do fim.
  const paginaAtual = Math.min(pagina, totalPaginas);
  const inicio = (paginaAtual - 1) * POR_PAGINA;
  const paginados = filtrados.slice(inicio, inicio + POR_PAGINA);

  // --- Selecao global — cobre todas as paginas do resultado filtrado ---
  const idsFiltrados = filtrados.map(i => String(i.id));
  const todosFiltradosMarcados = idsFiltrados.length > 0 && idsFiltrados.every(id => selecionados.has(id));
  const idsDaPagina = paginados.map(i => String(i.id));
  const todosDaPaginaMarcados = idsDaPagina.length > 0 && idsDaPagina.every(id => selecionados.has(id));
  function alternarSelecao(id) {
    setSelecionados(prev => {
      const p = new Set(prev);
      p.has(String(id)) ? p.delete(String(id)) : p.add(String(id));
      return p;
    });
  }
  function selecionarTodosFiltrados() {
    setSelecionados(prev => {
      const p = new Set(prev);
      idsFiltrados.forEach(id => p.add(id));
      return p;
    });
  }
  function desmarcarTodos() {
    setSelecionados(new Set());
  }
  function alternarSelecaoDaPagina() {
    setSelecionados(prev => {
      const proximo = new Set(prev);
      if (todosDaPaginaMarcados) idsDaPagina.forEach(id => proximo.delete(id));
      else idsDaPagina.forEach(id => proximo.add(id));
      return proximo;
    });
  }

  // Volta a pagina 1 quando o filtro ou a busca mudam — senao ficaria numa pagina que sumiu.
  useEffect(() => { setPagina(1); }, [fTipo, fComponente, fSegmento, fSerie, busca, fAtualizacao]);
  // Fecha qualquer popover ao trocar de pagina (o item pode nem estar mais na tela).
  useEffect(() => { setExpandido(null); }, [paginaAtual]);

  // Toast some sozinho em 10s nos estados terminais (ok/erro); durante o progresso
  // fica fixo (vai sendo atualizado). O botao de fechar zera a qualquer momento.
  useEffect(() => {
    if (!toast || toast.estado === "progresso") return;
    const t = setTimeout(() => setToast(null), 10000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!toastVerificacao || toastVerificacao.estado === "progresso") return;
    const t = setTimeout(() => setToastVerificacao(null), 10000);
    return () => clearTimeout(t);
  }, [toastVerificacao]);

  useEffect(() => {
    if (!toastAtualizacao || toastAtualizacao.estado === "progresso") return;
    const t = setTimeout(() => setToastAtualizacao(null), 10000);
    return () => clearTimeout(t);
  }, [toastAtualizacao]);

  if (erro) return <div className="aviso erro">{erro}</div>;
  if (!itens) return <div className="carregando">Carregando acervo...</div>;

  return (
    <>
      {aviso && <div className="aviso info">{aviso}</div>}

      {toast && (
        <div className={`toast toast-${toast.estado}`} role="status" aria-live="polite">
          <button
            className="toast-fechar"
            title={downloadEstruturaId !== null ? "Cancelar download" : "Fechar"}
            aria-label={downloadEstruturaId !== null ? "Cancelar download" : "Fechar aviso"}
            onClick={fecharOuCancelarToast}
          >×</button>
          {toast.estado === "progresso" ? (
            <>
              <div className="toast-titulo">Preparando “{toast.nomeAula}”…</div>
              <div className="toast-msg">
                {toast.total ? `Página ${toast.pagina} de ${toast.total} preparadas.` : (toast.msg || "Resolvendo versões…")}
              </div>
              <div className="toast-barra">
                <div
                  className={`toast-barra-fill${toast.indeterminado ? " toast-barra-indeterminada" : ""}`}
                  style={{ width: `${toast.total ? Math.round((toast.pagina / toast.total) * 100) : 6}%` }}
                />
              </div>
            </>
          ) : (
            <>
              <div className="toast-titulo">
                {toast.estado === "ok" ? "✓ " : toast.estado === "cancelado" ? "× " : "⚠ "}{toast.nomeAula}
              </div>
              <div className="toast-msg">{toast.msg}</div>
            </>
          )}
        </div>
      )}

      {toastVerificacao && (
        <div
          className={`toast toast-verificacao${toast ? " toast-verificacao-com-download" : ""} toast-${toastVerificacao.estado}`}
          role="status"
          aria-live="polite"
        >
          {toastVerificacao.estado !== "progresso" && (
            <button
              className="toast-fechar"
              title="Fechar"
              aria-label="Fechar aviso de verificação"
              onClick={() => setToastVerificacao(null)}
            >×</button>
          )}
          <div className="toast-titulo">
            {toastVerificacao.estado === "ok" ? "✓ " : toastVerificacao.estado === "erro" ? "⚠ " : ""}
            {toastVerificacao.titulo}
          </div>
          <div className="toast-msg">{toastVerificacao.msg}</div>
          {toastVerificacao.estado === "progresso" && (
            <div className="toast-barra">
              <div className="toast-barra-fill toast-barra-indeterminada" />
            </div>
          )}
        </div>
      )}

      {toastAtualizacao && (
        <div
          className={`toast toast-atualizacao${toast ? " toast-atualizacao-com-download" : ""} toast-${toastAtualizacao.estado}`}
          role="status"
          aria-live="polite"
        >
          {toastAtualizacao.estado !== "progresso" && (
            <button
              className="toast-fechar"
              title="Fechar"
              aria-label="Fechar aviso de atualização"
              onClick={() => setToastAtualizacao(null)}
            >×</button>
          )}
          <div className="toast-titulo">
            {toastAtualizacao.estado === "ok" ? "✓ " : toastAtualizacao.estado === "erro" ? "⚠ " : toastAtualizacao.estado === "cancelado" ? "× " : ""}
            {toastAtualizacao.titulo}
          </div>
          <div className="toast-msg">{toastAtualizacao.msg}</div>
          {toastAtualizacao.estado === "progresso" && (
            <div className="toast-barra">
              <div className="toast-barra-fill" style={{ width: `${toastAtualizacao.pct || 0}%` }} />
            </div>
          )}
        </div>
      )}

      {confirmacaoRemocao && (
        <div
          className="modal-fundo"
          onMouseDown={e => {
            if (e.target === e.currentTarget && removendo === null) {
              setConfirmacaoRemocao(null);
            }
          }}
        >
          <section
            className="modal-confirmacao"
            role="dialog"
            aria-modal="true"
            aria-labelledby="titulo-confirmar-remocao"
            aria-describedby="texto-confirmar-remocao"
          >
            <div className="modal-confirmacao-icone" aria-hidden="true"><IconeLixeira /></div>
            <h2 id="titulo-confirmar-remocao">Apagar conteúdo do acervo?</h2>
            <p id="texto-confirmar-remocao">
              Você está prestes a apagar <strong>“{confirmacaoRemocao.nome}”</strong> e seus arquivos armazenados.
              Essa ação não pode ser desfeita.
            </p>
            <div className="modal-confirmacao-acoes">
              <button
                type="button"
                autoFocus
                onClick={() => setConfirmacaoRemocao(null)}
                disabled={removendo !== null}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="botao-perigo"
                onClick={() => remover(confirmacaoRemocao)}
                disabled={removendo !== null}
              >
                {removendo !== null ? <><span className="spin-acao" /> Apagando…</> : "Confirmar"}
              </button>
            </div>
          </section>
        </div>
      )}

      {itens.length === 0 ? (
        <div className="vazio">Nenhum conteúdo baixado ainda.</div>
      ) : (
        <>
          <div className="filtros">
            <div className="filtro">
              <label>Tipo</label>
              <select value={fTipo} onChange={e => setFTipo(e.target.value)}>
                <option value="">Todos</option>
                <option value="1">Aula</option>
                <option value="2">Jogo</option>
              </select>
            </div>
            <div className="filtro">
              <label>Componente</label>
              <select value={fComponente} onChange={e => setFComponente(e.target.value)}>
                <option value="">Todos</option>
                {opcoesComponente.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="filtro">
              <label>Segmento</label>
              <select value={fSegmento} onChange={e => { setFSegmento(e.target.value); setFSerie(""); }}>
                <option value="">Todos</option>
                {opcoesSegmento.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="filtro">
              <label>Série</label>
              <select value={fSerie} onChange={e => setFSerie(e.target.value)}>
                <option value="">Todas</option>
                {opcoesSerie.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="filtro">
              <label>Atualização</label>
              <select value={fAtualizacao} onChange={e => setFAtualizacao(e.target.value)}>
                <option value="">Todas</option>
                <option value="atualizar">Atualizar</option>
                <option value="em-dia">Em dia</option>
                <option value="nunca">Não verificada</option>
              </select>
            </div>
          </div>

          <BarraAcao
            busca={busca}
            onBusca={setBusca}
            contagem={
              <>
              {filtrados.length
                ? `${inicio + 1}–${inicio + paginados.length} de ${filtrados.length}`
                : "0"} conteúdos
              {(fTipo || fComponente || fSegmento || fSerie || fAtualizacao || busca.trim()) ? ` (filtrado de ${itens.length})` : ""}
              {selecionados.size ? ` · ${selecionados.size} selecionada(s)` : ""}
              </>
            }
          >
              <button
                onClick={todosFiltradosMarcados ? desmarcarTodos : selecionarTodosFiltrados}
                disabled={!idsFiltrados.length || atualizando || verificando || reindexando}
                title={todosFiltradosMarcados
                  ? "Limpa toda a seleção"
                  : "Seleciona todos os conteúdos do resultado filtrado, em todas as páginas"}
              >
                {todosFiltradosMarcados ? "Desmarcar todas" : "Selecionar todas"}
              </button>
              {atualizando ? (
                <button onClick={pararAtualizacao} disabled={parandoAtualizacao}>
                  {parandoAtualizacao ? "Parando..." : "Parar"}
                </button>
              ) : (
                <button className="primario" onClick={atualizarSelecionados} disabled={selecionados.size === 0 || verificando}
                  title={selecionados.size === 0
                    ? "Selecione as aulas que deseja atualizar"
                    : "Rebaixa as aulas selecionadas por cima (mesma ação do Catálogo) — traz a versão mais nova"}>
                  Atualizar{selecionados.size ? ` (${selecionados.size})` : ""}
                </button>
              )}
              <button
                className={verificando ? "botao-com-status" : undefined}
                onClick={verificar}
                disabled={verificando || atualizando || filtrados.length === 0}
                aria-busy={verificando}
                title={selecionados.size
                  ? "Verifica no AVA as aulas selecionadas (não baixa nada)"
                  : "Nada selecionado: verifica TODAS as aulas listadas (não baixa nada)"}>
                {verificando
                  ? <><span className="spin-botao" /> Verificando...</>
                  : `Verificar (${selecionados.size || filtrados.length})`}
              </button>
              <button onClick={reindexar} disabled={reindexando || atualizando || filtrados.length === 0}
                title={selecionados.size
                  ? "Corrige série, segmento e disciplina das aulas selecionadas — sem re-baixar"
                  : "Nada selecionado: corrige série, segmento e disciplina de TODAS as aulas listadas — sem re-baixar"}>
                {reindexando
                  ? "Corrigindo..."
                  : `Corrigir dados (${selecionados.size || filtrados.length})`}
              </button>
          </BarraAcao>

          <div className="tabela-wrap">
            <table>
              <thead>
                <tr>
                  <th className="col-check">
                    <input
                      type="checkbox"
                      checked={todosDaPaginaMarcados}
                      disabled={!idsDaPagina.length || atualizando || verificando || reindexando}
                      onChange={alternarSelecaoDaPagina}
                      title="Selecionar ou desmarcar os conteúdos desta página"
                      aria-label="Selecionar ou desmarcar os conteúdos desta página"
                    />
                  </th>
                  <th className="col-esq">ID</th>
                  <th className="col-esq">Nome</th>
                  <th>Identidade</th>
                  <th>Série(s)</th>
                  <th>Formato</th>
                  <th>Versão</th>
                  <th>Páginas</th>
                  <th>Atualização</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {paginados.map(item => {
                  const series = seriesDoItem(item);
                  const paginas = detalhePorPagina(item);
                  const temVersao = paginas.some(p => p.n != null);
                  const faltantes = paginas.filter(p => !p.baixada).length;
                  return (
                    <tr key={item.id} className={selecionados.has(String(item.id)) ? "linha-selecionada" : ""}>
                      <td className="col-check">
                        <input
                          type="checkbox"
                          checked={selecionados.has(String(item.id))}
                          onChange={() => alternarSelecao(item.id)}
                          aria-label={`Selecionar ${item.nome}`}
                        />
                      </td>
                      <td className="col-esq">{item.id}</td>
                      <td className="nome">{item.nome}</td>
                      <td>{selosDeIdentidade(item)}</td>
                      <td>{series.length ? series.join(", ") : <span style={{ color: "var(--txt-2)" }}>—</span>}</td>
                      <td>{selosDeFormato(item, estadosDownload[item.id])}</td>
                      <td className="col-expansivel">
                        {temVersao ? (
                          <CelulaExpansivel
                            aberto={expandido === `${item.id}:versao`}
                            onAlternar={() => setExpandido(expandido === `${item.id}:versao` ? null : `${item.id}:versao`)}
                            resumo={`${paginas.length} ${paginas.length === 1 ? "pag" : "pags"}`}
                            titulo="Versão publicada de cada página (clique para ver)"
                            linhas={paginas.map(p => ({
                              chave: p.ordem,
                              rotulo: `P${p.ordem}`,
                              valor: p.baixada ? (p.n != null ? `v${p.n}` : "—") : "não baixada",
                              faltante: !p.baixada,
                              titulo: p.baixada ? undefined : p.motivo
                            }))}
                          />
                        ) : (
                          <span style={{ color: "var(--txt-2)" }}>—</span>
                        )}
                      </td>
                      <td className="col-expansivel">
                        {paginas.length ? (
                          <CelulaExpansivel
                            aberto={expandido === `${item.id}:paginas`}
                            onAlternar={() => setExpandido(expandido === `${item.id}:paginas` ? null : `${item.id}:paginas`)}
                            resumo={`${item.paginasBaixadas}/${item.totalPaginas}`}
                            alerta={faltantes > 0}
                            titulo={faltantes > 0
                              ? `${faltantes} página(s) não baixada(s) — formato incompatível`
                              : "LO (external_id) de cada página (clique para ver)"}
                            linhas={paginas.map(p => ({
                              chave: p.ordem,
                              rotulo: `P${p.ordem}`,
                              valor: p.baixada ? (p.externalId || "—") : `não baixada — ${p.motivo}`,
                              faltante: !p.baixada,
                              titulo: p.baixada ? undefined : p.motivo
                            }))}
                          />
                        ) : (
                          <span>{item.paginasBaixadas}/{item.totalPaginas}</span>
                        )}
                      </td>
                      <td className="col-atualizacao">{seloAtualizacao(updates.get(String(item.id)))}</td>
                      <td className="col-acoes">
                        <div className="acoes-linha">
                          <button
                            className="acao-icone baixar-estrutura"
                            title={downloadEstruturaId
                              ? (downloadEstruturaId === String(item.id)
                                  ? "Este download está sendo preparado"
                                  : "Aguarde o download atual terminar")
                              : "Baixar estrutura de LOs (zip: uma pasta por LO com os arquivos da aula)"}
                            aria-label={downloadEstruturaId === String(item.id)
                              ? `Preparando download de ${item.nome}`
                              : `Baixar estrutura de ${item.nome}`}
                            onClick={() => baixarEstrutura(item)}
                            disabled={downloadEstruturaId !== null}
                          >
                            {downloadEstruturaId === String(item.id) ? <span className="spin-acao" /> : <IconeBaixar />}
                          </button>
                          <button className="acao-icone lixeira" title="Apagar do acervo"
                            onClick={() => setConfirmacaoRemocao(item)} disabled={removendo !== null}>
                            {removendo === item.id ? <span className="spin-acao" /> : <IconeLixeira />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPaginas > 1 && (
            <div className="paginacao">
              <button
                onClick={() => setPagina(p => Math.max(1, p - 1))}
                disabled={paginaAtual <= 1}
              >
                ‹ Anterior
              </button>
              <span className="paginacao-indicador">
                Página {paginaAtual} de {totalPaginas}
              </span>
              <button
                onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))}
                disabled={paginaAtual >= totalPaginas}
              >
                Próxima ›
              </button>
            </div>
          )}

          {filtrados.length === 0 && (
            <div className="vazio">Nenhum conteúdo do acervo bate com este filtro.</div>
          )}
        </>
      )}
    </>
  );
}
