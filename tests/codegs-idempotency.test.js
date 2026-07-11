"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function createHarness({ failWelcomeOnce = false } = {}) {
  const properties = new Map([["LEGACY_APPS_SCRIPT_TOKEN", "test-token"]]);
  const rows = [new Array(35).fill("")];
  const sent = [];
  let welcomeFailures = failWelcomeOnce ? 1 : 0;

  function range(row, column, numRows = 1, numColumns = 1) {
    return {
      setValue(value) {
        while (rows.length < row) rows.push(new Array(35).fill(""));
        rows[row - 1][column - 1] = value;
      },
      getValues() {
        return Array.from({ length: numRows }, (_, r) =>
          Array.from({ length: numColumns }, (_, c) => rows[row - 1 + r]?.[column - 1 + c] ?? "")
        );
      },
      setValues(values) {
        values.forEach((valueRow, r) => {
          while (rows.length < row + r) rows.push(new Array(35).fill(""));
          valueRow.forEach((value, c) => { rows[row - 1 + r][column - 1 + c] = value; });
        });
      },
    };
  }

  function fixedRange(row, column, numRows = 1, numColumns = 1) {
    const result = range(row, column, numRows, numColumns);
    result.createTextFinder = (value) => ({
      matchEntireCell() { return this; },
      findNext() {
        for (let r = row - 1; r < row - 1 + numRows; r += 1) {
          if (String(rows[r]?.[column - 1] ?? "") === String(value)) return { getRow: () => r + 1 };
        }
        return null;
      },
    });
    return result;
  }

  const sheet = {
    getName: () => "Inscripción estudiantes",
    getLastRow: () => rows.length,
    getLastColumn: () => 35,
    getMaxColumns: () => 35,
    insertColumnsAfter() {},
    getRange: fixedRange,
    appendRow(row) { rows.push([...row]); },
  };
  const spreadsheet = {
    getSheetByName: () => sheet,
    getSheets: () => [sheet],
  };

  const context = {
    console,
    Date,
    JSON,
    Math,
    Array,
    String,
    Number,
    Object,
    RegExp,
    Error,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => properties.get(key) || null,
        setProperty: (key, value) => properties.set(key, value),
        getProperties: () => Object.fromEntries(properties),
        deleteProperty: (key) => properties.delete(key),
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { openById: () => spreadsheet },
    MailApp: {
      sendEmail(message) {
        if (message.to === "student@example.com" && welcomeFailures > 0) {
          welcomeFailures -= 1;
          throw new Error("welcome unavailable");
        }
        sent.push(message);
      },
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" },
      computeDigest: (_algorithm, value) => [...crypto.createHash("sha256").update(value).digest()],
      base64EncodeWebSafe: (bytes) => Buffer.from(bytes).toString("base64url"),
      formatDate: () => "2026-07-11 15:00:00",
      getUuid: () => crypto.randomUUID(),
    },
    ContentService: {
      MimeType: { JSON: "json" },
      createTextOutput: (value) => ({
        value,
        setMimeType() { return this; },
      }),
    },
    Logger: { log() {} },
    ScriptApp: { getProjectTriggers: () => [] },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, "../Code.gs"), "utf8"), context);

  const payload = {
    studentId: "student-1",
    studentName: "Student Test",
    studentDocument: "CC12345678",
    birthDate: "2000-01-01",
    age: "26",
    studentCity: "Bogotá",
    studentAddress: "Dirección",
    studentEmail: "student@example.com",
    phone: "6011234567",
    mobile: "3001234567",
    course: "Música",
    instrument: "Piano",
    selectedPlan: "Plan",
    modality: "Presencial",
    eps: "EPS",
    rh: "O+",
    guardianName: "Guardian",
    guardianDocument: "CC87654321",
    guardianMobile: "3011234567",
    guardianPhone: "6017654321",
    guardianAddress: "Dirección 2",
    relationship: "Madre",
    healthCondition: "No",
    termsAgreement: "Sí",
    imageUseAuthorization: "Sí",
    imageUseAuthorizationBy: "Estudiante",
  };
  const request = {
    token: "test-token",
    eventType: "student_registration",
    studentId: "student-1",
    idempotencyKey: "student_registration:student-1",
    actions: { syncSheet: true, sendWelcomeEmail: true, sendInternalNotification: true },
    payload,
  };
  function post(body = request) {
    const response = context.doPost({ postData: { contents: JSON.stringify(body) } });
    return JSON.parse(response.value);
  }
  return { post, rows, sent, request };
}

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

test("dos ejecuciones no duplican fila ni correos", () => {
  const harness = createHarness();
  assert.strictEqual(harness.post().ok, true);
  assert.strictEqual(harness.post().ok, true);
  assert.strictEqual(harness.rows.length, 2, "cabecera + una fila");
  assert.strictEqual(harness.sent.length, 2, "un correo interno + una bienvenida");
  assert.strictEqual(harness.rows[1][34], "student-1");
});

test("fallo parcial registra avances y retry ejecuta solo bienvenida faltante", () => {
  const harness = createHarness({ failWelcomeOnce: true });
  const first = harness.post();
  assert.strictEqual(first.ok, false);
  assert.strictEqual(first.sheetSynced, true);
  assert.strictEqual(first.internalNotificationSent, true);
  assert.strictEqual(first.welcomeEmailSent, false);
  const second = harness.post();
  assert.strictEqual(second.ok, true);
  assert.strictEqual(harness.rows.length, 2);
  assert.strictEqual(harness.sent.filter((mail) => mail.to !== "student@example.com").length, 1);
  assert.strictEqual(harness.sent.filter((mail) => mail.to === "student@example.com").length, 1);
});

test("solicitud sin token no procesa datos", () => {
  const harness = createHarness();
  const response = harness.post({ ...harness.request, token: "" });
  assert.strictEqual(response.ok, false);
  assert.strictEqual(response.errorCode, "UNAUTHORIZED_BACKEND");
  assert.strictEqual(harness.rows.length, 1);
  assert.strictEqual(harness.sent.length, 0);
});

console.log(`\n${passed} pruebas OK (Code.gs idempotency)`);
