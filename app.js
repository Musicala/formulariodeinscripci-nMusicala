const CONFIG = {
  maxImageSizeMB: 3,
  duplicateEmailMessage: 'Este correo ya se encuentra registrado en Musicala. Si es un familiar, usa otro correo. Si necesitas actualizar información, por favor comunícate con administración.'
};

const firebaseConfig = {
  apiKey: "AIzaSyA12_rlUjYM2z4aFG4bf43Wf0tSNTxC0Vg",
  authDomain: "estudiantes-musicala.firebaseapp.com",
  projectId: "estudiantes-musicala",
  storageBucket: "estudiantes-musicala.firebasestorage.app",
  messagingSenderId: "342934326940",
  appId: "1:342934326940:web:a75cc4634569c5a4a82759"
};

firebase.initializeApp(firebaseConfig);

/*
  Firebase App Check (reCAPTCHA v3).
  Pendiente de activación en consola (ver DEPLOYMENT.md, sección App Check):
  1) registrar el sitio en reCAPTCHA v3, 2) habilitar App Check para el app web
  en la consola de Firebase, 3) pegar aquí la site key, 4) activar enforcement
  en Firestore y Storage cuando el % de tráfico verificado sea estable.
  Con la clave vacía no se activa y el formulario funciona igual que hoy.
*/
const APP_CHECK_SITE_KEY = '';
if (APP_CHECK_SITE_KEY && firebase.appCheck) {
  firebase.appCheck().activate(APP_CHECK_SITE_KEY, true);
}

const db = firebase.firestore();
const functions = firebase.app().functions('us-central1');
const checkStudentRegistrationDuplicate = functions.httpsCallable('checkStudentRegistrationDuplicate');
const createTermsRejectedEvent = functions.httpsCallable('createTermsRejectedEvent');

