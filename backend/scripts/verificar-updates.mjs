// Verificador de atualizacoes do acervo — NAO baixa nenhuma aula.
//
// Para cada conteudo do acervo, compara o vN gravado (mapa `versoes`) com o vN atual
// do publicador do AVA. Lista os DESATUALIZADOS (alguma pagina tem vN novo), sem
// baixar nada — so consulta a listagem de versoes de cada LO.
//
// FONTE: com R2 configurado, le o manifesto.json do BUCKET (rapido, ja tem `versoes`
// de cada aula — nao baixa zip nenhum). Sem R2, cai no disco local.
//
// Uso:
//   npm run verificar-updates -- --usuario u --senha s
//   npm run verificar-updates -- --usuario u --senha s --json
//   ACERVO_USUARIO=u ACERVO_SENHA=s npm run verificar-updates

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, strFromU8 } from "fflate";
import { login } from "../servidor/avaApi.js";
import { verificarLista } from "../servidor/verificadorVersao.js";
import { r2Configurado, lerObjeto } from "../servidor/r2Cliente.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const DIR_CONTEUDOS = path.join(AQUI, "..", "acervo", "offline-conteudos");

function lerArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      const chave = argv[i].slice(2);
      const valor = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      args[chave] = valor;
    }
  }
  return args;
}

// Reune os registros do acervo (com `versoes`): do manifesto do R2, ou dos zips locais.
async function reunirRegistros() {
  if (r2Configurado()) {
    const m = JSON.parse((await lerObjeto("manifesto.json")).toString("utf-8"));
    return (m.conteudos || []).map(c => ({ ...c, arquivo: c.arquivo }));
  }
  const arquivos = (await fs.readdir(DIR_CONTEUDOS)).filter(n => n.endsWith(".zip")).sort();
  const registros = [];
  for (const arquivo of arquivos) {
    try {
      const bytes = new Uint8Array(await fs.readFile(path.join(DIR_CONTEUDOS, arquivo)));
      const arq = unzipSync(bytes, { filter: f => f.name === "indice.json" });
      registros.push({ ...JSON.parse(strFromU8(arq["indice.json"])), arquivo });
    } catch {
      registros.push({ arquivo, id: arquivo, nome: arquivo, versoes: {}, paginas: [] });
    }
  }
  return registros;
}

async function principal() {
  const args = lerArgs(process.argv);
  const usuario = args.usuario || process.env.ACERVO_USUARIO;
  const senha = args.senha || process.env.ACERVO_SENHA;
  const comoJson = Boolean(args.json);

  if (!usuario || !senha) {
    console.error("Uso: npm run verificar-updates -- --usuario <user> --senha <senha> [--json]");
    console.error("(usuario/senha tambem podem vir de ACERVO_USUARIO / ACERVO_SENHA)");
    process.exit(1);
  }

  const registros = await reunirRegistros();
  if (!registros.length) {
    console.error("Acervo vazio — nada a verificar.");
    process.exit(0);
  }

  if (!comoJson) console.log(`Autenticando como ${usuario}... (${registros.length} conteudos)`);
  await login({ usuario, senha });

  const { resultados } = await verificarLista(registros);

  if (comoJson) {
    console.log(JSON.stringify({ total: resultados.length, resultados }, null, 2));
    return;
  }

  const marca = { atualizado: "ok  ", desatualizado: "NOVO", "nao-versionavel": "?   ", erro: "ERRO" };
  console.log("");
  for (const r of resultados) {
    console.log(`[${marca[r.situacao] || "?   "}] ${r.id || "?"}  ${r.nome || r.arquivo}`);
    if (r.situacao === "desatualizado") {
      for (const p of r.paginas.filter(x => x.desatualizada)) {
        console.log(`         pagina ${p.externalId}: ${p.versaoGravada} -> ${p.versaoAtual}`);
      }
    } else if (r.situacao === "nao-versionavel") {
      console.log(`         ${r.motivo}`);
    } else if (r.situacao === "erro") {
      console.log(`         ${r.paginas?.find(p => p.erro)?.erro || "falha ao consultar"}`);
    }
  }

  const desatualizados = resultados.filter(r => r.situacao === "desatualizado");
  console.log("");
  console.log(`Total: ${resultados.length} | desatualizados: ${desatualizados.length} | ` +
    `nao-versionaveis: ${resultados.filter(r => r.situacao === "nao-versionavel").length} | ` +
    `erros: ${resultados.filter(r => r.situacao === "erro").length}`);
  if (desatualizados.length) {
    console.log(`\nRebaixe estes IDs para atualizar: ${desatualizados.map(r => r.id).join(" ")}`);
  } else {
    console.log("\nNenhuma aula versionavel esta desatualizada.");
  }
}

principal().catch(erro => {
  console.error(`\nErro: ${erro.message}`);
  process.exit(1);
});
