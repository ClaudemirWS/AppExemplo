// Quem pode usar o downloader. O acervo e ferramenta INTERNA da Educandus: o AVA
// autentica professor/aluno tambem, mas so o Administrador Educandus (role_id 1)
// passa daqui. Isolado do index.js para poder ser testado sem subir o servidor
// (o index.js chama app.listen no topo do modulo).

// role_id 1 = Administrador Educandus (type "G", sem escopo de grupo — ve o acervo
// inteiro). Ver SPEC 24.5. Casamos por role_id NUMERICO, nao role_name: o id e
// estavel, o nome varia — mesma licao da homonimia de aulas (casar por id, nao nome).
export const ROLE_ADMIN_EDUCANDUS = 1;

// `papeis` = o `user_role` da resposta do login do AVA (array de { role_id, role_name }).
// Basta UM papel de admin. Tolerante a formato: aceita role_id numerico ou string,
// e a ausencia/forma invalida de `papeis` vira `false` (nao admin).
export function ehAdminEducandus(papeis) {
  return (Array.isArray(papeis) ? papeis : []).some(
    papel => Number(papel?.role_id) === ROLE_ADMIN_EDUCANDUS
  );
}
