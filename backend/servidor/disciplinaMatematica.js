// Componentes curriculares (disciplinas) do downloader.
//
// Historia: o downloader nasceu TRAVADO em Matematica; virou uma tabela fixa (Mat +
// Portugues) e depois uma tabela de 34. O nome do arquivo continua `disciplinaMatematica.js`
// porque SPEC/memoria referenciam este caminho e nao vale renomear.
//
// MODELO DINAMICO (24/08/2026): a lista de componentes NAO e mais uma tabela fixa — e
// DERIVADA em runtime do mesmo endpoint que o AVA usa (content/los/filterStructureObjective),
// escopado pela conta logada (grupo). Assim o downloader mostra EXATAMENTE os componentes
// que a conta tem direito, batendo 1:1 com o "AVA original". Verificado no backend Laravel:
//   - LosController@filterStructureObjective monta data -> series -> disciplines;
//   - Los::filterStructureObjective aplica hide_flash (converted IN SIM/VALBERTO) e as
//     permissoes de segmento (EI/EF1/EF2/EM/EJA) a partir do grupo do usuario;
//   - o front do AVA (ContentMedia.jsx) monta o seletor "Componente" percorrendo
//     serie.disciplines dessa mesma estrutura, sem filtro extra.
// Como o downloader usa a MESMA conta do AVA, derivar daqui reproduz o recorte do AVA.
//
// MODELO FLAT: cada componente e o proprio id do AVA. No Infantil o AVA usa um "campo de
// experiencia" BNCC com id proprio (ex.: 27 = ETQRT = a Matematica do Infantil) — e ele
// aparece como um componente separado no seletor, exatamente como no AVA. Nao ha
// unificacao por tabela; o casamento e sempre por id.
//
// Este modulo guarda apenas ids default e helpers PUROS (sem estado); a lista viva vem
// do servidor via `disciplinasDaEstrutura`.

export const DISCIPLINA_MATEMATICA = 1;
export const DISCIPLINA_PORTUGUES = 5;

// Extrai os componentes distintos de uma resposta do filterStructureObjective
// (data -> series -> disciplines). Devolve [{ id, rotulo }] ordenado por nome.
// Espelha o que o ContentMedia.jsx do AVA faz para montar o seletor "Componente".
export function disciplinasDaEstrutura(estrutura) {
  const vistos = new Map(); // id -> nome
  for (const seg of estrutura?.data || []) {
    for (const s of seg?.series || []) {
      for (const d of s?.disciplines || []) {
        if (d?.id == null) continue;
        const id = Number(d.id);
        if (!vistos.has(id)) vistos.set(id, d.name || "");
      }
    }
  }
  return [...vistos.entries()]
    .map(([id, rotulo]) => ({ id, rotulo }))
    .sort((a, b) => String(a.rotulo).localeCompare(String(b.rotulo), "pt-BR"));
}

export function segmentoEhInfantil(nomeSegmento) {
  return /infantil/i.test(String(nomeSegmento || ""));
}

// Resolve o `discipline` a enviar ao listLibraryFilter. No modelo flat/dinamico cada
// componente e o proprio id do AVA (Fundamental = id; Infantil = o campo BNCC, ex. 27),
// entao NAO ha mais mapeamento por tabela. Os casos reais do AVA:
export function resolverDiscipline({
  temSegmento,
  ehInfantil,
  temSerie,
  disciplinaSerieId,
  disciplinaId = DISCIPLINA_MATEMATICA
}) {
  // Serie especifica: o id que a taxonomia capturou para ela (= o proprio componente
  // naquela serie). Fallback = a disciplina escolhida.
  if (temSerie) return disciplinaSerieId || disciplinaId;
  // Infantil fixo + todas as series: unico caso `null` do AVA (o backend resolve o campo
  // de experiencia). Igual para qualquer disciplina.
  if (ehInfantil && temSegmento) return null;
  // Fundamental+Todas e Todos/Todos: a disciplina escolhida.
  return disciplinaId;
}
