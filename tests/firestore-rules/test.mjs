import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";

const here = path.dirname(fileURLToPath(import.meta.url));
const rules = fs.readFileSync(path.resolve(here, "../../firestore.rules"), "utf8");
const testEnv = await initializeTestEnvironment({
  projectId: "estudiantes-musicala",
  firestore: { rules, host: "127.0.0.1", port: 8092 },
});
const readerEmail = "adminmusicala@gmail.com";
const editorEmail = "alekcaballeromusic@gmail.com";

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

try {
  await test("público no puede escribir integration_jobs", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(db, "integration_jobs", "S1"), { status: "completed" }));
  });

  await test("staff puede leer integration_jobs escrito por Admin SDK", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "integration_jobs", "S1"), { status: "completed" });
    });
    const db = testEnv.authenticatedContext("reader", { email: readerEmail }).firestore();
    await assertSucceeds(getDoc(doc(db, "integration_jobs", "S1")));
  });

  await test("staff tampoco escribe integration_jobs desde cliente", async () => {
    const db = testEnv.authenticatedContext("reader", { email: readerEmail }).firestore();
    await assertFails(setDoc(doc(db, "integration_jobs", "S2"), { status: "failed" }));
  });

  await test("registration_events no admite creación pública", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(db, "registration_events", "E1"), {
      type: "terms_rejected", email: "a@example.com", studentName: "Ana",
    }));
  });

  await test("registration_events no admite lectura pública ni de staff", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "registration_events", "E1"), { type: "terms_rejected" });
    });
    const publicDb = testEnv.unauthenticatedContext().firestore();
    const staffDb = testEnv.authenticatedContext("reader", { email: readerEmail }).firestore();
    await assertFails(getDoc(doc(publicDb, "registration_events", "E1")));
    await assertFails(getDoc(doc(staffDb, "registration_events", "E1")));
  });

  await test("contadores de límite no son accesibles por clientes", async () => {
    const db = testEnv.authenticatedContext("reader", { email: readerEmail }).firestore();
    await assertFails(setDoc(doc(db, "registration_rate_limits", "R1"), { count: 1 }));
    await assertFails(getDoc(doc(db, "registration_rate_limits", "R1")));
  });

  await test("otras colecciones permanecen cerradas, incluso para editor", async () => {
    const db = testEnv.authenticatedContext("editor", { email: editorEmail }).firestore();
    await assertFails(setDoc(doc(db, "catalogos", "general"), { active: true }));
    await assertFails(getDoc(doc(db, "catalogos", "general")));
  });

  await test("regla existente de estudiantes conserva creación pública con studentId igual a doc.id", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(setDoc(doc(db, "estudiantes", "S-CANONICO"), {
      studentId: "S-CANONICO",
      schemaVersion: 2,
      studentName: "Estudiante Prueba",
    }));
  });

  console.log(`\n${passed} pruebas OK (formulario rules)`);
} finally {
  await testEnv.cleanup();
}
