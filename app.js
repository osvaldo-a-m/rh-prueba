// ============================================================
//  HOTEL ONBOARDING APP — app.js
// ============================================================

// ⚠️  CONFIGURACIÓN: Reemplaza esta URL con tu webhook de n8n
const N8N_WEBHOOK_URL = 'https://backyou-n8n.pf0hps.easypanel.host/webhook/7bc337b9-d906-48fe-b847-0af0e412b88c';

// ---- File state ----
const files = {
    solicitud: null,
    ine: null,
    acta: null,
    curp: null,
    nss: null,
    rfc: null,
    credito: null,
    comprobante: null,
    estudios: null,
    recomendacion: null,
    estado_cuenta: null,
};

const MAX_FILE_SIZE_MB = 15;

let formSuccessfullySubmitted = false;

// ---- Trigger hidden file input ----
function triggerUpload(docType) {
    if (formSuccessfullySubmitted) {
        showErrorModal('Ya has enviado tu expediente. Recarga la página para registrar a otra persona.');
        return;
    }
    const input = document.getElementById(`file-${docType}`);
    if (input) input.click();
}

// ---- Handle file selection from input ----
function handleFile(input, docType) {
    if (!input.files || !input.files[0]) return;
    processFile(input.files[0], docType);
}

// ---- Drag & Drop handlers ----
function handleDragOver(event) {
    if (formSuccessfullySubmitted) return;
    event.preventDefault();
    event.currentTarget.classList.add('drag-over');
}

function handleDrop(event, docType) {
    if (formSuccessfullySubmitted) return;
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over');
    const droppedFile = event.dataTransfer.files[0];
    if (!droppedFile) return;
    processFile(droppedFile, docType);
}

// ---- Process & validate file ----
function processFile(file, docType) {
    // Validate size
    const sizeMB = file.size / (1024 * 1024);
    if (sizeMB > MAX_FILE_SIZE_MB) {
        showFieldError(docType, `El archivo es demasiado grande (${sizeMB.toFixed(1)} MB). Máximo ${MAX_FILE_SIZE_MB} MB.`);
        return;
    }

    // Validate type
    if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
        showFieldError(docType, 'Tipo de archivo no permitido. Sube una imagen o PDF.');
        return;
    }

    // Clear any previous error
    hideFieldError(docType);

    // Save file reference
    files[docType] = file;

    // Update UI
    updateUploadZone(docType, file);
}

// ---- Update zone to show attached file ----
function updateUploadZone(docType, file) {
    const zone = document.getElementById(`zone-${docType}`);
    const preview = document.getElementById(`preview-${docType}`);
    const badge = document.getElementById(`badge-${docType}`);
    const card = document.getElementById(`card-${docType}`);

    // Mark zone as filled
    zone.classList.add('has-file');
    card.classList.add('has-file');
    badge.textContent = '✓ Adjunto';
    badge.classList.add('uploaded');

    // Build preview
    const sizeMB = (file.size / (1024 * 1024)).toFixed(2);

    let imgHtml = '';
    if (file.type.startsWith('image/')) {
        const url = URL.createObjectURL(file);
        imgHtml = `<img src="${url}" alt="preview" />`;
    } else {
        imgHtml = `<span style="font-size:1.6rem;">📄</span>`;
    }

    preview.innerHTML = `
    <div class="file-preview-item">
      ${imgHtml}
      <span class="file-name">${escapeHtml(file.name)}</span>
      <span class="file-size">${sizeMB} MB</span>
      <button class="file-remove" onclick="removeFile('${docType}')" title="Quitar archivo">✕</button>
    </div>
  `;

    // Hide default labels
    const icon = zone.querySelector('.upload-icon');
    const label = zone.querySelector('.upload-label');
    if (icon) icon.style.display = 'none';
    if (label) label.style.display = 'none';
    preview.style.display = 'block';
}

// ---- Remove a file ----
function removeFile(docType) {
    files[docType] = null;
    document.getElementById(`file-${docType}`).value = '';

    const zone = document.getElementById(`zone-${docType}`);
    const preview = document.getElementById(`preview-${docType}`);
    const badge = document.getElementById(`badge-${docType}`);
    const card = document.getElementById(`card-${docType}`);

    zone.classList.remove('has-file');
    card.classList.remove('has-file');
    badge.textContent = 'Requerido';
    badge.classList.remove('uploaded');

    const icon = zone.querySelector('.upload-icon');
    const label = zone.querySelector('.upload-label');
    if (icon) icon.style.display = '';
    if (label) label.style.display = '';
    preview.innerHTML = '';
    preview.style.display = 'none';
}

