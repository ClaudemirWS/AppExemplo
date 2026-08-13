import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api.js";

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

// Baixa a estrutura de LOs de um conteudo. O SERVIDOR reempacota o zip do acervo no
// formato pedido (Nome [externalId-da-aula]/<externalId-do-LO>/... com os arquivos
// reais + txt vazio) e responde com Content-Disposition: attachment. Basta navegar
// para a rota — o navegador baixa. Feito no servidor porque ele ja tem o zip em disco.
function baixarEstruturaLOs(item) {
  window.location.href = `/api/acervo/${encodeURIComponent(item.id)}/estrutura`;
}

function classeFormato(f) {
  const t = String(f || "").toLowerCase();
  if (t.includes("construct2")) return "construct2";
  if (t.includes("construct3")) return "construct3";
  if (t.includes("animate")) return "animate";
  if (t.includes("html")) return "html";
  return "desconhecido";
}

function selosDeFormato(item) {
  const lista = item.formatos?.length ? item.formatos : [item.formato].filter(Boolean);
  if (!lista.length) return <span className="selo desconhecido">desconhecido</span>;
  return lista.map((f, i) => (
    <span key={i} className={`selo ${classeFormato(f)}`} style={{ marginRight: 4 }}>{f}</span>
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
      motivo: p.motivo || "Formato nao disponivel offline."
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
        ? <span className="ext" title="external_id — ID da aula no publicador (as paginas sao os LOs)">#{item.externalId}</span>
        : null}
      <span className={`selo ${ehFlash ? "flash" : "construct3"}`}
        title={ehFlash
          ? "Flash legado (converted=NAO): NAO roda offline"
          : "Convertido (Construct/HTML5): baixavel e roda offline"}>
        {ehFlash ? "Flash (nao-offline)" : "Convertido"}
      </span>
    </span>
  );
}

