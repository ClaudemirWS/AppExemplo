// Testa a resolucao de disciplina do catalogo (Matematica id 1, Portugues id 5) e o
// reconhecimento de componente (inclui o ETQRT do Infantil so p/ Matematica).
// node:assert puro. Uso: node servidor/testar-disciplinas.mjs
import assert from "node:assert/strict";
import {
  resolverDiscipline,
  ehComponenteDaDisciplina,
  disciplinaPorId,
  listarDisciplinas,
  DISCIPLINA_MATEMATICA,
  DISCIPLINA_PORTUGUES
} from "./disciplinaMatematica.js";

let passou = 0;
function teste(nome, fn) { fn(); passou += 1; console.log(`  ok  ${nome}`); }

const MAT = disciplinaPorId(DISCIPLINA_MATEMATICA);
const PT = disciplinaPorId(DISCIPLINA_PORTUGUES);

teste("expoe exatamente Matematica e Portugues", () => {
  assert.deepEqual(listarDisciplinas().map(d => d.id), [1, 5]);
});

teste("default (sem disciplinaId) continua Matematica", () => {
  assert.equal(disciplinaPorId(undefined).id, 1);
  assert.equal(resolverDiscipline({ temSegmento: true, ehInfantil: false, temSerie: false }), 1);
});

teste("Fundamental + todas: manda o id da disciplina escolhida", () => {
  assert.equal(
    resolverDiscipline({ temSegmento: true, ehInfantil: false, temSerie: false, disciplinaId: 5 }),
    5
  );
});

teste("serie especifica: usa o id capturado pra serie", () => {
  // Fundamental de Portugues: disciplinaSerieId = 5.
  assert.equal(
    resolverDiscipline({ temSerie: true, disciplinaSerieId: 5, disciplinaId: 5 }),
    5
  );
  // Infantil de Matematica: disciplinaSerieId = 27 (ETQRT).
  assert.equal(
    resolverDiscipline({ temSerie: true, disciplinaSerieId: 27, disciplinaId: 1 }),
    27
  );
});

teste("Infantil + todas as series: null (backend resolve), qualquer disciplina", () => {
  assert.equal(resolverDiscipline({ temSegmento: true, ehInfantil: true, temSerie: false, disciplinaId: 1 }), null);
  assert.equal(resolverDiscipline({ temSegmento: true, ehInfantil: true, temSerie: false, disciplinaId: 5 }), null);
});

teste("reconhece Matematica por id, nome e ETQRT (Infantil)", () => {
  assert.equal(ehComponenteDaDisciplina({ id: 1, name: "Matematica" }, MAT), true);
  assert.equal(ehComponenteDaDisciplina({ id: 999, name: "Matemática" }, MAT), true);
  assert.equal(ehComponenteDaDisciplina({ id: 27, name: "Espacos, tempos, quantidades..." }, MAT), true);
});

teste("reconhece Portugues por id e nome", () => {
  assert.equal(ehComponenteDaDisciplina({ id: 5, name: "Lingua Portuguesa" }, PT), true);
  assert.equal(ehComponenteDaDisciplina({ id: 999, name: "Português" }, PT), true);
});

teste("nao confunde Matematica com Portugues (e vice-versa)", () => {
  assert.equal(ehComponenteDaDisciplina({ id: 5, name: "Lingua Portuguesa" }, MAT), false);
  assert.equal(ehComponenteDaDisciplina({ id: 1, name: "Matematica" }, PT), false);
  // ETQRT (Infantil de Mat) NAO deve casar como Portugues.
  assert.equal(ehComponenteDaDisciplina({ id: 27, name: "Espacos, tempos, quantidades..." }, PT), false);
});

console.log(`\n${passou} testes ok.`);
