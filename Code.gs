const CONFIG = {
  SHEET_ID: '1MsWABlj_LdhWKzVq_u-1M6S5zEJ2yQ72oiusvzzQZAI',
  SHEET_NAME: 'Inscripci\u00f3n estudiantes',
  DRIVE_FOLDER_ID: '1X4lJi2nTVguuJCJqWTGSJ2LNkrExBbK1',
  ALERT_EMAIL: 'musicalaasesor@gmail.com',
  NOTIFICATION_EMAIL: 'notificaciones.musicala@gmail.com',
  EMAIL_COLUMN_INDEX: 8,
  MAX_IMAGE_SIZE_MB: 3,
  ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
  TIMEZONE: 'America/Bogota',
  TERMS_URL: 'https://musicala.github.io/terminosycondiciones/'
};

const HEADERS = [
  'Estudiantes',
  'Estado',
  'No. de documento (estudiante)',
  'Fecha de nacimiento (estudiante)',
  'Edad',
  'Localidad/Municipio de residencia (estudiante)',
  'DirecciÃ³n de residencia (estudiante)',
  'Correo electrÃ³nico (envÃ­o de guÃ­as e informaciÃ³n adicional)',
  'Sube una foto del estudiante para continuar el proceso de registro en nuestro sistema',
  'TelÃ©fono fijo',
  'Celular',
  'Curso',
  'Instrumento',
  'Estilo',
  'Ã‰nfasis',
  'Intereses musicales  del estudiante Ej: GÃ©neros, cantantes, interpretes',
  'Plan seleccionado',
  'Modalidad',
  'EPS',
  'RH',
  'Nombre completo (acudiente)',
  'NÃºmero de identificaciÃ³n (acudiente)',
  'Celular (acudiente)',
  'TelÃ©fono fijo (acudiente)',
  'DirecciÃ³n (acudiente)',
  'Parentesco',
  'Nombre (referido)',
  'Celular (referido)',
  'Marca temporal',
  'Â¿EstÃ¡s de acuerdo con los tÃ©rminos y condiciones de Musicala?',
  'Â¿Por quÃ© no estÃ¡s de acuerdo con los tÃ©rminos y condiciones actuales?',
  'Â¿Autoriza a Musicala para tomar fotos y videos del estudiante y compartirlos en redes sociales y YouTube?',
  'Â¿QuiÃ©n otorga la autorizaciÃ³n de uso de imagen?',
  'Presentas alguna condiciÃ³n y/o enfermedad que consideres relevante para tus clases',
  'studentId'
];

const EMAIL_QUEUE_PREFIX = 'emailQueue:';
const EMAIL_QUEUE_TRIGGER_FN = 'processEmailQueue_';

function doGet(e) {
  return jsonResponse_({ ok: false, errorCode: 'METHOD_NOT_ALLOWED' });
}

function doOptions() {
  return jsonResponse_({ ok: false, errorCode: 'METHOD_NOT_ALLOWED' });
}

function doPost(e) {
  try {
    assertConfig_();

    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('No se recibiÃ³ informaciÃ³n para procesar la inscripciÃ³n.');
    }

    const request = JSON.parse(e.postData.contents);
    authorizeBackendRequest_(request);

    if (request.eventType === 'student_registration') {
      return jsonResponse_(processStudentRegistrationRequest_(request));
    }
    if (request.eventType === 'terms_rejected') {
      return jsonResponse_(processTermsRejectedRequest_(request));
    }
    return jsonResponse_({ ok: false, errorCode: 'UNSUPPORTED_EVENT_TYPE' });
  } catch (error) {
    return jsonResponse_({
      ok: false,
      errorCode: safeErrorCode_(error),
      message: 'No fue posible procesar la solicitud auxiliar.'
    });
  }
}

function authorizeBackendRequest_(request) {
  const expected = PropertiesService.getScriptProperties().getProperty('LEGACY_APPS_SCRIPT_TOKEN');
  if (!expected || !request || !secureEquals_(request.token, expected)) {
    throw new Error('UNAUTHORIZED_BACKEND');
  }
  if (['student_registration', 'terms_rejected'].indexOf(String(request.eventType || '')) === -1) {
    throw new Error('UNSUPPORTED_EVENT_TYPE');
  }
}

function secureEquals_(provided, expected) {
  const a = String(provided || '');
  const b = String(expected || '');
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    diff |= (a.charCodeAt(i % Math.max(1, a.length)) || 0) ^
      (b.charCodeAt(i % Math.max(1, b.length)) || 0);
  }
  return diff === 0;
}