// Genera un UUID v4 estable de negocio (contactId). Usa crypto.randomUUID cuando
// está disponible y cae a un generador equivalente en navegadores antiguos.
function generateContactId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, function (b) { return b.toString(16).padStart(2, '0'); });
    return hex.slice(0, 4).join('') + '-' + hex.slice(4, 6).join('') + '-' +
      hex.slice(6, 8).join('') + '-' + hex.slice(8, 10).join('') + '-' + hex.slice(10, 16).join('');
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Nombre normalizado para búsquedas y detección de duplicados. NO es el ID:
// el studentId canónico es siempre el ID del documento de Firestore.
function normalizeStudentName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// LEGADO — NO USAR PARA DETECCIÓN DEFINITIVA.
// La huella oficial del documento se calcula en el BACKEND con
// HMAC-SHA256(documentoNormalizado, secreto) dentro de syncStudentIdentity
// (índice privado student_document_index). Este SHA sin llave solo se
// conserva temporalmente como apoyo de migración y se retirará después.
async function buildLegacyDocumentSha(studentDocument) {
  const clean = normalizeStudentName(studentDocument).replace(/[^a-z0-9]/g, '');
  if (!clean || typeof crypto === 'undefined' || !crypto.subtle) return '';
  try {
    const bytes = new TextEncoder().encode(`musicala:doc:${clean}`);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch (_e) {
    return '';
  }
}

// La ruta de la foto NO contiene datos personales: se usa el studentId
// canónico y un UUID. Ver storage.rules (versionadas en esta carpeta).
async function uploadPhotoToStorage(photoFile, photoBase64, studentId) {
  const storage = firebase.storage();
  const rawExt = photoFile.name.split('.').pop().toLowerCase();
  const ext = ['jpg', 'jpeg', 'png', 'webp'].includes(rawExt) ? rawExt : 'jpg';
  const safeStudentId = String(studentId || '').replace(/[^A-Za-z0-9_-]/g, '') || 'sin-id';
  const path = `fotos-estudiantes/${safeStudentId}/${generateContactId()}.${ext}`;

  const byteString = atob(photoBase64);
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
  const blob = new Blob([ab], { type: photoFile.type });

  const snapshot = await storage.ref(path).put(blob);
  return await snapshot.ref.getDownloadURL();
}

async function saveToFirestore(payload, photoUrl, documentId, contactId) {
  const docData = { ...payload };
  delete docData.photo;
  if (photoUrl) docData.photoUrl = photoUrl;
  // contactId: identificador de negocio heredado (UUID). Se conserva como alias
  // secundario, pero el ID oficial del estudiante es studentId (= ID del doc).
  if (!docData.contactId && contactId) docData.contactId = contactId;

  // Contrato de identidad v2: el studentId canónico es el ID del documento.
  docData.studentId = documentId;
  docData.studentName = docData.studentName || '';
  docData.normalizedName = normalizeStudentName(docData.studentName);
  // Solo apoyo de migración; la huella oficial (HMAC) la calcula el backend.
  docData.documentShaLegacy = await buildLegacyDocumentSha(docData.studentDocument);
  docData.schemaVersion = 2;
  docData.identitySource = 'estudiantes-musicala';
  docData.timestamp = firebase.firestore.FieldValue.serverTimestamp();
  docData.updatedAt = firebase.firestore.FieldValue.serverTimestamp();

  const docRef = db.collection('estudiantes').doc(documentId);

  /*
    Escritura de CREACIÓN única. El cliente público no puede leer ni
    actualizar `estudiantes` (ver firestore.rules): los reintentos no vuelven
    a pasar por aquí (flag firestoreSaved) y cualquier inconsistencia de
    studentId la detecta y reporta el backend (syncStudentIdentity).
  */
  docData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
  await docRef.set(docData);
  console.log('Firestore guardado, ID:', documentId);
  return documentId;
}

let pendingFirebaseSubmission = null;

const form = document.getElementById('enrollmentForm');
const birthDateInput = document.getElementById('birthDate');
const ageInput = document.getElementById('age');
const courseSelect = document.getElementById('course');
const musicBlock = document.getElementById('musicBlock');
const danceBlock = document.getElementById('danceBlock');
const theaterBlock = document.getElementById('theaterBlock');
const artsBlock = document.getElementById('artsBlock');
const healthConditionWrap = document.getElementById('healthConditionWrap');
const guardianDocumentRequirement = document.getElementById('guardianDocumentRequirement');
const imageAuthorizationByStudent = document.getElementById('imageAuthorizationByStudent');
const imageAuthorizationByGuardian = document.getElementById('imageAuthorizationByGuardian');
const minorImageAuthorizationHint = document.getElementById('minorImageAuthorizationHint');
const imageGuardianAuthorizationWrap = document.getElementById('imageGuardianAuthorizationWrap');
const imageAuthorizationDifferentGuardian = document.getElementById('imageAuthorizationDifferentGuardian');
const differentImageGuardianFields = document.getElementById('differentImageGuardianFields');
const submitBtn = document.getElementById('submitBtn');
const toast = document.getElementById('toast');
const successModal = document.getElementById('successModal');
const closeSuccessBtn = document.getElementById('closeSuccessBtn');
const progressText = document.getElementById('progressText');
const progressFill = document.getElementById('progressFill');
const studentEmailInput = document.getElementById('studentEmail');
const samePhoneAsMobile = document.getElementById('samePhoneAsMobile');
const guardianUseStudentData = document.getElementById('guardianUseStudentData');
const courseBannerWrap = document.getElementById('courseBannerWrap');
const courseBannerImg = document.getElementById('courseBannerImg');

const COURSE_BANNERS = {
  'Baile':                './assets/baile.png',
  'Música':               './assets/musica.png',
  'Teatro':               './assets/Teatro.png',
  'Artes manuales':       './assets/artes.png',
  'Talleres vacacionales':'./assets/Vacacionales.png',
};

function showToast(message, type = 'success') {
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => (toast.className = 'toast'), 4800);
}

