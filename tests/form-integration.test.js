"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const hosting = fs.readFileSync(path.join(root, "firebase.json"), "utf8");
const codeGs = fs.readFileSync(path.join(root, "Code.gs"), "utf8");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

test("ningún archivo público contiene la URL ni el dominio legado", () => {
  for (const [name, content] of [["app.js", app], ["index.html", html], ["firebase.json", hosting]]) {
    assert.ok(!content.includes("script.google.com"), name);
    assert.ok(!content.includes("APPS_SCRIPT_URL"), name);
    assert.ok(!content.includes("CONFIG.apiUrl"), name);
  }
});

test("el navegador no usa fetch ni llama directamente Apps Script", () => {
  assert.ok(!/\bfetch\s*\(/.test(app));
  assert.ok(!/sendToAppsScript|retryAppsScript|google\.script/.test(app));
});

test("duplicados se consultan con callable Firebase", () => {
  assert.match(html, /firebase-functions-compat\.js/);
  assert.match(app, /httpsCallable\('checkStudentRegistrationDuplicate'\)/);
  assert.match(app, /documentType:\s*safeType/);
  assert.match(app, /documentNumber:\s*safeNumber/);
});

test("indisponibilidad de duplicados permite una decisión controlada", () => {
  assert.match(app, /window\.confirm\(/);
  assert.match(app, /No pudimos verificar si la inscripción ya existe/);
});

test("éxito y limpieza ocurren después de confirmar Firestore sin esperar efectos secundarios", () => {
  const saveIndex = app.indexOf("await saveToFirestore(");
  const successIndex = app.indexOf("successModal.classList.remove('hidden')");
  assert.ok(saveIndex > 0 && successIndex > saveIndex);
  const between = app.slice(saveIndex, successIndex);
  assert.ok(!between.includes("script.google.com"));
  assert.ok(!between.includes("fetch("));
});

test("studentId continúa siendo el ID del documento", () => {
  assert.match(app, /id:\s*db\.collection\('estudiantes'\)\.doc\(\)\.id/);
  assert.match(app, /docData\.studentId\s*=\s*documentId/);
  assert.match(app, /\.doc\(documentId\)/);
});

test("rechazo de términos usa callable y envía únicamente nombre y correo", () => {
  assert.match(app, /httpsCallable\('createTermsRejectedEvent'\)/);
  const start = app.indexOf("await createTermsRejectedEvent({");
  const end = app.indexOf("});", start);
  const call = app.slice(start, end);
  assert.match(call, /email:/);
  assert.match(call, /studentName:/);
  assert.ok(!call.includes("studentDocument"));
  assert.ok(!call.includes("healthCondition"));
});

test("Code.gs exige token, evento e idempotencyKey", () => {
  assert.match(codeGs, /LEGACY_APPS_SCRIPT_TOKEN/);
  assert.match(codeGs, /authorizeBackendRequest_/);
  assert.match(codeGs, /student_registration:/);
  assert.match(codeGs, /upsertStudentRow_/);
  assert.match(codeGs, /welcomeEmailSent/);
  assert.match(codeGs, /internalNotificationSent/);
});

test("Code.gs está excluido de Hosting", () => {
  const config = JSON.parse(hosting);
  assert.ok(config.hosting.ignore.includes("Code.gs"));
});

console.log(`\n${passed} pruebas OK (form integration)`);