function processStudentRegistrationRequest_(request) {
  const studentId = String(request.studentId || '').trim();
  const idempotencyKey = String(request.idempotencyKey || '').trim();
  const payload = request.payload || {};
  if (!studentId || idempotencyKey !== 'student_registration:' + studentId) {
    throw new Error('INVALID_IDEMPOTENCY_KEY');
  }
  if (String(payload.studentId || '') !== studentId) {
    throw new Error('INVALID_STUDENT_ID');
  }
  validatePayload_(payload);

  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const state = getIdempotencyState_(idempotencyKey, studentId);
    const actions = request.actions || {};
    const errors = [];
    let sheet = null;
    let savedRow = Number(state.savedRow || 0);

    // La Function conserva también el estado en integration_jobs. Si una
    // tarea llega marcada como no requerida, se considera ya confirmada.
    if (actions.syncSheet === false) state.sheetSynced = true;
    if (actions.sendWelcomeEmail === false) state.welcomeEmailSent = true;
    if (actions.sendInternalNotification === false) state.internalNotificationSent = true;

    if (actions.syncSheet !== false && !state.sheetSynced) {
      try {
        sheet = getSheet_();
        ensureHeaders_(sheet);
        savedRow = upsertStudentRow_(sheet, payload, studentId);
        state.sheetSynced = true;
        state.savedRow = savedRow;
        state.sheetName = sheet.getName();
        saveIdempotencyState_(idempotencyKey, state);
      } catch (error) {
        errors.push(safeErrorCode_(error));
      }
    }

    if (!sheet && (state.sheetName || state.savedRow)) {
      sheet = getSheet_();
    }

    if (actions.sendInternalNotification !== false && !state.internalNotificationSent && state.sheetSynced) {
      const result = notifyAdvisor_(payload, state.sheetName || sheet.getName(), savedRow || state.savedRow);
      if (result && result.ok) {
        state.internalNotificationSent = true;
        saveIdempotencyState_(idempotencyKey, state);
      } else {
        errors.push('INTERNAL_NOTIFICATION_FAILED');
      }
    }

    if (actions.sendWelcomeEmail !== false && !state.welcomeEmailSent && state.sheetSynced) {
      const result = sendWelcomeEmail_(payload);
      if (result && result.ok) {
        state.welcomeEmailSent = true;
        saveIdempotencyState_(idempotencyKey, state);
      } else {
        errors.push('WELCOME_EMAIL_FAILED');
      }
    }

    const complete = state.sheetSynced && state.welcomeEmailSent && state.internalNotificationSent;
    return {
      ok: complete,
      errorCode: complete ? '' : (errors[0] || 'PARTIAL_RESULT'),
      studentId: studentId,
      sheetSynced: state.sheetSynced === true,
      welcomeEmailSent: state.welcomeEmailSent === true,
      internalNotificationSent: state.internalNotificationSent === true
    };
  } finally {
    lock.releaseLock();
  }
}

function processTermsRejectedRequest_(request) {
  const idempotencyKey = String(request.idempotencyKey || '').trim();
  const payload = request.payload || {};
  if (idempotencyKey.indexOf('terms_rejected:') !== 0) throw new Error('INVALID_IDEMPOTENCY_KEY');
  payload.studentName = String(payload.studentName || '').trim().slice(0, 160);
  payload.studentEmail = normalizeEmail_(payload.email || payload.studentEmail);
  payload.termsAgreement = 'No';
  payload.termsReason = '';
  if (!payload.studentName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.studentEmail)) {
    throw new Error('INVALID_TERMS_EVENT');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const state = getIdempotencyState_(idempotencyKey, '');
    if (!state.termsNotificationSent) {
      const result = notifyTermsDisagreement_(payload);
      if (!result || !result.ok) {
        return { ok: false, errorCode: 'TERMS_NOTIFICATION_FAILED', termsNotificationSent: false };
      }
      state.termsNotificationSent = true;
      saveIdempotencyState_(idempotencyKey, state);
    }
    return { ok: true, termsNotificationSent: true };
  } finally {
    lock.releaseLock();
  }
}

function idempotencyPropertyKey_(idempotencyKey) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idempotencyKey);
  return 'legacyIntegration:' + Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, '');
}

