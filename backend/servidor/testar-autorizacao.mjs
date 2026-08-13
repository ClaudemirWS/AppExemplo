// Testa o gate de acesso do downloader: so Administrador Educandus (role_id 1) entra.
// Sem framework (o downloader nao tem test runner) — node:assert puro.
//
// Uso: node servidor/testar-autorizacao.mjs
import assert from "node:assert/strict";
import { ehAdminEducandus, ROLE_ADMIN_EDUCANDUS } from "./autorizacao.js";

let passou = 0;
function teste(nome, fn) {
  fn();
  passou += 1;
  console.log(`  ok  ${nome}`);
}

assert.equal(ROLE_ADMIN_EDUCANDUS, 1, "admin Educandus e role_id 1 (SPEC 24.5)");

teste("admin (role_id 1) entra", () => {
  assert.equal(ehAdminEducandus([{ role_id: 1, role_name: "Administrador" }]), true);
});

teste("aluno (role_id 7) NAO entra — caso da conta de teste real", () => {
  assert.equal(ehAdminEducandus([{ role_id: 7, role_name: "Estudante" }]), false);
});

teste("professor/outro papel NAO entra", () => {
  assert.equal(ehAdminEducandus([{ role_id: 3, role_name: "Professor" }]), false);
});

teste("admin entre varios papeis entra (basta um)", () => {
  assert.equal(
    ehAdminEducandus([
      { role_id: 7, role_name: "Estudante" },
      { role_id: 1, role_name: "Administrador" }
    ]),
    true
  );
});

teste("role_id como STRING '1' entra (API pode mandar texto)", () => {
  assert.equal(ehAdminEducandus([{ role_id: "1", role_name: "Administrador" }]), true);
});

teste("sem papeis NAO entra", () => {
  assert.equal(ehAdminEducandus([]), false);
});

teste("papeis ausente/invalido NAO entra (nao quebra)", () => {
  assert.equal(ehAdminEducandus(undefined), false);
  assert.equal(ehAdminEducandus(null), false);
  assert.equal(ehAdminEducandus("1"), false);
});

teste("role_name 'Administrador' com role_id != 1 NAO entra (casa por id, nao nome)", () => {
  // Guarda a decisao: mesmo com o nome sugestivo, e o id numerico que decide.
  assert.equal(ehAdminEducandus([{ role_id: 9, role_name: "Administrador" }]), false);
});

console.log(`\n${passou} testes ok.`);
