// Teste de acesso ao bucket R2 — roda DEPOIS que o bucket existir, tiver um
// arquivo de teste e o CORS aplicado. Confirma duas coisas:
//   1. o arquivo baixa por HTTPS (URL publica do R2);
//   2. o CORS responde liberando a origem do PWA (preflight OPTIONS).
//
// Uso:
//   node r2/testar-r2.mjs <URL_PUBLICA_DO_ARQUIVO> [origem]
// Ex.:
//   node r2/testar-r2.mjs https://pub-xxxx.r2.dev/teste.txt http://localhost:5173

const url = process.argv[2];
const origem = process.argv[3] || "http://localhost:5173";

if (!url) {
  console.error("Uso: node r2/testar-r2.mjs <URL_PUBLICA> [origem]");
  process.exit(1);
}

async function principal() {
  console.log(`Testando ${url}`);
  console.log(`Origem simulada do PWA: ${origem}\n`);

  // 1. Preflight CORS (o navegador faz isso antes do fetch real).
  try {
    const pre = await fetch(url, {
      method: "OPTIONS",
      headers: {
        Origin: origem,
        "Access-Control-Request-Method": "GET"
      }
    });
    const permitido = pre.headers.get("access-control-allow-origin");
    console.log(`CORS preflight: HTTP ${pre.status}`);
    console.log(`  Access-Control-Allow-Origin: ${permitido || "(ausente!)"}`);
    if (permitido === origem || permitido === "*") {
      console.log("  -> CORS OK para esta origem\n");
    } else {
      console.log("  -> CORS NAO libera esta origem — o fetch do PWA seria bloqueado\n");
    }
  } catch (e) {
    console.log(`CORS preflight falhou: ${e.message}\n`);
  }

  // 2. Download real.
  try {
    const t0 = Date.now();
    const r = await fetch(url);
    const buf = Buffer.from(await r.arrayBuffer());
    console.log(`Download: HTTP ${r.status}, ${buf.length} bytes em ${Date.now() - t0}ms`);
    console.log(`  Content-Type: ${r.headers.get("content-type")}`);
    console.log(r.ok ? "  -> Download OK" : "  -> Download FALHOU");
  } catch (e) {
    console.log(`Download falhou: ${e.message}`);
  }
}

principal();