function getIdempotencyState_(idempotencyKey, studentId) {
  const raw = PropertiesService.getScriptProperties().getProperty(idempotencyPropertyKey_(idempotencyKey));
  if (!raw) {
    return {
      studentId: studentId || '',
      sheetSynced: false,
      welcomeEmailSent: false,
      internalNotificationSent: false,
      termsNotificationSent: false
    };
  }
  const state = JSON.parse(raw);
  if (studentId && state.studentId && state.studentId !== studentId) throw new Error('IDEMPOTENCY_CONFLICT');
  return state;
}

function saveIdempotencyState_(idempotencyKey, state) {
  state.updatedAt = new Date().toISOString();
  PropertiesService.getScriptProperties().setProperty(
    idempotencyPropertyKey_(idempotencyKey),
    JSON.stringify(state)
  );
}

function safeErrorCode_(error) {
  return String(error && error.message ? error.message : error || 'UNKNOWN_ERROR')
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .slice(0, 100);
}

function validatePayload_(payload) {
  const requiredFields = [
    'studentName',
    'studentDocument',
    'birthDate',
    'studentCity',
    'studentAddress',
    'studentEmail',
    'phone',
    'mobile',
    'course',
    'selectedPlan',
    'modality',
    'eps',
    'rh',
    'guardianName',
    'guardianMobile',
    'guardianPhone',
    'guardianAddress',
    'relationship',
    'healthCondition',
    'termsAgreement',
    'imageUseAuthorization',
    'imageUseAuthorizationBy'
  ];

  requiredFields.forEach(function (key) {
    if (!String(payload[key] || '').trim()) {
      throw new Error('Por favor completa todos los campos obligatorios del formulario.');
    }
  });

  const email = normalizeEmail_(payload.studentEmail);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('El correo electrÃ³nico no es vÃ¡lido.');
  }

  const birth = new Date(String(payload.birthDate || '') + 'T00:00:00');
  const today = new Date();
  if (isNaN(birth.getTime()) || birth > today) {
    throw new Error('La fecha de nacimiento no es válida.');
  }
  var age = today.getFullYear() - birth.getFullYear();
  var monthDifference = today.getMonth() - birth.getMonth();
  if (monthDifference < 0 || (monthDifference === 0 && today.getDate() < birth.getDate())) age--;
  var isMinor = age < 18;

  if (normalizeText_(payload.course) === 'musica' && !String(payload.instrument || '').trim()) {
    throw new Error('Selecciona al menos un instrumento.');
  }

  if ((payload.course === 'Baile' || payload.course === 'Teatro') && !String(payload.style || '').trim()) {
    throw new Error(payload.course === 'Teatro' ? 'Selecciona al menos un área teatral.' : 'Selecciona al menos un estilo.');
  }

  if (payload.course === 'Artes manuales' && !String(payload.emphasis || '').trim()) {
    throw new Error('Selecciona al menos un Ã©nfasis.');
  }

  if (payload.termsAgreement === 'No' && !String(payload.termsReason || '').trim()) {
    throw new Error('CuÃ©ntanos por quÃ© no estÃ¡s de acuerdo con los tÃ©rminos y condiciones actuales.');
  }

  if (!/^(?:(?:RC|PAS)[A-Za-z0-9-]+|(?:CC|TI|CE|PPT)\d+)$/.test(String(payload.studentDocument || '').trim())) {
    throw new Error('El documento del estudiante no es válido. Debe incluir tipo y número, por ejemplo CC10036442.');
  }
  if (isMinor && !/^(?:(?:RC|PAS)[A-Za-z0-9-]+|(?:CC|TI|CE|PPT)\d+)$/.test(String(payload.guardianDocument || '').trim())) {
    throw new Error('El documento del acudiente no es válido. Debe incluir tipo y número, por ejemplo CC10036442.');
  }
  if (!isMinor && String(payload.guardianDocument || '').trim() &&
      !/^(?:(?:RC|PAS)[A-Za-z0-9-]+|(?:CC|TI|CE|PPT)\d+)$/.test(String(payload.guardianDocument).trim())) {
    throw new Error('El documento del acudiente no es válido.');
  }
  if (isMinor && !/^Acudiente:\s*.+\s+—\s+.+$/.test(String(payload.imageUseAuthorizationBy || '').trim())) {
    throw new Error('Para menores de edad, la autorización de uso de imagen debe otorgarla el acudiente.');
  }
  if (String(payload.imageUseAuthorizationBy || '').indexOf('Acudiente:') === 0 &&
      !/^Acudiente:\s*.+\s+—\s+(?:(?:RC|PAS)[A-Za-z0-9-]+|(?:CC|TI|CE|PPT)\d+)$/.test(String(payload.imageUseAuthorizationBy).trim())) {
    throw new Error('Completa el nombre y un documento válido del acudiente que autoriza el uso de imagen.');
  }

  validatePhoneServer_(payload.phone, 'Teléfono fijo');
  validateMobileServer_(payload.mobile, 'Celular');
  validatePhoneServer_(payload.guardianPhone, 'Teléfono fijo (acudiente)');
  validateMobileServer_(payload.guardianMobile, 'Celular (acudiente)');
  if (String(payload.mobile || '').replace(/\s+/g, '') === String(payload.guardianMobile || '').replace(/\s+/g, '')) {
    throw new Error('El celular del acudiente debe ser diferente al celular del estudiante.');
  }
}

