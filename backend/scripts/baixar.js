// CLI de download — prova de conceito e ferramenta de linha de comando.
//
// O PROPRIO USUARIO roda, com a propria credencial. Nenhuma chamada de rede
// parte de outro lugar. Uso:
//
//   npm run baixar -- --id 870989 --usuario meu.user --senha minhaSenha
//   npm run baixar -- --id 870989 --usuario u --senha s --paginas 1,3
//
// Baixa o conteudo para acervo/ no MESMO formato do PWA e imprime o formato
// detectado de cada pagina (Construct 2/3, Animate, HTML...).

import { login } from "../servidor/avaApi.js";
import { baixarConteudo } from "../servidor/baixarConteudo.js";
import { obterRaizAcervo } from "../adaptadores/fsAcervo.js";

function lerArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const atual = argv[i];
    if (atual.startsWith("--")) {
      const chave = atual.slice(2);
      const valor = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      args[chave] = valor;
    }
  }
  return args;
}

function barra(pct) {
  const cheio = Math.round((pct / 100) * 30);
  return `[${"#".repeat(cheio)}${".".repeat(30 - cheio)}] ${pct.toFixed(0)}%`;
}

async function principal() {
  const args = lerArgs(process.argv);
  const id = args.id;
  const usuario = args.usuario || process.env.ACERVO_USUARIO;
  const senha = args.senha || process.env.ACERVO_SENHA;

  if (!id || !usuario || !senha) {
    console.error("Uso: npm run baixar -- --id <ID> --usuario <user> --senha <senha> [--paginas 1,3]");
    console.error("(usuario/senha tambem podem vir de ACERVO_USUARIO / ACERVO_SENHA)");
    process.exit(1);
  }

  const ordens = args.paginas
    ? String(args.paginas).split(",").map(s => Number(s.trim())).filter(Boolean)
    : null;

  console.log(`Acervo em: ${obterRaizAcervo()}`);
  console.log(`Autenticando como ${usuario}...`);
  const { token, papeis } = await login({ usuario, senha });
  const papel = papeis?.[0]?.role_name || "(papel desconhecido)";
  console.log(`OK. Papel: ${papel}`);

  console.log(`Baixando conteudo ${id}${ordens ? ` (paginas ${ordens.join(",")})` : ""}...`);
  let ultimo = -1;
  const { detalhes, pacote, indice } = await baixarConteudo({
    token,
    conteudoId: id,
    ordensDesejadas: ordens,
    onProgresso: pct => {
      const arred = Math.floor(pct);
      if (arred !== ultimo) {
        ultimo = arred;
        process.stdout.write(`\r${barra(pct)}`);
      }
    }
  });
  process.stdout.write("\n");

  console.log(`\nConteudo: ${detalhes.nome}`);
  console.log(`Fluxo: ${detalhes.tipoFluxo} | convertido: ${detalhes.convertido}`);
  console.log(`Formato(s) detectado(s): ${indice.formatos.join(", ") || "desconhecido"}`);
  console.log(`Paginas baixadas: ${pacote.paginas.length}/${pacote.totalPaginas}`);
  for (const p of pacote.paginas) {
    console.log(`  pagina ${p.ordem}: ${p.formato} — ${p.quantidadeRecursos} recursos, ${(p.bytes / 1024).toFixed(0)} KB`);
  }
  if (pacote.paginasNaoSuportadas?.length) {
    console.log(`Nao suportadas: ${pacote.paginasNaoSuportadas.map(p => `pagina ${p.ordem} (${p.motivo})`).join("; ")}`);
  }
  console.log(`\nIndice gravado. Pacote pronto em acervo/offline-conteudos/${detalhes.id}/`);
}

principal().catch(erro => {
  console.error(`\nErro: ${erro.message}`);
  process.exit(1);
});
