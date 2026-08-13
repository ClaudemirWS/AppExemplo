import { useState } from "react";
import { api } from "./api.js";

export default function Login({ onEntrar }) {
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [entrando, setEntrando] = useState(false);

  async function enviar(e) {
    e.preventDefault();
    setErro("");
    setEntrando(true);
    try {
      const dados = await api.login(usuario, senha);
      onEntrar({ usuario: dados.usuario, papel: dados.papel });
    } catch (err) {
      setErro(err.message);
    } finally {
      setEntrando(false);
    }
  }

  return (
    <form className="login-caixa" onSubmit={enviar}>
      <h1>Acervo Educandus</h1>
      <p>Downloader de conteudos. Entre com sua credencial do AVA.</p>

      {erro && <div className="aviso erro">{erro}</div>}

      <div className="campo">
        <label>Usuario</label>
        <input value={usuario} onChange={e => setUsuario(e.target.value)} autoFocus />
      </div>
      <div className="campo">
        <label>Senha</label>
        <input type="password" value={senha} onChange={e => setSenha(e.target.value)} />
      </div>
      <button className="primario" style={{ width: "100%" }} disabled={entrando}>
        {entrando ? "Entrando..." : "Entrar"}
      </button>
    </form>
  );
}