function getSheet_() {
  const spreadsheet = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  let sheet = spreadsheet.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    const target = String(CONFIG.SHEET_NAME || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
    sheet = spreadsheet.getSheets().find(function (s) {
      const normalized = String(s.getName() || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
      return normalized === target;
    }) || null;
  }

  if (!sheet) {
    const available = spreadsheet.getSheets().map(function (s) { return s.getName(); }).join(', ');
    throw new Error('No se encontrÃ³ la pestaÃ±a "' + CONFIG.SHEET_NAME + '". PestaÃ±as disponibles: ' + available);
  }

  return sheet;
}

function ensureHeaders_(sheet) {
  if (sheet.getMaxColumns() < HEADERS.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), HEADERS.length - sheet.getMaxColumns());
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    return;
  }

  const newHeaderIndexes = [31, 32, 33, 34];
  newHeaderIndexes.forEach(function (index) {
    const cell = sheet.getRange(1, index + 1);
    cell.setValue(HEADERS[index]);
  });
}

function emailAlreadyExists_(sheet, email) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;

  const emailColumnIndex = Number(CONFIG.EMAIL_COLUMN_INDEX || 8);
  if (emailColumnIndex < 1 || emailColumnIndex > sheet.getLastColumn()) {
    throw new Error('La columna configurada para correo no es vÃ¡lida.');
  }

  const range = sheet.getRange(2, emailColumnIndex, lastRow - 1, 1);
  const found = range.createTextFinder(email).matchEntireCell(true).findNext();
  return !!found;
}

function savePhoto_(photo, studentName) {
  const folder = DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);
  const bytes = Utilities.base64Decode(photo.base64);
  const extension = getSafeExtension_(photo.name, photo.mimeType);
  const cleanName = sanitizeFileName_(studentName || 'estudiante');
  const timestamp = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyyMMdd-HHmmss');
  const fileName = cleanName + '-' + timestamp + '.' + extension;
  const blob = Utilities.newBlob(bytes, photo.mimeType, fileName);
  const file = folder.createFile(blob);

  return {
    id: file.getId(),
    url: file.getUrl(),
    name: file.getName()
  };
}

function buildRow_(payload) {
  const now = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  const row = new Array(35).fill('');

  // A: Nombre estudiante
  row[0] = payload.studentName || '';
  // B: Estado (fórmula en hoja) -> vacío
  row[1] = '';
  // C-D-E
  row[2] = payload.studentDocument || '';
  row[3] = payload.birthDate || '';
  // E: Edad (fórmula en hoja) -> vacío
  row[4] = '';
  // F-I
  row[5] = payload.studentCity || '';
  row[6] = payload.studentAddress || '';
  row[7] = normalizeEmail_(payload.studentEmail || '');
  row[8] = '';
  // J-Z
  row[9] = payload.phone || '';
  row[10] = payload.mobile || '';
  row[11] = payload.course || '';
  row[12] = payload.instrument || '';
  row[13] = payload.style || '';
  row[14] = payload.emphasis || '';
  row[15] = payload.interests || '';
  row[16] = payload.selectedPlan || '';
  row[17] = payload.modality || '';
  row[18] = payload.eps || '';
  row[19] = payload.rh || '';
  row[20] = payload.guardianName || '';
  row[21] = payload.guardianDocument || '';
  row[22] = payload.guardianMobile || '';
  row[23] = payload.guardianPhone || '';
  row[24] = payload.guardianAddress || '';
  row[25] = payload.relationship || '';
  // AA-AB: Referidos (si están vacíos, se mantienen las columnas)
  row[26] = payload.referredName || '';
  row[27] = payload.referredMobile || '';
  // AC-AE
  row[28] = now;
  row[29] = payload.termsAgreement || '';
  row[30] = payload.termsReason || '';
  // AF-AG: autorización de uso de imagen
  row[31] = payload.imageUseAuthorization || '';
  row[32] = payload.imageUseAuthorizationBy || '';
  // AH: condición de salud
  row[33] = payload.healthCondition || '';
  // AI: llave canónica para upsert e idempotencia
  row[34] = payload.studentId || '';

  return row;
}

