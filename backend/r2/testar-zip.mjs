// Teste do canal completo: baixa um ZIP do R2 e descompacta com fflate — o mesmo
// que o PWA fara (fetch HTTPS + unzip no cliente). Confirma que o zip chega
// inteiro e lista o que tem dentro, para conferir que a arvore do pacote esta la.
//
// Uso: node r2/testar-zip.mjs <URL_DO_ZIP>
import { unzipSync } from "fflate";

const url = process.argv[2];
if (!url) {
  console.error("Uso: node r2/testar-zip.mjs <URL_DO_ZIP>");
  process.exit(1);
}

async function principal() {
  console.log(`Baixando zip: ${url}`);
  const t0 = Date.now();
  const r = await fetch(url);
  if (!r.ok) {
    console.error(`Download falhou: HTTP ${r.status}`);
    process.exit(1);
  }
  const bytes = new Uint8Array(await r.arrayBuffer());
  console.log(`Baixado: ${bytes.length} bytes em ${Date.now() - t0}ms\n`);

  console.log("Descompactando com fflate...");
  let arquivos;
  try {
    arquivos = unzipSync(bytes);
  } catch (e) {
    console.error(`Unzip falhou: ${e.message}`);
    process.exit(1);
  }

  const nomes = Object.keys(arquivos);
  console.log(`OK: ${nomes.length} arquivos no zip.\n`);
  console.log("=== conteudo (primeiros 30) ===");
  for (const nome of nomes.slice(0, 30)) {
    console.log(`  ${nome}  (${arquivos[nome].length}b)`);
  }
  if (nomes.length > 30) console.log(`  … (+${nomes.length - 30})`);

  // Checagens que importam para a semente do PWA:
  const temIndice = nomes.some(n => /indice\.json$/i.test(n));
  const temIndexHtml = nomes.some(n => /pagina-\d+\/index\.html$/i.test(n));
  console.log("\n=== checagens ===");
  console.log(`  tem indice.json?           ${temIndice ? "sim" : "NAO"}`);
  console.log(`  tem pagina-N/index.html?   ${temIndexHtml ? "sim" : "NAO"}`);
}

principal();
