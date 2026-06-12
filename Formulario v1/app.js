const CONFIG = {
  apiUrl: 'https://script.google.com/macros/s/AKfycbw6TvGcSD7k7SWh0ve3CSsrye1NiTDdvVya4S8HxQuJiQd2V_rWAAZIhJi8Sd2nplR_/exec',
  maxImageSizeMB: 3,
  duplicateEmailMessage: 'Este correo ya se encuentra registrado en Musicala. Si es un familiar, usa otro correo. Si necesitas actualizar información, por favor comunícate con administración.'
};

const form = document.getElementById('enrollmentForm');
const birthDateInput = document.getElementById('birthDate');
const ageInput = document.getElementById('age');
const courseSelect = document.getElementById('course');
const musicBlock = document.getElementById('musicBlock');
const danceBlock = document.getElementById('danceBlock');
const artsBlock = document.getElementById('artsBlock');
const termsReasonWrap = document.getElementById('termsReasonWrap');
const submitBtn = document.getElementById('submitBtn');
const toast = document.getElementById('toast');
const successModal = document.getElementById('successModal');
const closeSuccessBtn = document.getElementById('closeSuccessBtn');
const progressText = document.getElementById('progressText');
const progressFill = document.getElementById('progressFill');
const studentEmailInput = document.getElementById('studentEmail');
const samePhoneAsMobile = document.getElementById('samePhoneAsMobile');
const guardianUseStudentData = document.getElementById('guardianUseStudentData');

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

function toggleCourseBlocks() {
  const v = courseSelect.value;
  musicBlock.classList.toggle('hidden', v !== 'Música');
  danceBlock.classList.toggle('hidden', v !== 'Baile');
  artsBlock.classList.toggle('hidden', v !== 'Artes manuales');
}

function toggleTermsReason() {
  const a = form.querySelector('input[name="termsAgreement"]:checked')?.value;
  termsReasonWrap.classList.toggle('hidden', a !== 'No');
}