function calculateAge(dateStr) {
  if (!dateStr) return '';
  const birth = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const md = today.getMonth() - birth.getMonth();
  if (md < 0 || (md === 0 && today.getDate() < birth.getDate())) age--;
  return Number.isFinite(age) && age >= 0 ? age : '';
}

function updateCourseBanner() {
  const v = courseSelect.value;
  const src = COURSE_BANNERS[v];
  if (src) {
    courseBannerImg.src = src;
    courseBannerImg.alt = v;
    courseBannerWrap.classList.remove('hidden');
  } else {
    courseBannerWrap.classList.add('hidden');
    courseBannerImg.src = '';
  }
}

function toggleCourseBlocks() {
  const v = courseSelect.value;
  musicBlock.classList.toggle('hidden', v !== 'Música');
  danceBlock.classList.toggle('hidden', v !== 'Baile');
  theaterBlock.classList.toggle('hidden', v !== 'Teatro');
  artsBlock.classList.toggle('hidden', v !== 'Artes manuales');
}

function isMinor() {
  const age = calculateAge(birthDateInput.value);
  return age !== '' && age < 18;
}

function updateGuardianDocumentRequirement() {
  const minor = isMinor();
  const authorizationBy = form.querySelector('input[name="imageUseAuthorizationBy"]:checked')?.value;
  const usesRegisteredGuardian = authorizationBy === 'Acudiente' && !imageAuthorizationDifferentGuardian.checked;
  const guardianDocumentIsRequired = minor || usesRegisteredGuardian;
  const guardianDocumentType = form.guardianDocumentType;
  const guardianDocumentNumber = form.guardianDocumentNumber;

  guardianDocumentType.required = guardianDocumentIsRequired;
  guardianDocumentNumber.required = guardianDocumentIsRequired;
  guardianDocumentRequirement.textContent = guardianDocumentIsRequired ? '*' : '(opcional para mayores de edad)';
}

function updateAgeDependentFields() {
  const minor = isMinor();

  imageAuthorizationByStudent.disabled = minor;
  minorImageAuthorizationHint.classList.toggle('hidden', !minor);
  if (minor) imageAuthorizationByGuardian.checked = true;
  updateGuardianDocumentRequirement();
  toggleImageGuardianAuthorization();
}

function toggleHealthCondition() {
  const answer = form.querySelector('input[name="healthConditionAnswer"]:checked')?.value;
  const hasCondition = answer === 'Sí';
  healthConditionWrap.classList.toggle('hidden', !hasCondition);
  form.healthCondition.required = hasCondition;
  if (!hasCondition) form.healthCondition.value = '';
}

function toggleImageGuardianAuthorization() {
  const authorizationBy = form.querySelector('input[name="imageUseAuthorizationBy"]:checked')?.value;
  const usesGuardian = authorizationBy === 'Acudiente';
  const differentGuardian = usesGuardian && imageAuthorizationDifferentGuardian.checked;

  imageGuardianAuthorizationWrap.classList.toggle('hidden', !usesGuardian);
  differentImageGuardianFields.classList.toggle('hidden', !differentGuardian);
  form.imageGuardianName.required = differentGuardian;
  form.imageGuardianDocumentType.required = differentGuardian;
  form.imageGuardianDocumentNumber.required = differentGuardian;

  if (!differentGuardian) {
    form.imageGuardianName.value = '';
    form.imageGuardianDocumentType.value = '';
    form.imageGuardianDocumentNumber.value = '';
  }
  updateGuardianDocumentRequirement();
}

function getCheckedValues(name) {
  return [...form.querySelectorAll(`input[name="${name}"]:checked`)]
    .filter((el) => !el.closest('.hidden'))
    .map((el) => el.value);
}