function upsertStudentRow_(sheet, payload, studentId) {
  if (!studentId) throw new Error('MISSING_STUDENT_ID');
  const row = buildRow_(payload);
  const studentIdColumn = 35;
  let targetRow = 0;
  if (sheet.getLastRow() >= 2) {
    const found = sheet
      .getRange(2, studentIdColumn, sheet.getLastRow() - 1, 1)
      .createTextFinder(studentId)
      .matchEntireCell(true)
      .findNext();
    if (found) targetRow = found.getRow();
  }

  if (!targetRow) {
    sheet.appendRow(row);
    return sheet.getLastRow();
  }

  // Estado y edad pueden contener fórmulas administrativas: se preservan.
  const existing = sheet.getRange(targetRow, 1, 1, row.length).getValues()[0];
  row[1] = existing[1];
  row[4] = existing[4];
  sheet.getRange(targetRow, 1, 1, row.length).setValues([row]);
  return targetRow;
}

function normalizeEmail_(email) {
  return String(email || '').trim().toLowerCase();
}


function notifyAdvisor_(payload, sheetName, rowNumber) {
  try {
    const name = String(payload.studentName || 'Sin nombre').trim();
    const recipient = normalizeEmail_(payload.studentEmail || '');
    const subject = 'Inscripción realizada: ' + name;
    const details = [
      ['Estudiante', name],
      ['Documento', payload.studentDocument],
      ['Fecha de nacimiento', payload.birthDate],
      ['Edad', payload.age],
      ['Localidad/Municipio', payload.studentCity],
      ['Dirección estudiante', payload.studentAddress],
      ['Correo', recipient],
      ['Teléfono fijo', payload.phone],
      ['Celular', payload.mobile],
      ['Curso', payload.course],
      ['Instrumento', payload.instrument],
      ['Estilo', payload.style],
      ['Énfasis', payload.emphasis],
      ['Intereses', payload.interests],
      ['Plan seleccionado', payload.selectedPlan],
      ['Modalidad', payload.modality],
      ['EPS', payload.eps],
      ['RH', payload.rh],
      ['Acudiente', payload.guardianName],
      ['Documento del acudiente', payload.guardianDocument],
      ['Celular acudiente', payload.guardianMobile],
      ['Teléfono acudiente', payload.guardianPhone],
      ['Dirección acudiente', payload.guardianAddress],
      ['Parentesco', payload.relationship],
      ['Referido', payload.referredName],
      ['Celular referido', payload.referredMobile],
      ['Aceptó términos', payload.termsAgreement],
      ['Autorización de uso de imagen', payload.imageUseAuthorization],
      ['Quién autoriza el uso de imagen', payload.imageUseAuthorizationBy],
      ['Condición relevante para las clases', payload.healthCondition],
      ['Hoja', sheetName],
      ['Fila', rowNumber],
      ['Fecha de registro', Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss')]
    ].filter(function (item) {
      return String(item[1] || '').trim() !== '';
    });

    const textDetails = details.map(function (item) {
      return item[0] + ': ' + item[1];
    }).join('\n');

    const body = [
      'Se registró una nueva inscripción en Musicala.',
      '',
      'Resumen rápido del formulario:',
      textDetails
    ].join('\n');

    const htmlRows = details.map(function (item) {
      return '<tr>' +
        '<td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600;vertical-align:top;">' + escapeHtml_(item[0]) + '</td>' +
        '<td style="padding:8px 12px;border-bottom:1px solid #eee;">' + escapeHtml_(item[1]) + '</td>' +
        '</tr>';
    }).join('');

    const htmlBody =
      '<div style="font-family:Arial,sans-serif;color:#24213d;line-height:1.5;max-width:760px;margin:auto;">' +
        '<div style="background:linear-gradient(90deg,#704cff,#f33ea6);padding:24px;border-radius:16px 16px 0 0;color:#fff;">' +
          '<h1 style="margin:0;font-size:24px;">Nueva inscripción Musicala</h1>' +
          '<p style="margin:8px 0 0;">Resumen rápido del formulario recibido.</p>' +
        '</div>' +
        '<div style="padding:24px;border:1px solid #e9e1ff;border-top:0;border-radius:0 0 16px 16px;">' +
          '<p>Se registró una nueva inscripción de <strong>' + escapeHtml_(name) + '</strong>.</p>' +
          '<table style="width:100%;border-collapse:collapse;margin:20px 0;">' + htmlRows + '</table>' +
        '</div>' +
      '</div>';

    MailApp.sendEmail({
      to: CONFIG.ALERT_EMAIL,
      cc: CONFIG.NOTIFICATION_EMAIL,
      subject: subject,
      body: body,
      htmlBody: htmlBody,
      name: 'Musicala'
    });
    return { ok: true };
  } catch (error) {
    const msg = error && error.message ? error.message : 'No se pudo enviar el correo de notificación.';
    Logger.log('notifyAdvisor_ error: ' + msg);
    return { ok: false, error: msg };
  }
}

function enqueueEmailJob_(job) {
  try {
    const props = PropertiesService.getScriptProperties();
    const key = EMAIL_QUEUE_PREFIX + Utilities.getUuid();
    props.setProperty(key, JSON.stringify({
      createdAt: new Date().toISOString(),
      attempts: 0,
      job: job
    }));
    ensureEmailQueueTrigger_();
    return { ok: true };
  } catch (error) {
    const msg = error && error.message ? error.message : 'No fue posible programar los correos.';
    Logger.log('enqueueEmailJob_ error: ' + msg);
    return { ok: false, error: msg };
  }
}

function ensureEmailQueueTrigger_() {
  const triggers = ScriptApp.getProjectTriggers();
  const alreadyScheduled = triggers.some(function (trigger) {
    return trigger.getHandlerFunction && trigger.getHandlerFunction() === EMAIL_QUEUE_TRIGGER_FN;
  });
  if (!alreadyScheduled) {
    ScriptApp.newTrigger(EMAIL_QUEUE_TRIGGER_FN)
      .timeBased()
      .after(1)
      .create();
  }
}

function processEmailQueue_() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  const keys = Object.keys(all).filter(function (key) {
    return key.indexOf(EMAIL_QUEUE_PREFIX) === 0;
  });

  keys.slice(0, 20).forEach(function (key) {
    try {
      const item = JSON.parse(all[key]);
      const job = item.job || {};

      if (job.type === 'registrationEmails') {
        const notify = notifyAdvisor_(job.payload, job.sheetName, job.savedRow);
        if (!notify || !notify.ok) throw new Error(notify && notify.error ? notify.error : 'Falló el correo interno.');
        const welcome = sendWelcomeEmail_(job.payload);
        if (!welcome || !welcome.ok) throw new Error(welcome && welcome.error ? welcome.error : 'Falló el correo de bienvenida.');
      } else if (job.type === 'termsDisagreement') {
        const rejection = notifyTermsDisagreement_(job.payload);
        if (!rejection || !rejection.ok) throw new Error(rejection && rejection.error ? rejection.error : 'Falló el aviso de desacuerdo.');
      }

      props.deleteProperty(key);
    } catch (error) {
      const item = safelyParseQueueItem_(all[key]);
      item.attempts = Number(item.attempts || 0) + 1;
      item.lastError = error && error.message ? error.message : String(error);
      item.lastAttemptAt = new Date().toISOString();

      if (item.attempts >= 3) {
        Logger.log('Email queue failed permanently for ' + key + ': ' + item.lastError);
        props.deleteProperty(key);
      } else {
        props.setProperty(key, JSON.stringify(item));
      }
    }
  });

  cleanupEmailQueueTriggers_();

  if (Object.keys(props.getProperties()).some(function (key) { return key.indexOf(EMAIL_QUEUE_PREFIX) === 0; })) {
    ensureEmailQueueTrigger_();
  }
}

