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
      .then(h => { if (h.autenticado) setSessao({ usuario: "(sessao ativa)", papel: "" }); })
      .catch(() => {})
      .finally(() => setVerificando(false));
  }, []);

  async function sair() {
    await api.logout().catch(() => {});
    setSessao(null);
  }

  if (verificando) {
    return <div className="carregando">Carregando...</div>;
  }

  if (!sessao) {
    return <Login onEntrar={setSessao} />;
  }

  return (
    <div className="app">
      <div className="topo">
        <h1>Acervo Educandus</h1>
        <div>
          <span className="usuario">{sessao.usuario}{sessao.papel ? ` · ${sessao.papel}` : ""}</span>
          <button style={{ marginLeft: 12 }} onClick={sair}>Sair</button>
        </div>
      </div>

      <div className="abas">
        <button className={aba === "catalogo" ? "ativa" : ""} onClick={() => setAba("catalogo")}>
          Catalogo
        </button>
        <button className={aba === "acervo" ? "ativa" : ""} onClick={() => setAba("acervo")}>
          Acervo baixado
        </button>
      </div>

      {aba === "catalogo" ? <Catalogo /> : <Acervo />}
    </div>
  );
}