// Selo do resultado da verificacao de updates, por linha. `r` = {situacao, paginas}
// da ultima verificacao (undefined = ainda nao verificou -> nada).
function seloAtualizacao(r) {
  if (!r) return null;
  if (r.situacao === "desatualizado") {
    const quais = (r.paginas || [])
      .filter(p => p.desatualizada)
      .map(p => `${p.externalId}: ${p.versaoGravada} -> ${p.versaoAtual}`)
      .join("\n");
    return <span className="selo flash" title={`Versao nova no AVA:\n${quais}`}>atualizar</span>;
  }
  if (r.situacao === "atualizado") {
    return <span className="selo ok" title="Todas as paginas na versao mais recente">em dia</span>;
  }
  if (r.situacao === "nao-versionavel") {
    return <span className="selo desconhecido" title={r.motivo || "sem versao a comparar"}>n/d</span>;
  }
  return <span className="selo erro" title="Falha ao consultar o AVA">erro</span>;
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
        {alerta ? <span className="exp-aviso" aria-label="pagina faltante">⚠</span> : null}
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

export default function Acervo() {
  const [itens, setItens] = useState(null);
  const [erro, setErro] = useState("");
  const [removendo, setRemovendo] = useState(null);
  const [reindexando, setReindexando] = useState(false);
  const [verificando, setVerificando] = useState(false);
  // Mapa id -> "desatualizado"|"nao-versionavel"|"erro"|"atualizado" (resultado da
  // ultima verificacao de updates). Vazio = ainda nao verificou.
  const [updates, setUpdates] = useState(() => new Map());
  const [aviso, setAviso] = useState("");
  const [fTipo, setFTipo] = useState(""); // "" = todos, "1" = Aula, "2" = Jogo
  const [fSegmento, setFSegmento] = useState("");
  const [fSerie, setFSerie] = useState("");
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

  function carregar() {
    setErro("");
    api.acervo()
      .then(r => setItens(r.itens || []))
      .catch(err => setErro(err.message));
  }

  useEffect(carregar, []);

  async function remover(item) {
    if (!window.confirm(`Apagar "${item.nome}" do acervo? Os arquivos serao removidos do disco.`)) {
      return;
    }
    setRemovendo(item.id);
    setErro("");
    try {
      await api.removerAcervo(item.id);
      setItens(prev => prev.filter(i => i.id !== item.id));
    } catch (err) {
      setErro(err.message);
    } finally {
      setRemovendo(null);
    }
  }

  async function reindexar() {
    setReindexando(true);
    setErro("");
    setAviso("");
    try {
      const r = await api.reindexarAcervo();
      setAviso(`Reindexados ${r.reindexados} conteudos${r.naoEncontrados ? `, ${r.naoEncontrados} nao achados no catalogo` : ""}.`);
      carregar();
    } catch (err) {
      setErro(err.message);
    } finally {
      setReindexando(false);
    }
  }

  // Pergunta ao servidor quais aulas tem versao nova no AVA (nao baixa nada).
  // Guarda o resultado em `updates` (id -> situacao) para marcar o selo por linha.
  async function verificar() {
    setVerificando(true);
    setErro("");
    setAviso("");
    try {
      const r = await api.verificarUpdates();
      const mapa = new Map((r.resultados || []).map(x => [String(x.id), x]));
      setUpdates(mapa);
      const n = (r.resultados || []).filter(x => x.situacao === "desatualizado").length;
      setAviso(n
        ? `${n} aula(s) com versao nova no AVA — marcadas com "atualizar". Rebaixe para atualizar.`
        : "Nenhuma aula versionavel esta desatualizada.");
    } catch (err) {
      setErro(err.message);
    } finally {
      setVerificando(false);
    }
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
      return [...seriesPorSegmento.get(fSegmento)].sort();
    }
    const todas = new Set();
    for (const set of seriesPorSegmento.values()) for (const s of set) todas.add(s);
    return [...todas].sort();
  }, [fSegmento, seriesPorSegmento]);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (itens || []).filter(item => {
      // tipoId ausente conta como Aula (1) — o mesmo default do resto do app.
      if (fTipo && String(item.tipoId ?? 1) !== fTipo) return false;
      if (fSegmento && !segmentosDoItem(item).includes(fSegmento)) return false;
      if (fSerie && !seriesDoItem(item).includes(fSerie)) return false;
      // Busca por id (exato/parcial) OU nome (substring), sem diferenciar maiuscula.
      if (termo) {
        const casaId = String(item.id || "").toLowerCase().includes(termo);
        const casaNome = String(item.nome || "").toLowerCase().includes(termo);
        if (!casaId && !casaNome) return false;
      }
      return true;
    });
  }, [itens, fTipo, fSegmento, fSerie, busca]);

  // Paginacao do acervo: 10 por pagina. `pagina` e limitada ao total; a fatia sai
  // do `filtrados` (o filtro roda antes da paginacao).
  const POR_PAGINA = 10;
  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA));
  // Se o filtro (ou uma remocao) encolheu a lista, nao deixa a pagina passar do fim.
  const paginaAtual = Math.min(pagina, totalPaginas);
  const inicio = (paginaAtual - 1) * POR_PAGINA;
  const paginados = filtrados.slice(inicio, inicio + POR_PAGINA);

  // Volta a pagina 1 quando o filtro ou a busca mudam — senao ficaria numa pagina que sumiu.
  useEffect(() => { setPagina(1); }, [fTipo, fSegmento, fSerie, busca]);
  // Fecha qualquer popover ao trocar de pagina (o item pode nem estar mais na tela).
  useEffect(() => { setExpandido(null); }, [paginaAtual]);

  if (erro) return <div className="aviso erro">{erro}</div>;
  if (!itens) return <div className="carregando">Carregando acervo...</div>;

  return (
    <>
      {aviso && <div className="aviso info">{aviso}</div>}

      {itens.length === 0 ? (
        <div className="vazio">Nenhum conteudo baixado ainda.</div>
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
            <div className="filtro filtro-busca">
              <label>Buscar</label>
              <div className="busca-wrap">
                <input
                  type="text"
                  value={busca}
                  onChange={e => setBusca(e.target.value)}
                  placeholder="id ou nome do conteudo"
                />
                {busca && (
                  <button type="button" className="busca-limpar" title="Limpar busca" onClick={() => setBusca("")}>
                    ×
                  </button>
                )}
              </div>
            </div>
            <div className="filtro">
              <label>Segmento</label>
              <select value={fSegmento} onChange={e => { setFSegmento(e.target.value); setFSerie(""); }}>
                <option value="">Todos</option>
                {opcoesSegmento.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="filtro">
              <label>Serie</label>
              <select value={fSerie} onChange={e => setFSerie(e.target.value)}>
                <option value="">Todas</option>
                {opcoesSerie.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="barra-acao">
            <span className="contagem">
              {filtrados.length
                ? `${inicio + 1}–${inicio + paginados.length} de ${filtrados.length}`
                : "0"} conteudos
              {(fTipo || fSegmento || fSerie || busca.trim()) ? ` (filtrado de ${itens.length})` : ""}
            </span>
            <div className="espaco" />
            <button onClick={verificar} disabled={verificando}
              title="Pergunta ao AVA se alguma pagina tem versao nova (nao baixa nada)">
              {verificando ? "Verificando..." : "Verificar atualizacões"}
            </button>
            <button onClick={reindexar} disabled={reindexando}
              title="Corrige serie/segmento dos conteudos baixados consultando o catalogo, sem re-baixar">
              {reindexando ? "Reindexando..." : "Reindexar metadados"}
            </button>
            <button onClick={carregar}>Atualizar</button>
          </div>

          <div className="tabela-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Nome</th>
                  <th>Identidade</th>
                  <th>Serie(s)</th>
                  <th>Formato</th>
                  <th>Versao</th>
                  <th>Paginas</th>
                  <th>Atualizacao</th>
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
                    <tr key={item.id}>
                      <td>{item.id}</td>
                      <td className="nome">{item.nome}</td>
                      <td>{selosDeIdentidade(item)}</td>
                      <td>{series.length ? series.join(", ") : <span style={{ color: "var(--txt-2)" }}>—</span>}</td>
                      <td>{selosDeFormato(item)}</td>
                      <td className="col-expansivel">
                        {temVersao ? (
                          <CelulaExpansivel
                            aberto={expandido === `${item.id}:versao`}
                            onAlternar={() => setExpandido(expandido === `${item.id}:versao` ? null : `${item.id}:versao`)}
                            resumo={`${paginas.length} ${paginas.length === 1 ? "pag" : "pags"}`}
                            titulo="Versao publicada de cada pagina (clique para ver)"
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
                              : "LO (external_id) de cada pagina (clique para ver)"}
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
                      <td>{seloAtualizacao(updates.get(String(item.id)))}</td>
                      <td className="check acoes-linha">
                        <button className="acao-icone baixar-estrutura" title="Baixar estrutura de LOs (zip: uma pasta por LO com os arquivos da aula)"
                          onClick={() => baixarEstruturaLOs(item)}>
                          <IconeBaixar />
                        </button>
                        <button className="acao-icone lixeira" title="Apagar do acervo"
                          onClick={() => remover(item)} disabled={removendo === item.id}>
                          {removendo === item.id ? <span className="spin-acao" /> : <IconeLixeira />}
                        </button>
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
            <div className="vazio">Nenhum conteudo do acervo bate com este filtro.</div>
          )}
        </>
      )}
    </>
  );
}