// ---- Error helpers ----
function showFieldError(docType, msg) {
    const el = document.getElementById(`error-${docType}`);
    if (el) {
        el.textContent = msg || 'Este documento es obligatorio.';
        el.style.display = 'flex';
    }
}

function hideFieldError(docType) {
    const el = document.getElementById(`error-${docType}`);
    if (el) el.style.display = 'none';
}

// ---- Validate all fields before submit ----
function validateForm() {
    let valid = true;

    const nombre = document.getElementById('empleado-nombre').value.trim();
    if (!nombre) {
        document.getElementById('empleado-nombre').style.borderColor = '#e57373';
        valid = false;
    } else {
        document.getElementById('empleado-nombre').style.borderColor = '';
    }

    const requiredDocs = ['solicitud', 'ine', 'acta', 'curp', 'nss', 'rfc', 'credito', 'comprobante', 'estudios', 'recomendacion', 'estado_cuenta'];
    requiredDocs.forEach((docType) => {
        if (!files[docType]) {
            showFieldError(docType, 'Este documento es obligatorio.');
            valid = false;
        } else {
            hideFieldError(docType);
        }
    });

    // Check if the submit button should turn green
    const submitBtn = document.getElementById('submit-btn');
    if (valid && videoWatched) {
        submitBtn.classList.add('ready');
    } else {
        submitBtn.classList.remove('ready');
    }

    return valid;
}

// ---- Form submit ----
document.getElementById('upload-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (formSuccessfullySubmitted) {
        showErrorModal('Ya has enviado tu expediente. Recarga la página para registrar a otra persona.');
        return;
    }
    if (!validateForm()) return;

    const submitBtn = document.getElementById('submit-btn');
    const btnText = submitBtn.querySelector('.btn-text');
    const btnLoader = submitBtn.querySelector('.btn-loader');

    // Show loading state
    submitBtn.disabled = true;
    btnText.style.display = 'none';
    btnLoader.style.display = 'flex';

    const nombre = document.getElementById('empleado-nombre').value.trim();
    const formData = new FormData();
    formData.append('nombre', nombre);
    formData.append('fecha_envio', new Date().toISOString());
    const docKeys = ['solicitud', 'ine', 'acta', 'curp', 'nss', 'rfc', 'credito', 'comprobante', 'estudios', 'recomendacion', 'estado_cuenta'];
    docKeys.forEach(docType => {
        if (files[docType]) {
            formData.append(docType, files[docType], files[docType].name);
        }
    });

    try {
        const response = await fetch(N8N_WEBHOOK_URL, {
            method: 'POST',
            body: formData,
            // Note: do NOT set Content-Type header when using FormData —
            // the browser will set the correct multipart boundary automatically.
        });

        if (response.ok) {
            formSuccessfullySubmitted = true;
            document.getElementById('upload-form').style.opacity = '0.6';
            document.getElementById('empleado-nombre').disabled = true;
            document.getElementById('area').disabled = true;
            document.getElementById('submit-btn').classList.remove('ready');
            showSuccessModal();
        } else {
            const errorText = await response.text().catch(() => '');
            showErrorModal(`El servidor respondió con código ${response.status}. ${errorText}`);
        }
    } catch (err) {
        console.error('Error al enviar a n8n:', err);
        showErrorModal('No se pudo conectar con el servidor. Verifica tu conexión e inténtalo de nuevo.');
    } finally {
        submitBtn.disabled = false;
        btnText.style.display = '';
        btnLoader.style.display = 'none';
    }
});

// ---- Modals ----
function showSuccessModal() {
    document.getElementById('success-modal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('success-modal').style.display = 'none';
}

function showErrorModal(msg) {
    document.getElementById('error-modal').style.display = 'flex';
    if (msg) document.getElementById('error-modal-msg').textContent = msg;
}

function closeErrorModal() {
    document.getElementById('error-modal').style.display = 'none';
}

// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.style.display = 'none';
        }
    });
});

// ---- Video logic ----
let videoWatched = false;

function playVideo() {
    const placeholder = document.getElementById('video-placeholder');
    const video = document.getElementById('induction-video');

    placeholder.style.display = 'none';
    video.style.display = 'block';
    video.play().catch(() => {
        // Autoplay blocked — show controls anyway
    });
}

function onVideoEnded() {
    videoWatched = true;
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    const statusBox = document.getElementById('video-status');

    if (dot) {
        dot.classList.remove('pending');
        dot.classList.add('done');
    }
    if (text) text.textContent = 'Video completado';
    if (statusBox) statusBox.classList.remove('pending');

    validateForm(); // Re-validate to turn submit button green if ready
}

// ---- Utility ----
function escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}
