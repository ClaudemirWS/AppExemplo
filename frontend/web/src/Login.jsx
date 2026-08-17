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
    <div className="login-tela">
      <form className="login-caixa" onSubmit={enviar}>
        <div className="login-marca">
          <img className="login-logo" src="/logo-educandus-branco.png" alt="Educandus" />
        </div>

        {erro && <div className="aviso erro">{erro}</div>}

        <div className="campo">
          <label>Usuário</label>
          <input value={usuario} onChange={e => setUsuario(e.target.value)} autoFocus />
        </div>
        <div className="campo">
          <label>Senha</label>
          <input type="password" value={senha} onChange={e => setSenha(e.target.value)} />
        </div>
        <button className="primario login-entrar" disabled={entrando}>
          {entrando ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </div>
  );
}
