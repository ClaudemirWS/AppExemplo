import { useEffect, useState } from "react";
import "./estilo.css";
import { api } from "./api.js";
import Login from "./Login.jsx";
import Catalogo from "./Catalogo.jsx";
import Acervo from "./Acervo.jsx";

export default function App() {
  const [sessao, setSessao] = useState(null); // {usuario, papel}
  const [aba, setAba] = useState("catalogo");
  const [verificando, setVerificando] = useState(true);

  useEffect(() => {
    api.health()
      .then(h => { if (h.autenticado) setSessao({ usuario: "(sessão ativa)", papel: "" }); })
      .catch(() => {})
      .finally(() => setVerificando(false));
  }, []);

  async function sair() {
    await api.logout().catch(() => {});
    setSessao(null);
  }

  if (verificando) {
    return <div className="tela-carregando"><span className="spin" /> Carregando...</div>;
  }

  if (!sessao) {
    return <Login onEntrar={setSessao} />;
  }

  return (
    <>
      <header className="cabecalho">
        <div className="cabecalho-inner">
          <div className="marca">
            <img className="marca-logo" src="/logo-educandus-branco.png" alt="Educandus" />
            <span className="marca-divisor" aria-hidden="true" />
            <span className="marca-tag">Acervo de Conteúdos</span>
          </div>
          <div className="cabecalho-user">
            <span className="usuario">
              {sessao.usuario}{sessao.papel ? ` · ${sessao.papel}` : ""}
            </span>
            <button className="btn-sair" onClick={sair}>Sair</button>
          </div>
        </div>
      </header>

      <main className="app">
        <nav className="abas" aria-label="Seções">
          <button className={aba === "catalogo" ? "ativa" : ""} onClick={() => setAba("catalogo")}>
            Catálogo
          </button>
          <button className={aba === "acervo" ? "ativa" : ""} onClick={() => setAba("acervo")}>
            Acervo
          </button>
        </nav>

        {aba === "catalogo" ? <Catalogo /> : <Acervo />}
      </main>
    </>
  );
}
