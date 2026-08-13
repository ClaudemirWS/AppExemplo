// Disciplinas (componentes curriculares) que o downloader pode filtrar.
//
// Historia: o downloader nasceu TRAVADO em Matematica. Ao liberar Lingua Portuguesa
// (13/08/2026) este modulo virou uma pequena TABELA de disciplinas, mas o nome do
// arquivo continua `disciplinaMatematica.js` porque so o index.js o importa e nao
// vale renomear (SPEC/memoria referenciam este caminho).
//
// Cada disciplina tem um `id` numerico do AVA (o que vai no campo `discipline` do
// listLibraryFilter) e o rotulo mostrado no seletor "Componente".
//
// EDUCACAO INFANTIL: o AVA nao usa a disciplina do Fundamental no Infantil — ali o
// componente e um "campo de experiencia" BNCC com id proprio. Para Matematica esse
// campo e o ETQRT (id 27). Por isso a disciplina carrega `idInfantil` (quando
// conhecido) e a taxonomia casa por `reconhece()` (nome), capturando o id real que o
// AVA devolver na serie. Portugues ainda NAO tem o id do Infantil mapeado, entao so
// vale no Fundamental (idInfantil ausente -> series de Infantil ficam de fora).

export const DISCIPLINA_MATEMATICA = 1;
export const DISCIPLINA_PORTUGUES = 5;

// Tabela das disciplinas EXPOSTAS no seletor. Acrescentar outra (Arte, Ciencias...)
// e so somar uma linha aqui — e, se for cobrir o Infantil dela, preencher idInfantil
// e ajustar `reconhece`.
export const DISCIPLINAS = [
  {
    id: DISCIPLINA_MATEMATICA,
    rotulo: "Matematica",
    idInfantil: 27, // ETQRT: "Espacos, tempos, quantidades, relacoes e transformacoes"
    reconhece: nome =>
      /matem[aá]tica/i.test(nome) || /espa[çc]os,?\s*tempos,?\s*quantidades/i.test(nome)
  },
  {
    id: DISCIPLINA_PORTUGUES,
    rotulo: "Lingua Portuguesa",
    idInfantil: null, // Infantil de Portugues nao mapeado ainda — so Fundamental.
    reconhece: nome => /portugu[eê]s/i.test(nome) || /l[ií]ngua\s+portuguesa/i.test(nome)
  }
];

// Lista simples {id, rotulo} para o front montar o seletor.
export function listarDisciplinas() {
  return DISCIPLINAS.map(d => ({ id: d.id, rotulo: d.rotulo }));
}

// Disciplina da tabela por id (default Matematica — o comportamento historico
// quando nada e informado).
export function disciplinaPorId(id) {
  return DISCIPLINAS.find(d => d.id === Number(id)) || DISCIPLINAS[0];
}

// Reconhece o componente de uma disciplina do AVA (objeto {id, name}) como
// pertencente a `disciplinaAlvo`. Casa por id (Fundamental), por id do Infantil
// (quando houver) ou por nome (cobre o campo de experiencia BNCC do Infantil).
export function ehComponenteDaDisciplina(disciplina, disciplinaAlvo) {
  const idAva = Number(disciplina?.id);
  const nome = String(disciplina?.name || "");
  return (
    idAva === disciplinaAlvo.id ||
    (disciplinaAlvo.idInfantil != null && idAva === disciplinaAlvo.idInfantil) ||
    disciplinaAlvo.reconhece(nome)
  );
}

// Compat: o "componente de Matematica" de antes, agora um caso de `ehComponenteDaDisciplina`.
export function ehComponenteMatematica(disciplina) {
  return ehComponenteDaDisciplina(disciplina, disciplinaPorId(DISCIPLINA_MATEMATICA));
}

export function segmentoEhInfantil(nomeSegmento) {
  return /infantil/i.test(String(nomeSegmento || ""));
}

// Resolve o `discipline` a enviar ao listLibraryFilter. `disciplinaId` e a disciplina
// escolhida no seletor (default Matematica). `disciplinaSerieId` e o id que a
// taxonomia capturou para a serie especifica (no Fundamental = o proprio id; no
// Infantil de Matematica = 27). Os 4 casos reais do AVA:
export function resolverDiscipline({
  temSegmento,
  ehInfantil,
  temSerie,
  disciplinaSerieId,
  disciplinaId = DISCIPLINA_MATEMATICA
}) {
  const disc = disciplinaPorId(disciplinaId);

  if (temSerie) {
    // Serie especifica: o id que a taxonomia capturou para ela (Fundamental = id da
    // disciplina; Infantil de Matematica = 27). Fallback = id da disciplina.
    return disciplinaSerieId || disc.id;
  }
  if (ehInfantil && temSegmento) {
    // Infantil fixo + todas as series: unico caso `null` do AVA (o backend resolve o
    // campo de experiencia). Igual para qualquer disciplina.
    return null;
  }
  // Fundamental+Todas e Todos/Todos: a disciplina escolhida, travada.
  return disc.id;
}
