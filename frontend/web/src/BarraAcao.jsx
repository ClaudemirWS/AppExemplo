export default function BarraAcao({ contagem, busca, onBusca, children }) {
  return (
    <div className="barra-acao barra-acao-compartilhada">
      <span className="contagem">{contagem}</span>
      <div className="busca-wrap barra-busca">
        <input
          type="text"
          value={busca}
          onChange={e => onBusca(e.target.value)}
          placeholder="id ou nome do conteúdo"
        />
        {busca && (
          <button
            type="button"
            className="busca-limpar"
            title="Limpar busca"
            aria-label="Limpar busca"
            onClick={() => onBusca("")}
          >
            ×
          </button>
        )}
      </div>
      <div className="barra-acao-botoes">{children}</div>
    </div>
  );
}