function setFieldError(field, message) {
  const wrap = field.closest('.field') || field.parentElement;
  if (!wrap) return;
  wrap.classList.add('error');
  let err = wrap.querySelector('.error-text');
  if (!err) {
    err = document.createElement('small');
    err.className = 'error-text';
    wrap.appendChild(err);
  }
  err.textContent = message;
}

function clearErrors() {
  form.querySelectorAll('.field.error').forEach((el) => el.classList.remove('error'));
  form.querySelectorAll('.error-text').forEach((el) => el.remove());
}

function validateConditionalSelections() {
  const c = courseSelect.value;
  if (c === 'Música' && getCheckedValues('instrument').length === 0 && !document.getElementById('instrumentOther').value.trim()) {
    showToast('Selecciona al menos un instrumento.', 'error');
    return false;
  }
  if (c === 'Baile' && getCheckedValues('style').length === 0) {
    showToast('Selecciona al menos un estilo.', 'error');
    return false;
  }
  if (c === 'Teatro' && getCheckedValues('style').length === 0) {
    showToast('Selecciona al menos un área teatral.', 'error');
    return false;
  }
  if (c === 'Artes manuales' && getCheckedValues('emphasis').length === 0) {
    showToast('Selecciona al menos un énfasis.', 'error');
    return false;
  }
  return true;
}

function validatePhoto(file) {
  if (!file) return '';
  const valid = ['image/jpeg', 'image/png', 'image/webp'];
  if (!valid.includes(file.type)) return 'La foto debe ser JPG, PNG o WEBP.';
  const max = CONFIG.maxImageSizeMB * 1024 * 1024;
  if (file.size > max) return `La foto supera el máximo permitido de ${CONFIG.maxImageSizeMB} MB.`;
  return '';
}

function normalizeDigits(value) {
  return String(value || '').replace(/\s+/g, '');
}

function syncStudentFixedPhoneWithMobile() {
  if (!samePhoneAsMobile) return;
  if (samePhoneAsMobile.checked) {
    form.phone.value = form.mobile.value || '';
    form.phone.readOnly = true;
  } else {
    form.phone.readOnly = false;
  }
  if (guardianUseStudentData && guardianUseStudentData.checked) {
    form.guardianPhone.value = form.phone.value || '';
  }
  updateProgress();
}

function syncGuardianFromStudent() {
  if (!guardianUseStudentData) return;
  if (guardianUseStudentData.checked) {
    form.guardianPhone.value = form.phone.value || '';
    form.guardianAddress.value = form.studentAddress.value || '';
    form.guardianPhone.readOnly = true;
    form.guardianAddress.readOnly = true;
  } else {
    form.guardianPhone.readOnly = false;
    form.guardianAddress.readOnly = false;
  }
  updateProgress();
}

function validateBirthDate(dateStr) {
  if (!dateStr) return 'La fecha de nacimiento es obligatoria.';
  const birth = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  if (Number.isNaN(birth.getTime())) return 'La fecha de nacimiento no es válida.';
  if (birth > today) return 'La fecha de nacimiento no puede ser futura.';
  const age = calculateAge(dateStr);
  if (age === '' || age > 120) return 'La fecha de nacimiento no es válida.';
  return '';
}

function validateEmailFormat(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return 'El correo electrónico es obligatorio.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return 'El correo electrónico no es válido.';
  return '';
}

function validateNumericField(value, label) {
  const v = normalizeDigits(value);
  if (!v) return `${label} es obligatorio.`;
  if (!/^\d+$/.test(v)) return `${label} debe contener solo números.`;
  return '';
}

function validateMobileField(value, label) {
  const v = normalizeDigits(value);
  if (!v) return `${label} es obligatorio.`;

  if (v.startsWith('+')) {
    if (!/^\+\d{7,15}$/.test(v)) {
      return `${label} internacional inválido. Usa + y el indicativo del país.`;
    }
    return '';
  }

  if (!/^\d+$/.test(v)) return `${label} debe contener solo números.`;
  if (v.length > 10) {
    return `${label} supera 10 dígitos. Si es extranjero, agrega el indicativo con + de su país.`;
  }
  return '';
}

