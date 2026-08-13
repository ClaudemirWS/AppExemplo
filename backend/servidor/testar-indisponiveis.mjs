// Testa o registro persistente de indisponiveis (fallback de DISCO — sem R2).
// Aponta a raiz do acervo para uma pasta temporaria via ACERVO_RAIZ e exercita o
// ciclo: registrar -> ler -> re-registrar (atualiza) -> remover. node:assert puro.
//
// Uso: node servidor/testar-indisponiveis.mjs
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

// Precisa estar setado ANTES de importar o modulo (fsAcervo le no import) e sem R2.
const raizTmp = await fs.mkdtemp(path.join(os.tmpdir(), "acervo-indisp-"));
process.env.ACERVO_RAIZ = raizTmp;
delete process.env.R2_ACCOUNT_ID;
delete process.env.R2_ACCESS_KEY_ID;
delete process.env.R2_SECRET_ACCESS_KEY;
delete process.env.R2_BUCKET;

const { lerIndisponiveis, registrarIndisponivel, removerIndisponivel } =
  await import("./manifesto.js");

let passou = 0;
async function teste(nome, fn) {
  await fn();
  passou += 1;
  console.log(`  ok  ${nome}`);
}

try {
  await teste("lista vazia quando nada foi registrado", async () => {
    assert.deepEqual(await lerIndisponiveis(), []);
  });

  await teste("registra um indisponivel e le de volta", async () => {
    await registrarIndisponivel({
      id: 29909, nome: "Duzia e meia duzia", habilidade: "EF01MA01",
      serieNome: "1o Ano EF", motivo: "Nenhuma pagina suportada."
    });
    const itens = await lerIndisponiveis();
    assert.equal(itens.length, 1);
    assert.equal(itens[0].id, "29909"); // id sempre string
    assert.equal(itens[0].nome, "Duzia e meia duzia");
    assert.ok(itens[0].registradoEm, "carimba a data");
  });

  await teste("PERSISTE: uma nova leitura (arquivo em disco) ve o registro", async () => {
    // Simula 'reiniciar o servidor' — le do zero, sem estado em memoria.
    const itens = await lerIndisponiveis();
    assert.equal(itens.length, 1);
    assert.equal(itens[0].id, "29909");
  });

  await teste("re-registrar o mesmo id ATUALIZA, nao duplica", async () => {
    await registrarIndisponivel({ id: 29909, nome: "Duzia e meia duzia", motivo: "Outro motivo." });
    const itens = await lerIndisponiveis();
    assert.equal(itens.length, 1);
    assert.equal(itens[0].motivo, "Outro motivo.");
  });

  await teste("segundo id coexiste; lista ordenada por id", async () => {
    await registrarIndisponivel({ id: 12345, nome: "Outra aula" });
    const ids = (await lerIndisponiveis()).map(i => i.id);
    assert.deepEqual(ids, ["12345", "29909"]);
  });

  await teste("remover tira o id (ex.: baixou depois)", async () => {
    await removerIndisponivel(29909);
    const ids = (await lerIndisponiveis()).map(i => i.id);
    assert.deepEqual(ids, ["12345"]);
  });

  await teste("remover id ausente nao quebra", async () => {
    await removerIndisponivel(999999);
    assert.equal((await lerIndisponiveis()).length, 1);
  });

  console.log(`\n${passou} testes ok.`);
} finally {
  await fs.rm(raizTmp, { recursive: true, force: true });
}
