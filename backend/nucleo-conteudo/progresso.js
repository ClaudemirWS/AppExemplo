export function limitarPercentual(valor) {
  return Math.max(0, Math.min(100, Math.round(Number(valor) || 0)));
}

export function emitirProgresso(onProgresso, percentual, extras = {}) {
  onProgresso?.({
    percentual: limitarPercentual(percentual),
    ...extras
  });
}