function safelyParseQueueItem_(value) {
  try {
    return JSON.parse(value || '{}');
  } catch (_error) {
    return { createdAt: new Date().toISOString(), attempts: 0, job: {} };
  }
}

function cleanupEmailQueueTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction && trigger.getHandlerFunction() === EMAIL_QUEUE_TRIGGER_FN) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function notifyTermsDisagreement_(payload) {
  try {
    const name = String(payload.studentName || 'Sin nombre').trim();
    const email = normalizeEmail_(payload.studentEmail || '');
    // El evento Firebase conserva solo nombre y correo por minimización.
    const reason = String(payload.termsReason || '').trim() || 'No recopilado en el evento mínimo.';

    const subject = 'No aceptó términos y condiciones: ' + name;
    const fields = [
      ['Estudiante', name],
      ['Documento estudiante', payload.studentDocument],
      ['Fecha de nacimiento', payload.birthDate],
      ['Edad', payload.age],
      ['Localidad/Municipio', payload.studentCity],
      ['Dirección estudiante', payload.studentAddress],
      ['Correo', email],
      ['Teléfono fijo', payload.phone],
      ['Celular', payload.mobile],
      ['Curso', payload.course],
      ['Instrumento', payload.instrument],
      ['Estilo', payload.style],
      ['Énfasis', payload.emphasis],
      ['Intereses', payload.interests],
      ['Plan seleccionado', payload.selectedPlan],
      ['Modalidad', payload.modality],
      ['EPS', payload.eps],
      ['RH', payload.rh],
      ['Acudiente', payload.guardianName],
      ['Documento del acudiente', payload.guardianDocument],
      ['Celular acudiente', payload.guardianMobile],
      ['Teléfono acudiente', payload.guardianPhone],
      ['Dirección acudiente', payload.guardianAddress],
      ['Parentesco', payload.relationship],
      ['Condición relevante para las clases', payload.healthCondition],
      ['Autorización de uso de imagen', payload.imageUseAuthorization],
      ['Quién autoriza el uso de imagen', payload.imageUseAuthorizationBy],
      ['Referido', payload.referredName],
      ['Celular referido', payload.referredMobile],
      ['Motivo del desacuerdo', reason],
      ['Fecha', Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss')]
    ].filter(function (item) {
      return String(item[1] || '').trim() !== '';
    });

    const body = [
      'Una persona intentó iniciar la inscripción, pero NO aceptó los términos y condiciones.',
      'La inscripción fue bloqueada y no se guardó como registro confirmado.',
      '',
      fields.map(function (item) { return item[0] + ': ' + item[1]; }).join('\n')
    ].join('\n');

    const htmlRows = fields.map(function (item) {
      return '<tr>' +
        '<td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600;vertical-align:top;">' + escapeHtml_(item[0]) + '</td>' +
        '<td style="padding:8px 12px;border-bottom:1px solid #eee;">' + escapeHtml_(item[1]) + '</td>' +
        '</tr>';
    }).join('');

    const htmlBody =
      '<div style="font-family:Arial,sans-serif;color:#24213d;line-height:1.5;max-width:680px;margin:auto;">' +
        '<div style="background:#fff4f6;border:1px solid #ffd6df;border-radius:16px;padding:22px;">' +
          '<h2 style="margin:0 0 8px;color:#ab3440;">No aceptó términos y condiciones</h2>' +
          '<p style="margin:0 0 16px;">La inscripción fue bloqueada porque Musicala requiere la aceptación de las reglas para continuar.</p>' +
          '<table style="width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;">' + htmlRows + '</table>' +
        '</div>' +
      '</div>';

    MailApp.sendEmail({
      to: CONFIG.ALERT_EMAIL,
      cc: CONFIG.NOTIFICATION_EMAIL,
      subject: subject,
      body: body,
      htmlBody: htmlBody,
      name: 'Musicala'
    });
    return { ok: true };
  } catch (error) {
    const msg = error && error.message ? error.message : 'No se pudo enviar el aviso de desacuerdo con términos.';
    Logger.log('notifyTermsDisagreement_ error: ' + msg);
    return { ok: false, error: msg };
  }
}

function sendWelcomeEmail_(payload) {
  try {
    const recipient = normalizeEmail_(payload.studentEmail || '');
    const studentName = String(payload.studentName || 'estudiante').trim();
    const subject = '¡Bienvenido(a) a Musicala! Confirmación de tu inscripción';
    const details = [
      ['Estudiante', studentName],
      ['Documento', payload.studentDocument],
      ['Fecha de nacimiento', payload.birthDate],
      ['Correo', recipient],
      ['Celular', payload.mobile],
      ['Curso', payload.course],
      ['Plan seleccionado', payload.selectedPlan],
      ['Modalidad', payload.modality],
      ['Acudiente', payload.guardianName],
      ['Documento del acudiente', payload.guardianDocument],
      ['Autorización de uso de imagen', payload.imageUseAuthorization],
      ['Quién autoriza el uso de imagen', payload.imageUseAuthorizationBy],
      ['Condición relevante para las clases', payload.healthCondition]
    ].filter(function (item) {
      return String(item[1] || '').trim() !== '';
    });

    const textDetails = details.map(function (item) {
      return item[0] + ': ' + item[1];
    }).join('\n');
    const body = [
      '¡Hola, ' + studentName + '!',
      '',
      'Te damos la bienvenida a Musicala. Tu inscripción fue recibida correctamente.',
      '',
      'Estos son los datos registrados:',
      textDetails,
      '',
      'Puedes consultar los términos y condiciones completos aquí:',
      CONFIG.TERMS_URL,
      '',
      'Si encuentras algún dato que debamos corregir, comunícate con nuestro equipo.',
      '',
      'Musicala — vida, alma y artes'
    ].join('\n');

    const htmlRows = details.map(function (item) {
      return '<tr>' +
        '<td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600;vertical-align:top;">' + escapeHtml_(item[0]) + '</td>' +
        '<td style="padding:8px 12px;border-bottom:1px solid #eee;">' + escapeHtml_(item[1]) + '</td>' +
        '</tr>';
    }).join('');
    const htmlBody =
      '<div style="font-family:Arial,sans-serif;color:#24213d;line-height:1.5;max-width:680px;margin:auto;">' +
        '<div style="background:linear-gradient(90deg,#704cff,#f33ea6);padding:24px;border-radius:16px 16px 0 0;color:#fff;">' +
          '<h1 style="margin:0;font-size:26px;">¡Bienvenido(a) a Musicala!</h1>' +
        '</div>' +
        '<div style="padding:24px;border:1px solid #e9e1ff;border-top:0;border-radius:0 0 16px 16px;">' +
          '<p>Hola, <strong>' + escapeHtml_(studentName) + '</strong>.</p>' +
          '<p>Tu inscripción fue recibida correctamente. Estos son los datos registrados:</p>' +
          '<table style="width:100%;border-collapse:collapse;margin:20px 0;">' + htmlRows + '</table>' +
          '<p>Puedes consultar los términos y condiciones completos en el siguiente enlace:</p>' +
          '<p><a href="' + escapeHtml_(CONFIG.TERMS_URL) + '" style="display:inline-block;background:#704cff;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:600;">Leer términos y condiciones</a></p>' +
          '<p style="margin-top:24px;">Si encuentras algún dato que debamos corregir, comunícate con nuestro equipo.</p>' +
          '<p><strong>Musicala</strong> — vida, alma y artes</p>' +
        '</div>' +
      '</div>';

    MailApp.sendEmail({
      to: recipient,
      subject: subject,
      body: body,
      htmlBody: htmlBody,
      name: 'Musicala'
    });
    return { ok: true };
  } catch (error) {
    const msg = error && error.message ? error.message : 'No se pudo enviar el correo de bienvenida.';
    Logger.log('sendWelcomeEmail_ error: ' + msg);
    return { ok: false, error: msg };
  }
}

function escapeHtml_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeText_(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function validatePhoneServer_(value, label) {
  const v = String(value || '').replace(/\s+/g, '');
  if (!/^\d+$/.test(v)) {
    throw new Error(label + ' debe contener solo números.');
  }
}

function validateMobileServer_(value, label) {
  const v = String(value || '').replace(/\s+/g, '');
  if (v.startsWith('+')) {
    if (!/^\+\d{7,15}$/.test(v)) {
      throw new Error(label + ' internacional inválido. Usa + y el indicativo del país.');
    }
    return;
  }
  if (!/^\d+$/.test(v)) {
    throw new Error(label + ' debe contener solo números.');
  }
  if (v.length > 10) {
    throw new Error(label + ' supera 10 dígitos. Si es extranjero, agrega el indicativo con + de su país.');
  }
}

function sanitizeFileName_(value) {
  return String(value || 'archivo')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'archivo';
}

function getSafeExtension_(fileName, mimeType) {
  const extensionFromName = String(fileName || '').split('.').pop().toLowerCase();
  const allowedByMime = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp'
  };

  if (allowedByMime[mimeType]) {
    return allowedByMime[mimeType];
  }

  if (['jpg', 'jpeg', 'png', 'webp'].indexOf(extensionFromName) !== -1) {
    return extensionFromName === 'jpeg' ? 'jpg' : extensionFromName;
  }

  return 'jpg';
}

function assertConfig_() {
  if (!CONFIG.SHEET_ID) throw new Error('Falta configurar el ID del archivo de Google Sheets.');
  if (!CONFIG.SHEET_NAME) throw new Error('Falta configurar el nombre de la pestaÃ±a de Google Sheets.');
  if (!PropertiesService.getScriptProperties().getProperty('LEGACY_APPS_SCRIPT_TOKEN')) {
    throw new Error('MISSING_LEGACY_APPS_SCRIPT_TOKEN');
  }
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

