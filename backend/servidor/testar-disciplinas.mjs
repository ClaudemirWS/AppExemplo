// Testa o modelo DINAMICO de componentes: extracao da lista a partir do
// filterStructureObjective (disciplinasDaEstrutura) e a resolucao do `discipline`
// enviado ao listLibraryFilter (resolverDiscipline). node:assert puro.
// Uso: node servidor/testar-disciplinas.mjs
import assert from "node:assert/strict";
import {
  resolverDiscipline,
  disciplinasDaEstrutura,
  DISCIPLINA_MATEMATICA
} from "./disciplinaMatematica.js";

let passou = 0;
function teste(nome, fn) { fn(); passou += 1; console.log(`  ok  ${nome}`); }

// Amostra minima no formato do filterStructureObjective (data -> series -> disciplines),
// espelhando o AVA: Fundamental com Matematica/Historia e Infantil com o campo BNCC 27.
const ESTRUTURA = {
  data: [
    {
      id: 2, name: "Ensino Fundamental Anos Iniciais",
      series: [
        { id: 7, name: "1º Ano EF", disciplines: [{ id: 1, name: "Matemática" }, { id: 9, name: "História" }] },
        { id: 9, name: "3º Ano EF", disciplines: [{ id: 9, name: "História" }, { id: 5, name: "Língua Portuguesa" }] }
      ]
    },
    {
      id: 1, name: "Educação Infantil",
      series: [
        { id: 3, name: "Infantil 2 anos", disciplines: [{ id: 27, name: "Espaços, tempos, quantidades, relações e transformações" }] }
      ]
    }
  ]
};

teste("disciplinasDaEstrutura extrai distintos, ordenados por nome", () => {
  const ds = disciplinasDaEstrutura(ESTRUTURA);
  assert.deepEqual(ds.map(d => d.id).sort((a, b) => a - b), [1, 5, 9, 27]);
  // ordenado por rotulo pt-BR: Espaços, História, Língua Portuguesa, Matemática
  assert.deepEqual(ds.map(d => d.rotulo), [
    "Espaços, tempos, quantidades, relações e transformações",
    "História",
    "Língua Portuguesa",
    "Matemática"
  ]);
});

teste("estrutura vazia/ausente => lista vazia (sem quebrar)", () => {
  assert.deepEqual(disciplinasDaEstrutura(null), []);
  assert.deepEqual(disciplinasDaEstrutura({}), []);
  assert.deepEqual(disciplinasDaEstrutura({ data: [] }), []);
});

teste("default (sem disciplinaId) continua Matematica (id 1)", () => {
  assert.equal(DISCIPLINA_MATEMATICA, 1);
  assert.equal(resolverDiscipline({ temSegmento: true, ehInfantil: false, temSerie: false }), 1);
});

teste("Fundamental + todas: manda o id do componente escolhido", () => {
  assert.equal(resolverDiscipline({ temSegmento: true, ehInfantil: false, temSerie: false, disciplinaId: 9 }), 9);
});

teste("serie especifica: usa o id capturado pra serie", () => {
  // Fundamental de Historia: disciplinaSerieId = 9.
  assert.equal(resolverDiscipline({ temSerie: true, disciplinaSerieId: 9, disciplinaId: 9 }), 9);
  // Infantil (campo BNCC): disciplinaSerieId = 27.
  assert.equal(resolverDiscipline({ temSerie: true, disciplinaSerieId: 27, disciplinaId: 27 }), 27);
});

teste("Infantil + todas as series: null (backend resolve o campo)", () => {
  assert.equal(resolverDiscipline({ temSegmento: true, ehInfantil: true, temSerie: false, disciplinaId: 1 }), null);
  assert.equal(resolverDiscipline({ temSegmento: true, ehInfantil: true, temSerie: false, disciplinaId: 27 }), null);
});

console.log(`\n${passou} testes ok.`);
