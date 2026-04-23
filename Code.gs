const CONFIG = {
  SHEET_ID: '1MsWABlj_LdhWKzVq_u-1M6S5zEJ2yQ72oiusvzzQZAI',
  SHEET_NAME: 'Inscripci\u00f3n estudiantes',
  DRIVE_FOLDER_ID: '1BWw69WoDVSRbPC1fafpXgeJnbkWI6dNI',
  ALERT_EMAIL: 'musicalaasesor@gmail.com',
  EMAIL_COLUMN_INDEX: 8,
  MAX_IMAGE_SIZE_MB: 3,
  ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
  TIMEZONE: 'America/Bogota'
};

const HEADERS = [
  'Estudiantes',
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
  'Presentas alguna condiciÃ³n y/o enfermedad que consideres relevante para tus clases',
  'Marca temporal',
  'Â¿EstÃ¡s de acuerdo con los tÃ©rminos y condiciones de Musicala?',
  'Â¿Por quÃ© no estÃ¡s de acuerdo con los tÃ©rminos y condiciones actuales?',
  'Nombre (referido)',
  'Celular (referido)'
];

function doGet(e) {
  try {
    assertConfig_();
    const action = String((e && e.parameter && e.parameter.action) || '').trim();
    if (action === 'checkEmail') {
      const email = normalizeEmail_((e && e.parameter && e.parameter.email) || '');
      if (!email) {
        return jsonResponse_({ ok: true, exists: false, message: 'Sin correo para validar.' });
      }
      const sheet = getSheet_();
      const exists = emailAlreadyExists_(sheet, email);
      return jsonResponse_({ ok: true, exists: exists });
    }
    return jsonResponse_({ ok: true, service: 'Musicala Form API', timestamp: new Date().toISOString() });
  } catch (error) {
    return jsonResponse_({
      ok: false,
      message: error && error.message ? error.message : 'No fue posible procesar la solicitud.'
    });
  }
}

function doOptions() {
  return jsonResponse_({ ok: true });
}

function doPost(e) {
  try {
    assertConfig_();

    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('No se recibiÃ³ informaciÃ³n para procesar la inscripciÃ³n.');
    }

    const payload = JSON.parse(e.postData.contents);
    validatePayload_(payload);

    const sheet = getSheet_();
    ensureHeaders_(sheet);

    const normalizedEmail = normalizeEmail_(payload.studentEmail);
    if (emailAlreadyExists_(sheet, normalizedEmail)) {
      return jsonResponse_({
        ok: false,
        code: 'DUPLICATE_EMAIL',
        message: 'Este correo ya se encuentra registrado en Musicala. Si necesitas actualizar informaciÃ³n, por favor comunÃ­cate con nuestro equipo.'
      });
    }

    const fileMeta = payload.photo ? savePhoto_(payload.photo, payload.studentName) : null;
    const row = buildRow_(payload, fileMeta);
    sheet.appendRow(row);
    const savedRow = sheet.getLastRow();
    const notify = notifyAdvisor_(payload, sheet.getName(), savedRow);
    if (!notify || !notify.ok) {
      throw new Error('La inscripción se guardó, pero falló el correo de notificación: ' + (notify && notify.error ? notify.error : 'sin detalle.'));
    }

    return jsonResponse_({
      ok: true,
      message: 'Tu inscripciÃ³n fue enviada correctamente.',
      sheetName: sheet.getName(),
      savedRow: savedRow
    });
  } catch (error) {
    return jsonResponse_({
      ok: false,
      message: error && error.message ? error.message : 'OcurriÃ³ un error al procesar la inscripciÃ³n.'
    });
  }
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
    'guardianDocument',
    'guardianMobile',
    'guardianPhone',
    'guardianAddress',
    'relationship',
    'healthCondition',
    'termsAgreement'
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

  if (payload.photo) {
    if (!payload.photo.base64 || !payload.photo.mimeType || !payload.photo.name) {
      throw new Error('La foto adjunta no es vÃ¡lida. Intenta cargarla nuevamente.');
    }

    if (CONFIG.ALLOWED_IMAGE_TYPES.indexOf(payload.photo.mimeType) === -1) {
      throw new Error('La foto debe estar en formato JPG, PNG o WEBP.');
    }

    const imageBytes = Utilities.base64Decode(payload.photo.base64).length;
    const maxBytes = CONFIG.MAX_IMAGE_SIZE_MB * 1024 * 1024;
    if (imageBytes > maxBytes) {
      throw new Error('La imagen supera el tamaÃ±o mÃ¡ximo permitido de ' + CONFIG.MAX_IMAGE_SIZE_MB + ' MB.');
    }
  }

  if (normalizeText_(payload.course) === 'musica' && !String(payload.instrument || '').trim()) {
    throw new Error('Selecciona al menos un instrumento.');
  }

  if (payload.course === 'Baile' && !String(payload.style || '').trim()) {
    throw new Error('Selecciona al menos un estilo.');
  }

  if (payload.course === 'Artes manuales' && !String(payload.emphasis || '').trim()) {
    throw new Error('Selecciona al menos un Ã©nfasis.');
  }

  if (payload.termsAgreement === 'No' && !String(payload.termsReason || '').trim()) {
    throw new Error('CuÃ©ntanos por quÃ© no estÃ¡s de acuerdo con los tÃ©rminos y condiciones actuales.');
  }

  if (!/^(CC|TI|CE|PAS|PPT)\d+$/.test(String(payload.studentDocument || '').trim())) {
    throw new Error('El documento del estudiante no es válido. Debe incluir tipo y número, por ejemplo CC10036442.');
  }
  if (!/^(CC|TI|CE|PAS|PPT)\d+$/.test(String(payload.guardianDocument || '').trim())) {
    throw new Error('El documento del acudiente no es válido. Debe incluir tipo y número, por ejemplo CC10036442.');
  }

  validatePhoneServer_(payload.phone, 'Teléfono fijo');
  validateMobileServer_(payload.mobile, 'Celular');
  validatePhoneServer_(payload.guardianPhone, 'Teléfono fijo (acudiente)');
  validateMobileServer_(payload.guardianMobile, 'Celular (acudiente)');
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
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  }
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

function buildRow_(payload, fileMeta) {
  const now = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  const row = new Array(32).fill('');

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
  row[8] = fileMeta && fileMeta.url ? fileMeta.url : '';
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
  // AF: condición de salud (si existe en tu hoja)
  row[31] = payload.healthCondition || '';

  return row;
}

function normalizeEmail_(email) {
  return String(email || '').trim().toLowerCase();
}


function notifyAdvisor_(payload, sheetName, rowNumber) {
  try {
    const name = String(payload.studentName || 'Sin nombre');
    const subject = 'Inscripción realizada: ' + name;
    const body = [
      'Se registró una nueva inscripción en Musicala.',
      '',
      'Estudiante: ' + name,
      'Correo: ' + normalizeEmail_(payload.studentEmail || ''),
      'Curso: ' + String(payload.course || ''),
      'Hoja: ' + String(sheetName || ''),
      'Fila: ' + String(rowNumber || ''),
      'Fecha: ' + Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss')
    ].join('\n');
    MailApp.sendEmail(CONFIG.ALERT_EMAIL, subject, body);
    return { ok: true };
  } catch (error) {
    const msg = error && error.message ? error.message : 'No se pudo enviar el correo de notificación.';
    Logger.log('notifyAdvisor_ error: ' + msg);
    return { ok: false, error: msg };
  }
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
  if (!CONFIG.DRIVE_FOLDER_ID) throw new Error('Falta configurar la carpeta de Google Drive para las fotos.');
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