function combineDocument(typeId, numberId, label, required = true) {
  const typeEl = document.getElementById(typeId);
  const numEl = document.getElementById(numberId);
  const type = String(typeEl?.value || '').trim();
  const num = String(numEl?.value || '').trim();

  if (!required && !type && !num) return '';
  if (!type) {
    setFieldError(typeEl, `Selecciona el tipo de documento (${label}).`);
    return null;
  }
  const alphanumericTypes = ['RC', 'PAS'];
  const isAlpha = alphanumericTypes.includes(type);
  if (!num || (isAlpha ? !/^[A-Za-z0-9\-]+$/.test(num) : !/^\d+$/.test(num))) {
    const msg = isAlpha
      ? `El número de documento (${label}) contiene caracteres no válidos.`
      : `El número de documento (${label}) debe contener solo números.`;
    setFieldError(numEl, msg);
    return null;
  }
  return `${type}${num}`;
}

const duplicateCheckCache = { key: '', result: null };
async function checkDuplicateWithFirebase(email, documentType, documentNumber) {
  const normalized = String(email || '').trim().toLowerCase();
  const safeType = String(documentType || '').trim().toUpperCase();
  const safeNumber = String(documentNumber || '').trim();
  if (!normalized || !safeType || !safeNumber) return null;

  const key = `${normalized}|${safeType}|${safeNumber.toUpperCase()}`;
  if (duplicateCheckCache.key === key && duplicateCheckCache.result) {
    return duplicateCheckCache.result;
  }

  const response = await checkStudentRegistrationDuplicate({
    email: normalized,
    documentType: safeType,
    documentNumber: safeNumber
  });
  const result = response?.data || {};
  duplicateCheckCache.key = key;
  duplicateCheckCache.result = result;
  return result;
}

async function canContinueAfterDuplicateCheck(email, documentType, documentNumber) {
  try {
    const result = await checkDuplicateWithFirebase(email, documentType, documentNumber);
    if (!result) return true;
    if (result.duplicate) {
      const message = result.message || CONFIG.duplicateEmailMessage;
      setFieldError(form.studentEmail, message);
      showToast(message, 'error');
      return false;
    }
    return result.canContinue === true;
  } catch (_error) {
    const proceed = window.confirm(
      'No pudimos verificar si la inscripción ya existe. Puedes cancelar e intentarlo más tarde, o continuar de forma controlada; el equipo revisará cualquier posible duplicado.'
    );
    if (!proceed) {
      showToast('La inscripción se detuvo porque no fue posible verificar duplicados.', 'error');
    }
    return proceed;
  }
}

