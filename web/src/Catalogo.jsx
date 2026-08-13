import { useEffect, useMemo, useState } from "react";
import { api, baixarEmMassa } from "./api.js";

const OPCAO_TODOS = { id: "", nome: "Todos" };

function selosDeLista(lista) {
  return lista.map((f, i) => (
    <span key={i} className={`selo ${classeFormato(f)}`} style={{ marginRight: 4 }}>{f}</span>
  ));
}

// Rotulo e classe de selo para o formato/motivo de cada item. `baixado` e o
// registro do acervo (se ja foi baixado) — dele vem a lista COMPLETA de formatos
// da aula, que pode ter mais de um (ex.: animate + construct3).
function seloFormato(item, estadoDownload, baixado) {
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
  // Todos os formatos conhecidos: do download recem-concluido ou do acervo.
  const formatosProntos =
    (estadoDownload?.status === "ok" && (estadoDownload.formatos?.length ? estadoDownload.formatos : [estadoDownload.formato])) ||
    (baixado && (baixado.formatos?.length ? baixado.formatos : [baixado.formato]));
  const lista = (formatosProntos || []).filter(Boolean);
  if (lista.length) {
    return selosDeLista(lista);
  }
  if (estadoDownload?.status === "erro") {
    return <span className="selo erro" title={estadoDownload.motivo}>erro</span>;
  }
  if (estadoDownload?.status === "cancelado") {
    return <span className="selo desconhecido">cancelado</span>;
  }
  if (estadoDownload?.status === "indisponivel") {
    return <span className="selo flash" title={estadoDownload.motivo}>indisponivel</span>;
  }
  if (item.motivoIndisponivel) {
    return <span className="selo flash" title={item.motivoIndisponivel}>Flash</span>;
  }
  if (item.convertido === "VALBERTO") {
    return <span className="selo valberto">Valberto</span>;
  }
  // Formato tecnico so e conhecido apos baixar (decisao do projeto).
  return <span className="selo desconhecido">desconhecido</span>;
}

function classeFormato(f) {
  const t = String(f || "").toLowerCase();
  if (t.includes("construct2")) return "construct2";
  if (t.includes("construct3")) return "construct3";
  if (t.includes("animate")) return "animate";
  if (t.includes("flash")) return "flash";
  if (t.includes("valberto")) return "valberto";
  if (t.includes("html")) return "html";
  return "desconhecido";
}

// Flash nao e baixavel offline; nao deixa marcar (SPEC 17: bloqueado nao age).
function baixavel(item) {
  return item.convertido !== "NAO";
}

