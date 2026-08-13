// Reconstroi o manifesto.json do ZERO.
//
// O DOWNLOAD ja atualiza o manifesto de forma incremental (mescla so o item baixado)
// — entao este comando e para RECONCILIAR: reconstruir o manifesto lendo a verdade
// real, quando ele divergir dos zips (ex.: um upload falhou no meio) ou para forcar
// uma versao/serie.
//
// Uso:
//   npm run exportar -- --r2         (RECONSTROI do BUCKET R2 e sobe o manifesto)
//   npm run exportar                 (do disco local; todos, versao do env ou 1)
//   npm run exportar -- --serie 7    (do disco, so serie 7)
//   ACERVO_VERSAO_SEMENTE=3 npm run exportar -- --r2

import path from "node:path";
import { fileURLToPath } from "node:url";
import { gerarManifesto, gerarManifestoR2 } from "../servidor/manifesto.js";
import { r2Configurado, subirObjeto } from "../servidor/r2Cliente.js";

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

async function principal() {
  const args = lerArgs(process.argv);
  const versaoSemente = Number(process.env.ACERVO_VERSAO_SEMENTE || 1);
  const serieFiltro = args.serie ? Number(args.serie) : null;

  // Modo R2: reconstroi do bucket (le todos os zips de la) e SOBE o manifesto.
  // Lento (relê os zips), mas e a reconciliacao — so roda quando voce chama.
  if (args.r2) {
    if (!r2Configurado()) {
      console.error("R2 nao configurado (faltam variaveis R2_* no .env).");
      process.exit(1);
    }
    console.log("Reconstruindo o manifesto a partir do BUCKET R2 (le todos os zips)...");
    const manifesto = await gerarManifestoR2({ versaoSemente, serieFiltro, silencioso: true });
    await subirObjeto("manifesto.json", Buffer.from(JSON.stringify(manifesto, null, 2)), "application/json");
    console.log(`\nManifesto R2: ${manifesto.total} conteudos, versao ${manifesto.versaoSemente}. Subiu ao bucket.`);
    return;
  }

  // Modo disco (padrao): reconstroi a partir dos zips locais.
  const manifesto = await gerarManifesto(DIR_CONTEUDOS, {
    versaoSemente,
    serieFiltro,
    tipoIdPadrao: args.tipo ? Number(args.tipo) : 1
  });

  if (!manifesto) {
    console.error(`Pasta nao encontrada: ${DIR_CONTEUDOS}`);
    process.exit(1);
  }

  const totalMB = manifesto.conteudos.reduce((s, c) => s + c.bytesZip, 0) / 1024 / 1024;
  console.log(`\nManifesto: ${manifesto.total} conteudos, ${totalMB.toFixed(1)} MB, versao ${manifesto.versaoSemente}.`);
  console.log(`Escrito em: acervo/offline-conteudos/manifesto.json`);
}

principal().catch(e => {
  console.error("Erro:", e.message);
  process.exit(1);
});