function updateProgress() {
  const req = [...form.querySelectorAll('[required]')].filter((el) => {
    if (el.closest('.hidden')) return false;
    if (el.type === 'radio') return el === form.querySelector(`input[name="${el.name}"]`);
    return true;
  });

  let completed = 0;
  for (const field of req) {
    if (field.type === 'radio') {
      if (form.querySelector(`input[name="${field.name}"]:checked`)) completed++;
    } else if (field.type === 'file') {
      if (field.files?.length) completed++;
    } else if (String(field.value || '').trim() !== '') {
      completed++;
    }
  }

  const percent = req.length ? Math.round((completed / req.length) * 100) : 0;
  progressText.textContent = `${percent}%`;
  progressFill.style.width = `${percent}%`;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function buildPayload(photoBase64, photoFile) {
  const course = courseSelect.value;
  const instruments = getCheckedValues('instrument');
  const styles = getCheckedValues('style');
  const emphases = getCheckedValues('emphasis');
  const other = document.getElementById('instrumentOther').value.trim();
  if (other) instruments.push(`Otro: ${other}`);

  const studentDocument = combineDocument('studentDocumentType', 'studentDocumentNumber', 'estudiante');
  const guardianDocument = combineDocument('guardianDocumentType', 'guardianDocumentNumber', 'acudiente', isMinor());
  const authorizationByType = form.querySelector('input[name="imageUseAuthorizationBy"]:checked')?.value || '';
  let imageUseAuthorizationBy = authorizationByType;
  if (authorizationByType === 'Acudiente') {
    const usesDifferentGuardian = imageAuthorizationDifferentGuardian.checked;
    const authorizationGuardianDocument = usesDifferentGuardian
      ? combineDocument('imageGuardianDocumentType', 'imageGuardianDocumentNumber', 'acudiente que autoriza')
      : guardianDocument;
    const authorizationGuardianName = usesDifferentGuardian
      ? form.imageGuardianName.value.trim()
      : form.guardianName.value.trim();
    if (!authorizationGuardianName || !authorizationGuardianDocument) return null;
    imageUseAuthorizationBy = `Acudiente: ${authorizationGuardianName} — ${authorizationGuardianDocument}`;
  }

  if (!studentDocument || guardianDocument === null) return null;
  const healthAnswer = form.querySelector('input[name="healthConditionAnswer"]:checked')?.value || '';

  return {
    studentName: form.studentName.value.trim(),
    studentDocument,
    birthDate: form.birthDate.value,
    age: form.age.value,
    studentCity: form.studentCity.value.trim(),
    studentAddress: form.studentAddress.value.trim(),
    studentEmail: form.studentEmail.value.trim().toLowerCase(),
    phone: normalizeDigits(form.phone.value),
    mobile: normalizeDigits(form.mobile.value),
    course,
    instrument: course === 'Música' ? instruments.join(', ') : '',
    style: ['Baile', 'Teatro'].includes(course) ? styles.join(', ') : '',
    emphasis: course === 'Artes manuales' ? emphases.join(', ') : '',
    interests: form.interests.value.trim(),
    selectedPlan: form.selectedPlan.value,
    modality: form.modality.value,
    eps: form.eps.value.trim(),
    rh: form.rh.value.trim(),
    guardianName: form.guardianName.value.trim(),
    guardianDocument,
    guardianMobile: normalizeDigits(form.guardianMobile.value),
    guardianPhone: normalizeDigits(form.guardianPhone.value),
    guardianAddress: form.guardianAddress.value.trim(),
    relationship: form.relationship.value.trim(),
    healthCondition: healthAnswer === 'Sí' ? `Sí: ${form.healthCondition.value.trim()}` : healthAnswer,
    termsAgreement: form.querySelector('input[name="termsAgreement"]:checked')?.value || '',
    termsReason: '',
    imageUseAuthorization: form.querySelector('input[name="imageUseAuthorization"]:checked')?.value || '',
    imageUseAuthorizationBy,
    referredName: form.referredName.value.trim(),
    referredMobile: normalizeDigits(form.referredMobile.value),
    photo: photoFile ? { name: photoFile.name, mimeType: photoFile.type, base64: photoBase64 } : null
  };
}

async function notifyTermsRejection() {
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span>Registrando decisión...</span>';

  try {
    await createTermsRejectedEvent({
      email: form.studentEmail?.value.trim().toLowerCase() || '',
      studentName: form.studentName?.value.trim() || ''
    });
    showToast('Registramos que no aceptaste los términos. Para inscribirte en Musicala debes aceptarlos.', 'error');
  } catch (error) {
    showToast(error?.message || 'No fue posible registrar la decisión.', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span>Enviar inscripción</span>';
  }
}

async function submitForm(event) {
  event.preventDefault();
  clearErrors();

  const termsAgreement = form.querySelector('input[name="termsAgreement"]:checked')?.value;
  if (termsAgreement === 'No') {
    await notifyTermsRejection();
    return;
  }

  if (!form.checkValidity()) {
    [...form.querySelectorAll(':invalid')].forEach((field) => {
      if (field.type !== 'radio') setFieldError(field, 'Este campo es obligatorio.');
    });
    showToast('Revisa los campos obligatorios antes de enviar.', 'error');
    updateProgress();
    return;
  }

  if (!validateConditionalSelections()) return;

  const birthErr = validateBirthDate(form.birthDate.value);
  if (birthErr) {
    setFieldError(form.birthDate, birthErr);
    showToast(birthErr, 'error');
    return;
  }

  const emailErr = validateEmailFormat(form.studentEmail.value);
  if (emailErr) {
    setFieldError(form.studentEmail, emailErr);
    showToast(emailErr, 'error');
    return;
  }

  const phoneErr = validateNumericField(form.phone.value, 'Teléfono fijo');
  if (phoneErr) {
    setFieldError(form.phone, phoneErr);
    showToast(phoneErr, 'error');
    return;
  }

  const mobileErr = validateMobileField(form.mobile.value, 'Celular');
  if (mobileErr) {
    setFieldError(form.mobile, mobileErr);
    showToast(mobileErr, 'error');
    return;
  }

  const gPhoneErr = validateNumericField(form.guardianPhone.value, 'Teléfono fijo (acudiente)');
  if (gPhoneErr) {
    setFieldError(form.guardianPhone, gPhoneErr);
    showToast(gPhoneErr, 'error');
    return;
  }

  const gMobileErr = validateMobileField(form.guardianMobile.value, 'Celular (acudiente)');
  if (gMobileErr) {
    setFieldError(form.guardianMobile, gMobileErr);
    showToast(gMobileErr, 'error');
    return;
  }

  if (normalizeDigits(form.guardianMobile.value) === normalizeDigits(form.mobile.value)) {
    const msg = 'El celular del acudiente debe ser diferente al celular del estudiante.';
    setFieldError(form.guardianMobile, msg);
    showToast(msg, 'error');
    return;
  }

  const emailForCheck = (form.studentEmail.value || '').trim().toLowerCase();
  const canContinue = await canContinueAfterDuplicateCheck(
    emailForCheck,
    form.studentDocumentType.value,
    form.studentDocumentNumber.value
  );
  if (!canContinue) return;

  const photoFile = form.studentPhoto.files[0];
  const photoError = validatePhoto(photoFile);
  if (photoError) {
    setFieldError(form.studentPhoto, photoError);
    showToast(photoError, 'error');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span>Enviando...</span>';

  try {
    const photoBase64 = photoFile ? await fileToBase64(photoFile) : '';
    const payload = buildPayload(photoBase64, photoFile);
    if (!payload) {
      showToast('Revisa el tipo y número de documento.', 'error');
      return;
    }

    // Firebase confirma la inscripción; los efectos secundarios son backend.
    if (!pendingFirebaseSubmission) {
      pendingFirebaseSubmission = {
        id: db.collection('estudiantes').doc().id,
        contactId: generateContactId(),
        photoUrl: '',
        firestoreSaved: false
      };
    }

    submitBtn.innerHTML = '<span>Guardando en Firebase...</span>';
    if (photoFile && photoBase64 && !pendingFirebaseSubmission.photoUrl) {
      pendingFirebaseSubmission.photoUrl = await uploadPhotoToStorage(
        photoFile,
        photoBase64,
        pendingFirebaseSubmission.id
      );
    }

    // La inscripción se escribe UNA sola vez. Los correos y la copia
    // transitoria en Sheets se ejecutan en backend y nunca bloquean el éxito.
    if (!pendingFirebaseSubmission.firestoreSaved) {
      await saveToFirestore(
        payload,
        pendingFirebaseSubmission.photoUrl,
        pendingFirebaseSubmission.id,
        pendingFirebaseSubmission.contactId
      );
      pendingFirebaseSubmission.firestoreSaved = true;
    }
    pendingFirebaseSubmission = null;
    form.reset();
    toggleCourseBlocks();
    updateCourseBanner();
    toggleHealthCondition();
    updateAgeDependentFields();
    toggleImageGuardianAuthorization();
    syncStudentFixedPhoneWithMobile();
    syncGuardianFromStudent();
    ageInput.value = '';
    updateProgress();

    successModal.classList.remove('hidden');
    successModal.setAttribute('aria-hidden', 'false');
    const modalEmail = document.getElementById('successEmail');
    if (modalEmail) modalEmail.textContent = payload.studentEmail || 'tu correo';
  } catch (error) {
    const message = String(error?.message || '');
    if (/duplicado|duplicate|registrado/i.test(message)) {
      showToast(CONFIG.duplicateEmailMessage, 'error');
    } else {
      showToast(message || 'Ocurrió un error al enviar el formulario.', 'error');
    }
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span>Enviar inscripción</span>';
  }
}

const today = new Date();
birthDateInput.max = today.toISOString().slice(0, 10);

birthDateInput.addEventListener('input', () => {
  ageInput.value = calculateAge(birthDateInput.value);
  updateAgeDependentFields();
  updateProgress();
});

courseSelect.addEventListener('change', () => {
  toggleCourseBlocks();
  updateCourseBanner();
  updateProgress();
});

form.querySelectorAll('input[name="termsAgreement"]').forEach((r) =>
  r.addEventListener('change', () => {
    updateProgress();
  })
);

form.querySelectorAll('input[name="healthConditionAnswer"]').forEach((r) =>
  r.addEventListener('change', () => {
    toggleHealthCondition();
    updateProgress();
  })
);

form.querySelectorAll('input[name="imageUseAuthorizationBy"]').forEach((r) =>
  r.addEventListener('change', () => {
    toggleImageGuardianAuthorization();
    updateProgress();
  })
);

imageAuthorizationDifferentGuardian.addEventListener('change', () => {
  toggleImageGuardianAuthorization();
  updateProgress();
});

form.addEventListener('input', updateProgress);
form.addEventListener('change', updateProgress);
form.addEventListener('submit', submitForm);

if (samePhoneAsMobile) {
  samePhoneAsMobile.addEventListener('change', syncStudentFixedPhoneWithMobile);
  form.mobile.addEventListener('input', () => {
    if (samePhoneAsMobile.checked) syncStudentFixedPhoneWithMobile();
  });
}

if (guardianUseStudentData) {
  guardianUseStudentData.addEventListener('change', syncGuardianFromStudent);
  [form.phone, form.studentAddress].forEach((field) => {
    field.addEventListener('input', () => {
      if (guardianUseStudentData.checked) syncGuardianFromStudent();
    });
  });
}

if (studentEmailInput) {
  studentEmailInput.addEventListener('blur', async () => {
    const email = (studentEmailInput.value || '').trim().toLowerCase();
    if (!email) return;
    const formatErr = validateEmailFormat(email);
    if (formatErr) {
      setFieldError(studentEmailInput, formatErr);
      showToast(formatErr, 'error');
      return;
    }
    try {
      const result = await checkDuplicateWithFirebase(
        email,
        form.studentDocumentType.value,
        form.studentDocumentNumber.value
      );
      if (result?.duplicate) {
        const message = result.message || CONFIG.duplicateEmailMessage;
        setFieldError(studentEmailInput, message);
        showToast(message, 'error');
      }
    } catch (_e) {
      // noop
    }
  });
}

closeSuccessBtn.addEventListener('click', () => {
  successModal.classList.add('hidden');
  successModal.setAttribute('aria-hidden', 'true');
});

toggleCourseBlocks();
updateCourseBanner();
toggleHealthCondition();
updateAgeDependentFields();
toggleImageGuardianAuthorization();
syncStudentFixedPhoneWithMobile();
syncGuardianFromStudent();
updateProgress();
