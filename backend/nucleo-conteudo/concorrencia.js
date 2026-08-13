export async function executarComConcorrencia(itens, limite, tarefa) {
  const lista = Array.from(itens || []);
  const quantidadeTrabalhadores = Math.max(1, Math.min(limite, lista.length || 1));
  let indice = 0;

  const trabalhadores = Array.from({ length: quantidadeTrabalhadores }, async () => {
    while (indice < lista.length) {
      const item = lista[indice];
      indice += 1;
      await tarefa(item);
    }
  });

  await Promise.all(trabalhadores);
}
