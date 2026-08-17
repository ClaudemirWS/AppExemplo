// Testa a persistencia do historico de VERIFICACOES (fallback de DISCO — sem R2).
// Aponta a raiz do acervo para uma pasta temporaria via ACERVO_RAIZ e exercita:
// registrar -> ler -> mesclar so os ids da rodada (mantendo os anteriores). node:assert.
//
// Uso: node servidor/testar-verificacoes.mjs
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const raizTmp = await fs.mkdtemp(path.join(os.tmpdir(), "acervo-verif-"));
process.env.ACERVO_RAIZ = raizTmp;
delete process.env.R2_ACCOUNT_ID;
delete process.env.R2_ACCESS_KEY_ID;
delete process.env.R2_SECRET_ACCESS_KEY;
delete process.env.R2_BUCKET;

const { lerVerificacoes, registrarVerificacoes } = await import("./manifesto.js");

let passou = 0;
async function teste(nome, fn) { await fn(); passou += 1; console.log(`  ok  ${nome}`); }

try {
  await teste("mapa vazio quando nada foi verificado", async () => {
    assert.deepEqual(await lerVerificacoes(), {});
  });

  await teste("registra resultado e carimba data", async () => {
    await registrarVerificacoes([
      { id: 100, situacao: "atualizado", paginas: [] },
      { id: 200, situacao: "desatualizado", paginas: [{ externalId: "AB", desatualizada: true }, { externalId: "CD", desatualizada: false }] }
    ]);
    const m = await lerVerificacoes();
    assert.equal(m["100"].situacao, "atualizado");
    assert.equal(m["200"].situacao, "desatualizado");
    assert.ok(m["100"].verificadoEm, "carimba verificadoEm");
    assert.deepEqual(m["200"].paginasDesatualizadas, ["AB"], "so as paginas desatualizadas, por externalId");
  });

  await teste("PERSISTE: nova leitura (disco) ve o registro", async () => {
    const m = await lerVerificacoes();
    assert.equal(Object.keys(m).length, 2);
  });

  await teste("re-registrar SO os ids da rodada mantem os outros", async () => {
    await registrarVerificacoes([{ id: 100, situacao: "desatualizado", paginas: [{ externalId: "XY", desatualizada: true }] }]);
    const m = await lerVerificacoes();
    assert.equal(m["100"].situacao, "desatualizado", "100 foi atualizado");
    assert.deepEqual(m["100"].paginasDesatualizadas, ["XY"]);
    assert.equal(m["200"].situacao, "desatualizado", "200 (nao verificado agora) mantem o registro anterior");
  });

  console.log(`\n${passou} testes ok.`);
} finally {
  await fs.rm(raizTmp, { recursive: true, force: true });
}