export default function Catalogo() {
  const [segmentos, setSegmentos] = useState([]);
  const [disciplinasDisp, setDisciplinasDisp] = useState([]); // {id,rotulo} do servidor
  const [disciplina, setDisciplina] = useState("1"); // "1"=Matematica, "5"=Portugues
  const [tipo, setTipo] = useState("1"); // 1 = Aula, 2 = Jogo
  const [segmento, setSegmento] = useState("");
  const [serie, setSerie] = useState("");
  const [busca, setBusca] = useState("");

  const [itens, setItens] = useState(null);
  const [meta, setMeta] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");

  const [marcados, setMarcados] = useState(() => new Set());
  const [estados, setEstados] = useState(() => ({})); // id -> {status,pct,formato,motivo}
  const [baixando, setBaixando] = useState(false);
  const [cancelar, setCancelar] = useState(null);
  const [parando, setParando] = useState(false);
  // ids que ja estao no acervo (id -> {formatos}), para marcar "baixado" e tirar
  // o azul do botao quando um deles estiver selecionado.
  const [baixados, setBaixados] = useState(() => new Map());
  // ids que falharam permanentemente (sem zip), persistidos no servidor. Sinalizados
  // na coluna Acervo mesmo apos reiniciar — mas NAO bloqueiam re-tentar.
  const [indisponiveis, setIndisponiveis] = useState(() => new Map());
  const [progressoFila, setProgressoFila] = useState(null); // {atual,total,concluidos}
  const [pagina, setPagina] = useState(1);

  function carregarBaixados() {
    api.acervo()
      .then(r => setBaixados(new Map((r.itens || []).map(i => [String(i.id), i]))))
      .catch(() => {});
    api.indisponiveis()
      .then(r => setIndisponiveis(new Map((r.itens || []).map(i => [String(i.id), i]))))
      .catch(() => {});
  }

  useEffect(() => {
    api.disciplinas()
      .then(r => setDisciplinasDisp(r.disciplinas || []))
      .catch(() => {});
    carregarBaixados();
  }, []);

  // A taxonomia (segmentos/series) depende da disciplina: refaz ao troca-la. Trocar
  // de componente zera segmento/serie (as series de uma disciplina nao valem p/ outra).
  useEffect(() => {
    setSegmento("");
    setSerie("");
    api.taxonomia(disciplina)
      .then(t => setSegmentos(t.segmentos || []))
      .catch(() => {});
  }, [disciplina]);

  const segAtual = useMemo(
    () => segmentos.find(s => String(s.id) === String(segmento)) || null,
    [segmentos, segmento]
  );
  const seriesDoSegmento = segAtual?.series || [];

  async function varrer() {
    setCarregando(true);
    setErro("");
    setMarcados(new Set());
    setEstados({});
    try {
      // discipline por serie: no Fundamental e o proprio id da disciplina; no Infantil
      // de Matematica e o ETQRT (27). A taxonomia ja capturou isso em disciplinaSerieId.
      const serieObj = seriesDoSegmento.find(s => String(s.id) === String(serie));
      const r = await api.catalogo({
        tipo,
        segment: segmento,
        serie,
        word: busca,
        infantil: segAtual?.infantil ? "true" : "",
        disciplina,
        disciplinaSerie: serieObj?.disciplinaSerieId || ""
      });
      setItens(r.itens);
      setMeta(r);
    } catch (err) {
      setErro(err.message);
      setItens(null);
    } finally {
      setCarregando(false);
    }
  }

  const baixaveis = useMemo(() => (itens || []).filter(baixavel), [itens]);
  // "Todos" e sobre a lista INTEIRA do filtro, nao a pagina — marcar todos marca
  // mesmo quem esta em outra pagina (o download em massa usa `marcados`, que ja
  // guarda ids de qualquer pagina).
  const todosMarcados = baixaveis.length > 0 && baixaveis.every(i => marcados.has(i.id));

  // Paginacao APENAS visual: fatia `itens` em 10 por pagina para exibir. A selecao
  // e o download continuam operando sobre a lista completa.
  const POR_PAGINA = 10;
  const totalItens = (itens || []).length;
  const totalPaginas = Math.max(1, Math.ceil(totalItens / POR_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const inicio = (paginaAtual - 1) * POR_PAGINA;
  const paginados = (itens || []).slice(inicio, inicio + POR_PAGINA);

  // Nova varredura (itens trocam) volta para a pagina 1.
  useEffect(() => { setPagina(1); }, [itens]);

  function alternarTodos() {
    setMarcados(todosMarcados ? new Set() : new Set(baixaveis.map(i => i.id)));
  }
  function alternar(id) {
    setMarcados(prev => {
      const proximo = new Set(prev);
      proximo.has(id) ? proximo.delete(id) : proximo.add(id);
      return proximo;
    });
  }

  function baixarSelecionados() {
    const ids = [...marcados];
    if (!ids.length) return;
    // Manda os itens completos (com serie/segmento/disciplina reais) para o
    // servidor gravar a classificacao no acervo — nao so o id.
    const itensSelecionados = (itens || [])
      .filter(i => marcados.has(i.id))
      .map(i => ({
        id: i.id,
        nome: i.nome || "",
        serieNome: i.serieNome || "",
        tipoId: i.tipoId ?? null,
        classificacoes: i.classificacoes || [],
        disciplinaId: i.disciplinaId ?? null,
        disciplina: i.disciplina || "",
        habilidade: i.habilidade || "",
        imagem: i.imagem || ""
      }));
    setBaixando(true);
    setProgressoFila({ atual: 0, total: ids.length, concluidos: 0 });
    setEstados(prev => {
      const p = { ...prev };
      ids.forEach(id => { p[id] = { status: "fila", pct: 0 }; });
      return p;
    });

    const parar = baixarEmMassa(itensSelecionados, {
      "item-inicio": ({ id, indice, total }) => {
        setProgressoFila(pf => ({ ...pf, atual: (indice ?? 0) + 1, total: total ?? pf.total }));
        setEstados(p => ({ ...p, [id]: { status: "baixando", pct: 0 } }));
      },
      progresso: ({ id, pct, retentando }) =>
        setEstados(p => ({ ...p, [id]: { status: "baixando", pct, retentando } })),
      "item-fim": d => {
        setProgressoFila(pf => ({ ...pf, concluidos: pf.concluidos + 1 }));
        setEstados(p => ({ ...p, [d.id]: d }));
      },
      fim: () => { setBaixando(false); setCancelar(null); carregarBaixados(); },
      erro: ({ motivo }) => { setErro(motivo); setBaixando(false); setCancelar(null); carregarBaixados(); }
    });
    setCancelar(() => parar);
  }

  // Parar de verdade: avisa o SERVIDOR (senao ele segue baixando a fila inteira em
  // background) e so depois aborta o stream no cliente.
  async function pararDownload() {
    setParando(true);
    try {
      await api.cancelarDownload();
    } catch {
      // se a chamada falhar, ainda abortamos o stream abaixo
    }
    if (cancelar) cancelar(); // aborta o fetch/SSE
    setBaixando(false);
    setParando(false);
    setCancelar(null);
    carregarBaixados();
  }

  // Azul (destaque) so quando NENHUM selecionado ja esta no acervo — evita
  // rebaixar por engano. O clique continua permitido (rebaixa por cima).
  const temBaixadoMarcado = [...marcados].some(id => baixados.has(String(id)));

  return (
    <>
      <div className="filtros">
        <div className="filtro">
          <label>Tipo de conteudo</label>
          <select value={tipo} onChange={e => setTipo(e.target.value)}>
            <option value="1">Aula</option>
            <option value="2">Jogo</option>
          </select>
        </div>
        <div className="filtro">
          <label>Segmento</label>
          <select value={segmento} onChange={e => { setSegmento(e.target.value); setSerie(""); }}>
            <option value="">Todos</option>
            {segmentos.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
        </div>
        <div className="filtro">
          <label>Serie</label>
          <select value={serie} onChange={e => setSerie(e.target.value)} disabled={!segmento}>
            <option value="">Todas</option>
            {seriesDoSegmento.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
        </div>
        <div className="filtro">
          <label>Componente</label>
          <select value={disciplina} onChange={e => setDisciplina(e.target.value)}>
            {disciplinasDisp.map(d => (
              <option key={d.id} value={String(d.id)}>{d.rotulo}</option>
            ))}
          </select>
        </div>
        <div className="filtro busca">
          <label>Busca (palavra inteira)</label>
          <input value={busca} onChange={e => setBusca(e.target.value)}
            onKeyDown={e => e.key === "Enter" && varrer()} placeholder="nome, tag, autor..." />
        </div>
        <button className="primario" onClick={varrer} disabled={carregando}>
          {carregando ? "Varrendo..." : "Listar"}
        </button>
      </div>

      {erro && <div className="aviso erro">{erro}</div>}
      {meta?.truncado && (
        <div className="aviso info">
          Varredura truncada na trava de seguranca ({meta.paginasLidas} paginas). Refine o filtro.
        </div>
      )}

      {baixando && progressoFila && (
        <div className="aviso info">
          Baixando {progressoFila.atual} de {progressoFila.total} · {progressoFila.concluidos} concluidos.
          Aulas grandes (muitas paginas Construct) levam alguns minutos cada.
        </div>
      )}

      {itens && (
        <div className="barra-acao">
          <span className="contagem">
            {itens.length} conteudos · {baixaveis.length} baixaveis · {marcados.size} marcados
            {totalPaginas > 1 ? ` · pag. ${paginaAtual}/${totalPaginas}` : ""}
          </span>
          <div className="espaco" />
          <button onClick={alternarTodos} disabled={!baixaveis.length}>
            {todosMarcados ? "Desmarcar todos" : "Marcar todos"}
          </button>
          <button
            className={temBaixadoMarcado ? "" : "primario"}
            onClick={baixarSelecionados}
            disabled={!marcados.size || baixando}
            title={temBaixadoMarcado ? "Ha itens ja baixados na selecao — serao rebaixados por cima" : ""}
          >
            {baixando
              ? "Baixando..."
              : temBaixadoMarcado
                ? `Rebaixar ${marcados.size} selecionados`
                : `Baixar ${marcados.size || ""} selecionados`}
          </button>
          {baixando && (
            <button onClick={pararDownload} disabled={parando}>
              {parando ? "Parando..." : "Parar"}
            </button>
          )}
        </div>
      )}

      {carregando && <div className="carregando">Varrendo o catalogo (todas as paginas)...</div>}

      {itens && !carregando && (
        itens.length === 0 ? (
          <div className="vazio">Nenhum conteudo para este filtro.</div>
        ) : (
          <div className="tabela-wrap">
            <table>
              <thead>
                <tr>
                  <th className="check">
                    <input type="checkbox" checked={todosMarcados} onChange={alternarTodos} />
                  </th>
                  <th>ID</th>
                  <th>Nome</th>
                  <th>Serie</th>
                  <th>Habilidade</th>
                  <th>Formato</th>
                  <th>Acervo</th>
                </tr>
              </thead>
              <tbody>
                {paginados.map(item => {
                  const podeBaixar = baixavel(item);
                  const estaBaixado = baixados.has(String(item.id));
                  const indisp = indisponiveis.get(String(item.id));
                  return (
                    <tr key={item.id} className={podeBaixar ? "" : "indisponivel"}>
                      <td className="check">
                        <input type="checkbox" disabled={!podeBaixar}
                          checked={marcados.has(item.id)} onChange={() => alternar(item.id)} />
                      </td>
                      <td>{item.id}</td>
                      <td className="nome">{item.nome}</td>
                      <td>{item.serieNome || "-"}</td>
                      <td>{item.habilidade || "-"}</td>
                      <td>{seloFormato(item, estados[item.id], baixados.get(String(item.id)))}</td>
                      <td className="col-acervo">
                        {estaBaixado ? (
                          <span className="selo-baixado" title="Ja esta no acervo">no acervo</span>
                        ) : indisp ? (
                          <span className="selo-indisp"
                            title="Por algum motivo esta aula foi impossível de guardar, você pode tentar novamente.">
                            indisponível
                          </span>
                        ) : (
                          <span className="traco-acervo" title="Ainda nao baixado">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {itens && !carregando && totalPaginas > 1 && (
        <div className="paginacao">
          <button onClick={() => setPagina(p => Math.max(1, p - 1))} disabled={paginaAtual <= 1}>
            ‹ Anterior
          </button>
          <span className="paginacao-indicador">Página {paginaAtual} de {totalPaginas}</span>
          <button onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))} disabled={paginaAtual >= totalPaginas}>
            Próxima ›
          </button>
        </div>
      )}

      {!itens && !carregando && (
        <div className="vazio">Escolha um filtro e clique em Listar para varrer o catalogo.</div>
      )}
    </>
  );
}