function getCheckedValues(name) {
  return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((el) => el.value);
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

function getFieldLabel(field) {
  if (!field) return 'Este campo';
  const wrap = field.closest('.field');
  const label = wrap ? wrap.querySelector('label[for]') : null;
  return (label ? label.textContent : field.name || 'Este campo').replace('*', '').trim();
}

function validateVisibleRequiredFields() {
  const requiredFields = [...form.querySelectorAll('[required]')].filter((field) => !field.closest('.hidden'));
  for (const field of requiredFields) {
    if (field.type === 'radio') continue;
    if (!String(field.value || '').trim()) {
      const msg = `${getFieldLabel(field)} es obligatorio.`;
      setFieldError(field, msg);
      return msg;
    }
  }

  const radioGroups = [...new Set([...form.querySelectorAll('input[type="radio"][required]')].map((r) => r.name))];
  for (const groupName of radioGroups) {
    if (!form.querySelector(`input[name="${groupName}"]:checked`)) {
      return 'Debes seleccionar una opción en términos y condiciones.';
    }
  }
  return '';
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

function combineDocument(typeId, numberId, label) {
  const typeEl = document.getElementById(typeId);
  const numEl = document.getElementById(numberId);
  const type = String(typeEl?.value || '').trim();
  const num = String(numEl?.value || '').trim();

  if (!type) {
    setFieldError(typeEl, `Selecciona el tipo de documento (${label}).`);
    return null;
  }
  if (!num || !/^\d+$/.test(num)) {
    setFieldError(numEl, `El número de documento (${label}) debe contener solo números.`);
    return null;
  }
  return `${type}${num}`;
}

function combineGuardianDocument(ageValue) {
  const typeEl = document.getElementById('guardianDocumentType');
  const numEl = document.getElementById('guardianDocumentNumber');
  const type = String(typeEl?.value || '').trim();
  const num = String(numEl?.value || '').trim();
  const isAdult = Number(ageValue) >= 18;

  if (!type && !num) {
    if (isAdult) return '';
    setFieldError(typeEl, 'Para menor de edad, el documento del acudiente es obligatorio.');
    return null;
  }
  if (!type) {
    setFieldError(typeEl, 'Selecciona el tipo de documento (acudiente).');
    return null;
  }
  if (!num || !/^\d+$/.test(num)) {
    setFieldError(numEl, 'El número de documento (acudiente) debe contener solo números.');
    return null;
  }
  return `${type}${num}`;
}

function syncStudentFixedPhoneWithMobile() {
  if (!samePhoneAsMobile) return;
  const phone = document.getElementById('phone');
  const mobile = document.getElementById('mobile');
  if (!phone || !mobile) return;
  if (samePhoneAsMobile.checked) {
    phone.value = mobile.value;
    phone.readOnly = true;
  } else {
    phone.readOnly = false;
  }
}

function syncGuardianFromStudent() {
  if (!guardianUseStudentData) return;
  const guardianPhone = document.getElementById('guardianPhone');
  const guardianAddress = document.getElementById('guardianAddress');
  if (!guardianPhone || !guardianAddress) return;

  if (guardianUseStudentData.checked) {
    guardianPhone.value = form.phone.value || '';
    guardianAddress.value = form.studentAddress.value || '';
    guardianPhone.readOnly = true;
    guardianAddress.readOnly = true;
  } else {
    guardianPhone.readOnly = false;
    guardianAddress.readOnly = false;
  }
}

const emailCheckCache = { value: '', exists: false };
async function checkEmailExistsRemote(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return false;
  if (emailCheckCache.value === normalized) return emailCheckCache.exists;

  const url = `${CONFIG.apiUrl}?action=checkEmail&email=${encodeURIComponent(normalized)}`;
  const response = await fetch(url, { method: 'GET' });
  const data = await response.json();
  const exists = !!data.exists;
  emailCheckCache.value = normalized;
  emailCheckCache.exists = exists;
  return exists;
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
  const guardianDocument = combineGuardianDocument(form.age.value);

  if (!studentDocument || guardianDocument === null) return null;

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
    style: course === 'Baile' ? styles.join(', ') : '',
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
    healthCondition: form.healthCondition.value.trim(),
    termsAgreement: form.querySelector('input[name="termsAgreement"]:checked')?.value || '',
    termsReason: form.termsReason.value.trim(),
    referredName: form.referredName.value.trim(),
    referredMobile: normalizeDigits(form.referredMobile.value),
    photo: photoFile ? { name: photoFile.name, mimeType: photoFile.type, base64: photoBase64 } : null
  };
}

async function submitForm(event) {
  event.preventDefault();
  clearErrors();

  const missingRequired = validateVisibleRequiredFields();
  if (missingRequired) {
    showToast(missingRequired, 'error');
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
  if (emailForCheck) {
    const exists = await checkEmailExistsRemote(emailForCheck);
    if (exists) {
      setFieldError(form.studentEmail, CONFIG.duplicateEmailMessage);
      showToast(CONFIG.duplicateEmailMessage, 'error');
      return;
    }
  }

  if (!CONFIG.apiUrl || CONFIG.apiUrl.includes('PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE')) {
    showToast('Falta configurar la URL del Apps Script en app.js.', 'error');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span>Enviando...</span>';

  try {
    const payload = buildPayload('', null);
    if (!payload) {
      showToast('Revisa el tipo y número de documento.', 'error');
      return;
    }

    const response = await fetch(CONFIG.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.message || 'No fue posible guardar el registro.');

    form.reset();
    toggleCourseBlocks();
    toggleTermsReason();
    ageInput.value = '';
    updateProgress();

    successModal.classList.remove('hidden');
    successModal.setAttribute('aria-hidden', 'false');

    const savedIn = data.sheetName && data.savedRow ? ` Guardado en "${data.sheetName}" (fila ${data.savedRow}).` : '';
    showToast((data.message || 'Inscripción guardada correctamente.') + savedIn, 'success');
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
  updateProgress();
});

courseSelect.addEventListener('change', () => {
  toggleCourseBlocks();
  updateProgress();
});

form.querySelectorAll('input[name="termsAgreement"]').forEach((r) =>
  r.addEventListener('change', () => {
    toggleTermsReason();
    updateProgress();
  })
);

form.addEventListener('input', updateProgress);
form.addEventListener('change', updateProgress);
form.addEventListener('submit', submitForm);

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
      const exists = await checkEmailExistsRemote(email);
      if (exists) {
        setFieldError(studentEmailInput, CONFIG.duplicateEmailMessage);
        showToast(CONFIG.duplicateEmailMessage, 'error');
      }
    } catch (_e) {
      // noop
    }
  });
}

if (samePhoneAsMobile) {
  samePhoneAsMobile.addEventListener('change', () => {
    syncStudentFixedPhoneWithMobile();
    updateProgress();
  });
}

if (guardianUseStudentData) {
  guardianUseStudentData.addEventListener('change', () => {
    syncGuardianFromStudent();
    updateProgress();
  });
}

if (form.mobile) {
  form.mobile.addEventListener('input', () => {
    if (samePhoneAsMobile && samePhoneAsMobile.checked) syncStudentFixedPhoneWithMobile();
  });
}

if (form.phone || form.studentAddress) {
  const runSyncGuardian = () => {
    if (guardianUseStudentData && guardianUseStudentData.checked) syncGuardianFromStudent();
  };
  if (form.phone) form.phone.addEventListener('input', runSyncGuardian);
  if (form.studentAddress) form.studentAddress.addEventListener('input', runSyncGuardian);
}

closeSuccessBtn.addEventListener('click', () => {
  successModal.classList.add('hidden');
  successModal.setAttribute('aria-hidden', 'true');
});

toggleCourseBlocks();
toggleTermsReason();
syncStudentFixedPhoneWithMobile();
syncGuardianFromStudent();
updateProgress();
