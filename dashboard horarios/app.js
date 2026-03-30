/* =============================================
   HUAYACÁN – DASHBOARD DE HORARIOS v4
   app.js · MySQL API + localStorage fallback
   ============================================= */

// ── CONFIG ───────────────────────────────────────────────────────────────────
const CONFIG = {
  // URL base del servidor Express. Cuando abres index.html desde el servidor
  // (http://localhost:3000) deja esto en ''. Si lo abres como archivo local
  // (file://) cambia a 'http://localhost:3000'
  API_BASE: '',

  // true  → usa MySQL vía API (requiere que el servidor esté corriendo)
  // false → usa solo localStorage (modo sin servidor)
  USE_API: false,
};

// Paleta de colores e íconos para nuevas áreas
const DEPT_COLORS = [
  'rgba(253,121,168,0.15)', 'rgba(116,185,255,0.15)', 'rgba(249,202,36,0.15)',
  'rgba(162,155,254,0.15)', 'rgba(85,239,196,0.15)', 'rgba(255,159,67,0.15)',
  'rgba(255,107,107,0.15)', 'rgba(72,219,251,0.15)', 'rgba(29,209,161,0.15)',
];
const DEPT_ICONS = ['🏢', '🛏️', '🛡️', '🔧', '📢', '📋', '🍽️', '🚗', '💼', '🎯', '🏋️', '🎨'];

// Departamentos — se puebla desde la API al conectar
let DEPARTMENTS = [
  { id: 'ama_llaves', name: 'Ama de Llaves', icon: '🛏️', colorDim: 'rgba(253,121,168,0.15)' },
  { id: 'seguridad', name: 'Seguridad', icon: '🛡️', colorDim: 'rgba(116,185,255,0.15)' },
  { id: 'mantenimiento', name: 'Mantenimiento', icon: '🔧', colorDim: 'rgba(249,202,36,0.15)' },
  { id: 'marketing', name: 'Marketing', icon: '📢', colorDim: 'rgba(162,155,254,0.15)' },
  { id: 'administracion', name: 'Administración', icon: '📋', colorDim: 'rgba(85,239,196,0.15)' },
];

const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DAYS_FULL = ['LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO', 'DOMINGO'];

// ── SEED DATA ─────────────────────────────────────────────────────────────────
// Empleados se sincronizan desde el portal de RH (Supabase).
// Solo aparecen aquí los que tienen onboarding_completo = true.
// No uses datos semilla locales.
const SEED_EMPLOYEES = {
  ama_llaves:    [],
  seguridad:     [],
  mantenimiento: [],
  marketing:     [],
  administracion:[],
};

// ── STATE ─────────────────────────────────────────────────────────────────────
let employees = {};   // { deptId: [{id,name,role}] }
let scheduleData = {};   // { deptId: { empId: { dayIdx: {...} } } }
let currentDept = DEPARTMENTS[0].id;
let currentWeekOffset = 0;
let editTarget = null;
let deleteTarget = null;
let deleteDeptTarget = null;
let apiAvailable = false;

// ── WEEK HELPERS ──────────────────────────────────────────────────────────────
function getWeekDates(offset = 0) {
  const today = new Date();
  const dow = today.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(today);
  mon.setDate(today.getDate() + diff + offset * 7);
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(mon); d.setDate(mon.getDate() + i); return d; });
}

function weekStartStr(offset = 0) {
  const d = getWeekDates(offset)[0];
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayIdx(weekDates) {
  const t = new Date().toDateString();
  return weekDates.findIndex(d => d.toDateString() === t);
}

// ── API LAYER ─────────────────────────────────────────────────────────────────
const api = {
  async get(path) {
    const r = await fetch(CONFIG.API_BASE + path);
    if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
    return r.json();
  },
  async post(path, body) {
    const r = await fetch(CONFIG.API_BASE + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!r.ok) { const e = await r.json(); throw new Error(e.error || r.status); }
    return r.json();
  },
  async put(path, body) {
    const r = await fetch(CONFIG.API_BASE + path, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!r.ok) { const e = await r.json(); throw new Error(e.error || r.status); }
    return r.json();
  },
  async del(path) {
    const r = await fetch(CONFIG.API_BASE + path, { method: 'DELETE' });
    if (!r.ok) { const e = await r.json(); throw new Error(e.error || r.status); }
    return r.json();
  },
};

async function checkApi() {
  if (!CONFIG.USE_API) return false;
  try {
    await api.get('/api/health');
    return true;
  } catch { return false; }
}

// ── LOAD DATA (API → localStorage fallback) ───────────────────────────────────
async function loadAll() {
  apiAvailable = await checkApi();

  if (apiAvailable) {
    await loadFromApi();
  } else {
    loadFromStorage();
  }

  setApiStatusBadge(apiAvailable);
}

async function loadFromApi() {
  // Cargar departamentos desde la BD
  try {
    const depts = await api.get('/api/departments');
    DEPARTMENTS = depts.map(d => ({
      id: d.id, name: d.name, icon: d.icon,
      colorDim: d.color_dim,
    }));
    if (!DEPARTMENTS.find(d => d.id === currentDept)) {
      currentDept = DEPARTMENTS[0]?.id || '';
    }
  } catch { /* mantiene los defaults */ }

  // Cargar empleados para cada dept
  DEPARTMENTS.forEach(d => { employees[d.id] = []; scheduleData[d.id] = {}; });
  for (const dept of DEPARTMENTS) {
    const rows = await api.get(`/api/employees?dept=${dept.id}`);
    employees[dept.id] = rows.map(r => ({ id: r.id, name: r.name, role: r.role || '' }));
  }
  // Cargar horario semana actual
  await loadWeekFromApi(currentDept);
}

async function loadWeekFromApi(deptId) {
  const ws = weekStartStr(currentWeekOffset);
  const rows = await api.get(`/api/schedules?dept=${deptId}&week_start=${ws}`);
  if (!scheduleData[deptId]) scheduleData[deptId] = {};
  const empMap = {};
  (employees[deptId] || []).forEach(e => { empMap[e.id] = e; });
  rows.forEach(r => {
    if (!scheduleData[deptId][r.employee_id]) scheduleData[deptId][r.employee_id] = {};
    scheduleData[deptId][r.employee_id][r.day_idx] = {
      active: !!r.active,
      start: r.start_time || '',
      end: r.end_time || '',
      comidaStart: r.comida_start || '',
      comidaEnd: r.comida_end || '',
      notes: r.notes || '',
    };
  });
}

// ── LOCALSTORAGE ─────────────────────────────────────────────────────────────
function loadFromStorage() {
  try {
    const e = localStorage.getItem('huayacan_v3_emp');
    const s = localStorage.getItem('huayacan_v3_sch');
    if (e) employees = JSON.parse(e);
    if (s) scheduleData = JSON.parse(s);
  } catch { }
  // Si un área tiene 0 empleados, carga los empleados semilla
  DEPARTMENTS.forEach(d => {
    if (!employees[d.id] || employees[d.id].length === 0) {
      employees[d.id] = (SEED_EMPLOYEES[d.id] || []).map(e => ({ id: genId(), ...e }));
    }
    if (!scheduleData[d.id]) scheduleData[d.id] = {};
  });
  saveToStorage();
}

function saveToStorage() {
  localStorage.setItem('huayacan_v3_emp', JSON.stringify(employees));
  localStorage.setItem('huayacan_v3_sch', JSON.stringify(scheduleData));
}

// ── STATUS BADGE ──────────────────────────────────────────────────────────────
function setApiStatusBadge(online) {
  const el = document.querySelector('.status-chip');
  if (!el) return;
  if (online) {
    el.innerHTML = '<span class="pulse"></span> MySQL · Conectado';
    el.style.color = 'var(--accent-green)';
  } else {
    el.innerHTML = '<span style="width:7px;height:7px;background:var(--gold);border-radius:50%;display:inline-block;"></span> localStorage · Local';
    el.style.color = 'var(--gold)';
  }
}

// ── UTILS ─────────────────────────────────────────────────────────────────────
function calcH(s, e) {
  if (!s || !e) return 0;
  const [sh, sm] = s.split(':').map(Number);
  const [eh, em] = e.split(':').map(Number);
  return Math.max(0, (eh * 60 + em - sh * 60 - sm) / 60);
}
function fmtH(h) { return h % 1 === 0 ? h.toFixed(0) : h.toFixed(1); }
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function avatarIdx(name) { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff; return h % 12; }
function initials(name) { const p = name.trim().split(/\s+/); return p.length >= 2 ? (p[0][0] + p[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase(); }

// ── STATS ─────────────────────────────────────────────────────────────────────
function updateStats() {
  let staff = 0, shifts = 0;
  DEPARTMENTS.forEach(d => {
    staff += (employees[d.id] || []).length;
    (employees[d.id] || []).forEach(emp => {
      const sch = (scheduleData[d.id] || {})[emp.id] || {};
      DAYS.forEach((_, di) => { const s = sch[di]; if (s?.active && s.start && s.end) shifts++; });
    });
  });
  document.getElementById('stat-areas').textContent = DEPARTMENTS.length;
  document.getElementById('stat-staff').textContent = staff;
  document.getElementById('stat-shifts').textContent = shifts;
}

// ── TABS ──────────────────────────────────────────────────────────────────────
function renderTabs() {
  const nav = document.getElementById('dept-tabs');
  nav.innerHTML = DEPARTMENTS.map(d => `
    <button class="dept-tab ${d.id === currentDept ? 'active' : ''}" data-dept="${d.id}">
      <div class="dept-tab-icon" style="background:${d.colorDim}">${d.icon}</div>
      ${d.name}
      <span class="emp-badge">${(employees[d.id] || []).length}</span>
    </button>`).join('');
  nav.querySelectorAll('.dept-tab').forEach(b => b.addEventListener('click', () => switchDept(b.dataset.dept)));
}

async function switchDept(id) {
  currentDept = id;
  renderTabs();
  if (apiAvailable) {
    try { await loadWeekFromApi(id); } catch { }
  }
  renderPanel();
}

// ── SCHEDULE PANEL ────────────────────────────────────────────────────────────
function renderPanel() {
  const dept = DEPARTMENTS.find(d => d.id === currentDept);
  const list = employees[currentDept] || [];
  const dates = getWeekDates(currentWeekOffset);
  const ti = todayIdx(dates);

  document.getElementById('panel-dept-icon').textContent = dept.icon;
  document.getElementById('panel-dept-icon').style.background = dept.colorDim;
  document.getElementById('panel-dept-name').textContent = dept.name;
  document.getElementById('panel-dept-count').textContent = `${list.length} empleado${list.length !== 1 ? 's' : ''}`;

  document.querySelectorAll('#schedule-table thead th[data-day]').forEach((th, i) => {
    th.innerHTML = `${DAYS[i]}<br><span style="font-size:.68rem;font-weight:400;color:${i === ti ? 'var(--gold)' : 'var(--text-muted)'};">${dates[i].getDate()}</span>`;
    th.classList.toggle('today', i === ti);
  });

  const isEmpty = list.length === 0;
  document.getElementById('empty-state').classList.toggle('hidden', !isEmpty);
  document.getElementById('schedule-grid-wrapper').classList.toggle('hidden', isEmpty);
  document.getElementById('schedule-body').innerHTML = list.map(emp => buildRow(emp)).join('');
  updateStats();
}

function buildRow(emp) {
  const sch = (scheduleData[currentDept] || {})[emp.id] || {};
  const av = avatarIdx(emp.name);
  let hrs = 0;
  const cells = DAYS.map((_, di) => {
    const s = sch[di] || { active: false };
    const noComida = s.active && s.start && !s.comidaStart;
    if (s.active && s.start && s.end) {
      hrs += calcH(s.start, s.end);
      return `<td class="col-day"><button class="shift-cell" onclick="openShiftModal('${emp.id}',${di})">
        <div class="shift-block active ${noComida ? 'modified' : ''}">
          <span class="shift-time">${s.start}–${s.end}</span>
          ${s.comidaStart ? `<span class="shift-comida">🍽 ${s.comidaStart}–${s.comidaEnd}</span>` : '<span class="shift-comida" style="opacity:.5">sin comida</span>'}
          <svg class="edit-icon" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </div></button></td>`;
    }
    return `<td class="col-day"><button class="shift-cell" onclick="openShiftModal('${emp.id}',${di})">
      <div class="shift-block off"><span class="shift-time">Descanso</span></div></button></td>`;
  }).join('');

  return `<tr>
    <td class="col-employee"><div class="employee-cell">
      <div class="avatar av-${av}">${initials(emp.name)}</div>
      <div><div class="employee-name">${emp.name}</div>${emp.role ? `<div style="font-size:.68rem;color:var(--text-muted)">${emp.role}</div>` : ''}</div>
    </div></td>${cells}
    <td class="col-hours"><span class="hours-badge">${fmtH(hrs)}h</span></td>
  </tr>`;
}

// ── SHIFT MODAL ───────────────────────────────────────────────────────────────
window.openShiftModal = function (empId, dayIdx) {
  const emp = (employees[currentDept] || []).find(e => e.id === empId);
  const slot = ((scheduleData[currentDept] || {})[empId] || {})[dayIdx]
    || { active: true, start: '', end: '', comidaStart: '', comidaEnd: '', notes: '' };
  editTarget = { empId, dayIdx };
  document.getElementById('modal-employee-name').textContent = emp?.name || '';
  document.getElementById('modal-day-label').textContent = `${DAYS_FULL[dayIdx]} · ${DEPARTMENTS.find(d => d.id === currentDept)?.name}`;
  document.getElementById('modal-active').checked = slot.active;
  document.getElementById('modal-start').value = slot.start || '09:00';
  document.getElementById('modal-end').value = slot.end || '17:00';
  document.getElementById('modal-comida-start').value = slot.comidaStart || '13:00';
  document.getElementById('modal-comida-end').value = slot.comidaEnd || '14:00';
  document.getElementById('modal-notes').value = slot.notes || '';
  toggleTimeFields(slot.active);
  updateDuration();
  document.getElementById('modal-overlay').classList.add('active');
};

function closeShiftModal() { document.getElementById('modal-overlay').classList.remove('active'); editTarget = null; }

function toggleTimeFields(active) {
  ['time-fields', 'comida-fields', 'duration-display'].forEach(id =>
    document.getElementById(id).style.display = active ? '' : 'none'
  );
}
function updateDuration() {
  const dur = calcH(document.getElementById('modal-start').value, document.getElementById('modal-end').value);
  document.getElementById('duration-text').textContent = dur > 0 ? `${fmtH(dur)} hrs de turno` : 'Hora de salida inválida';
}

async function saveSlot() {
  if (!editTarget) return;
  const { empId, dayIdx } = editTarget;
  const active = document.getElementById('modal-active').checked;
  const start = document.getElementById('modal-start').value;
  const end = document.getElementById('modal-end').value;
  const cStart = document.getElementById('modal-comida-start').value;
  const cEnd = document.getElementById('modal-comida-end').value;
  const notes = document.getElementById('modal-notes').value.trim();

  if (active && (!start || !end)) { showToast('Completa hora de entrada y salida', true); return; }

  const slotData = { active, start: active ? start : '', end: active ? end : '', comidaStart: active ? cStart : '', comidaEnd: active ? cEnd : '', notes };

  // ── Persist ──
  if (apiAvailable) {
    try {
      await api.put('/api/schedules', {
        employee_id: empId,
        week_start: weekStartStr(currentWeekOffset),
        day_idx: dayIdx,
        active: active ? 1 : 0,
        start_time: active ? start : null,
        end_time: active ? end : null,
        comida_start: active ? cStart : null,
        comida_end: active ? cEnd : null,
        notes,
      });
      showToast('Turno guardado en MySQL ✓');
    } catch (e) {
      showToast(`Error API: ${e.message}`, true); return;
    }
  } else {
    showToast('Guardado localmente ✓');
  }

  if (!scheduleData[currentDept]) scheduleData[currentDept] = {};
  if (!scheduleData[currentDept][empId]) scheduleData[currentDept][empId] = {};
  scheduleData[currentDept][empId][dayIdx] = slotData;
  if (!apiAvailable) saveToStorage();
  renderPanel();
  closeShiftModal();
}

// ── DEPARTMENT MANAGEMENT ──────────────────────────────────────────────

function openDeptModal() {
  document.getElementById('new-dept-name').value = '';
  document.getElementById('dept-icon-select').value = DEPT_ICONS[0];
  renderDeptList();
  document.getElementById('dept-overlay').classList.add('active');
  document.getElementById('new-dept-name').focus();
}
function closeDeptModal() { document.getElementById('dept-overlay').classList.remove('active'); }

function renderDeptList() {
  const container = document.getElementById('dept-manage-list');
  container.innerHTML = DEPARTMENTS.map(d => `
    <div class="emp-list-item">
      <div class="emp-list-avatar" style="background:${d.colorDim};color:var(--text-primary);font-size:1.2rem;">${d.icon}</div>
      <div class="emp-list-info">
        <div class="emp-list-name">${d.name}</div>
        <div class="emp-list-role">${(employees[d.id] || []).length} empleados</div>
      </div>
      <button class="btn-delete-emp" onclick="confirmDeleteDept('${d.id}')" title="Eliminar área">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      </button>
    </div>`).join('');
}

async function addDepartment() {
  const name = document.getElementById('new-dept-name').value.trim();
  const icon = document.getElementById('dept-icon-select').value;
  if (!name) { showToast('Ingresa el nombre del área', true); return; }

  const id = name.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

  if (DEPARTMENTS.find(d => d.id === id)) {
    showToast('Ya existe un área con ese nombre', true); return;
  }
  const colorIdx = DEPARTMENTS.length % DEPT_COLORS.length;
  const color_dim = DEPT_COLORS[colorIdx];

  if (apiAvailable) {
    try {
      await api.post('/api/departments', { id, name, icon, color_dim });
    } catch (e) { showToast(`Error API: ${e.message}`, true); return; }
  }

  DEPARTMENTS.push({ id, name, icon, colorDim: color_dim });
  employees[id] = [];
  scheduleData[id] = {};
  document.getElementById('new-dept-name').value = '';
  renderDeptList();
  renderTabs();
  updateStats();
  showToast(`Área "${name}" creada ✓`);
}

window.confirmDeleteDept = function (deptId) {
  const dept = DEPARTMENTS.find(d => d.id === deptId);
  if (!dept) return;
  deleteDeptTarget = deptId;
  document.getElementById('confirm-dept-name').textContent = dept.name;
  const empCount = (employees[deptId] || []).length;
  document.getElementById('confirm-dept-emps').textContent =
    empCount > 0 ? `Se eliminarán también ${empCount} empleado(s) y todos sus horarios.` : 'El área está vacía.';
  document.getElementById('confirm-dept-overlay').classList.add('active');
};

async function executeDeleteDept() {
  if (!deleteDeptTarget) return;
  const dept = DEPARTMENTS.find(d => d.id === deleteDeptTarget);
  if (apiAvailable) {
    try { await api.del(`/api/departments/${deleteDeptTarget}`); }
    catch (e) { showToast(`Error API: ${e.message}`, true); return; }
  }
  DEPARTMENTS = DEPARTMENTS.filter(d => d.id !== deleteDeptTarget);
  delete employees[deleteDeptTarget];
  delete scheduleData[deleteDeptTarget];
  if (currentDept === deleteDeptTarget) currentDept = DEPARTMENTS[0]?.id || '';
  deleteDeptTarget = null;
  document.getElementById('confirm-dept-overlay').classList.remove('active');
  renderDeptList();
  renderTabs();
  renderPanel();
  updateStats();
  showToast(`Área "${dept?.name}" eliminada`);
}

// ── EMPLOYEE MANAGEMENT ───────────────────────────────────────────────────────
function openManagePanel() {
  const dept = DEPARTMENTS.find(d => d.id === currentDept);
  document.getElementById('manage-modal-subtitle').textContent = dept.icon + ' ' + dept.name;
  document.getElementById('new-emp-name').value = '';
  document.getElementById('new-emp-role').value = '';
  renderEmpList();
  document.getElementById('manage-overlay').classList.add('active');
  document.getElementById('new-emp-name').focus();
}
function closeManagePanel() { document.getElementById('manage-overlay').classList.remove('active'); }

function renderEmpList() {
  const list = employees[currentDept] || [];
  document.getElementById('emp-list-count').textContent = `${list.length} empleado${list.length !== 1 ? 's' : ''}`;
  document.getElementById('emp-list-empty').classList.toggle('hidden', list.length > 0);
  document.getElementById('emp-list').classList.toggle('hidden', list.length === 0);
  document.getElementById('emp-list').innerHTML = list.map(emp => `
    <div class="emp-list-item">
      <div class="emp-list-avatar av-${avatarIdx(emp.name)}">${initials(emp.name)}</div>
      <div class="emp-list-info">
        <div class="emp-list-name">${emp.name}</div>
        <div class="emp-list-role">${emp.role || 'Sin puesto'}</div>
      </div>
      <button class="btn-delete-emp" onclick="confirmDelete('${emp.id}')">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      </button>
    </div>`).join('');
}

async function addEmployee() {
  const name = document.getElementById('new-emp-name').value.trim();
  const role = document.getElementById('new-emp-role').value.trim();
  if (!name) { showToast('Ingresa el nombre del empleado', true); return; }
  if ((employees[currentDept] || []).some(e => e.name.toLowerCase() === name.toLowerCase())) {
    showToast('Ya existe ese nombre en esta área', true); return;
  }
  const newEmp = { id: genId(), name, role };

  if (apiAvailable) {
    try {
      await api.post('/api/employees', { id: newEmp.id, dept_id: currentDept, name, role });
    } catch (e) { showToast(`Error API: ${e.message}`, true); return; }
  }

  employees[currentDept].push(newEmp);
  if (!apiAvailable) saveToStorage();
  document.getElementById('new-emp-name').value = '';
  document.getElementById('new-emp-role').value = '';
  document.getElementById('new-emp-name').focus();
  renderEmpList(); renderTabs(); renderPanel();
  showToast(`${name} agregado/a ✓`);
}

window.confirmDelete = function (empId) {
  const emp = (employees[currentDept] || []).find(e => e.id === empId);
  if (!emp) return;
  deleteTarget = empId;
  document.getElementById('confirm-emp-name').textContent = emp.name;
  document.getElementById('confirm-overlay').classList.add('active');
};

async function executeDelete() {
  if (!deleteTarget) return;
  const emp = (employees[currentDept] || []).find(e => e.id === deleteTarget);
  if (apiAvailable) {
    try { await api.del(`/api/employees/${deleteTarget}`); }
    catch (e) { showToast(`Error API: ${e.message}`, true); return; }
  }
  employees[currentDept] = (employees[currentDept] || []).filter(e => e.id !== deleteTarget);
  if (scheduleData[currentDept]) delete scheduleData[currentDept][deleteTarget];
  if (!apiAvailable) saveToStorage();
  deleteTarget = null;
  document.getElementById('confirm-overlay').classList.remove('active');
  renderEmpList(); renderTabs(); renderPanel();
  showToast(`${emp?.name} eliminado/a`);
}

// ── EXPORT HOJA ───────────────────────────────────────────────────────────────
function exportSheet() {
  const dept = DEPARTMENTS.find(d => d.id === currentDept);
  const empList = employees[currentDept] || [];
  const dates = getWeekDates(currentWeekOffset);
  const fmtD = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  const dateRange = `${fmtD(dates[0])} - ${fmtD(dates[6])}`;
  const monthYear = dates[0].toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }).toUpperCase();

  function buildBlock(emp) {
    const sch = (scheduleData[currentDept] || {})[emp.id] || {};
    const rowCells = field => DAYS_FULL.map((_, di) => {
      const s = sch[di] || {};
      if (!s.active) return `<td class="cell-off">DESCANSO</td>`;
      if (field === 'entrada') return `<td>${s.start ? s.start.replace(':', 'h') : ''}</td>`;
      if (field === 'salida') return `<td>${s.end ? s.end.replace(':', 'h') : ''}</td>`;
      if (field === 'comida') return s.comidaStart ? `<td>${s.comidaStart.replace(':', 'h')} - ${s.comidaEnd.replace(':', 'h')}</td>` : `<td>—</td>`;
      if (field === 'descanso') { const r = DAYS_FULL.find((_, di) => !(sch[di]?.active)); return `<td>${r || '—'}</td>`; }
      return '<td></td>';
    }).join('');
    return `<div class="emp-block">
      <div class="emp-name-row">NOMBRE: &nbsp;<strong>${emp.name.toUpperCase()}</strong>${emp.role ? ` &nbsp;<span class="emp-role-tag">${emp.role}</span>` : ''}</div>
      <table class="inner-table"><thead><tr><th></th>${DAYS_FULL.map(d => `<th>${d}</th>`).join('')}</tr></thead>
      <tbody>
        <tr><td class="row-label">ENTRADA</td>${rowCells('entrada')}</tr>
        <tr><td class="row-label">SALIDA</td>${rowCells('salida')}</tr>
        <tr><td class="row-label">COMIDA</td>${rowCells('comida')}</tr>
        <tr><td class="row-label">DESCANSO</td>${rowCells('descanso')}</tr>
        <tr class="firma-row"><td class="row-label">FIRMA</td>${DAYS_FULL.map(() => '<td></td>').join('')}</tr>
      </tbody></table>
    </div>`;
  }

  let blocks = '';
  for (let i = 0; i < empList.length; i += 2) {
    blocks += `<div class="emp-row">${buildBlock(empList[i])}${empList[i + 1] ? buildBlock(empList[i + 1]) : '<div class="emp-block empty-block"></div>'}</div>`;
  }

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/>
<title>Horarios ${dept.name} – ${dateRange}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
html,body{width:100%;max-width:100%;}
body{font-family:'Inter',Arial,sans-serif;background:#fff;color:#111;font-size:7.5pt;}
.page{padding:10px 14px;}
.page-header{display:grid;grid-template-columns:130px 1fr 95px;align-items:center;border:2px solid #111;margin-bottom:10px;width:100%;}
.hotel-cell{border-right:2px solid #111;padding:7px 10px;font-size:11pt;font-weight:700;line-height:1.3;}
.hotel-cell .sub{font-size:6pt;font-weight:400;letter-spacing:.05em;}
.center-cell{text-align:center;padding:5px 8px;}
.area-label{font-size:6pt;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#555;}
.area-name{font-size:12pt;font-weight:700;text-transform:uppercase;}
.date-main{font-size:8pt;font-weight:600;margin-top:3px;}
.company-name{font-size:6.5pt;font-weight:600;letter-spacing:.04em;color:#333;margin-top:2px;}
.logo-cell{border-left:2px solid #111;padding:6px;text-align:center;font-size:6pt;color:#aaa;}
.logo-box{width:48px;height:48px;border:2px solid #ccc;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:6pt;color:#bbb;margin-bottom:2px;}
.week-banner{display:flex;justify-content:space-between;align-items:center;background:#1a1f2c;color:#d4af37;padding:4px 12px;font-size:6.5pt;font-weight:600;letter-spacing:.06em;margin-bottom:10px;border-radius:2px;width:100%;}
.emp-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;width:100%;page-break-inside:avoid;break-inside:avoid;}
.emp-block{border:1.5px solid #111;border-radius:2px;overflow:hidden;page-break-inside:avoid;break-inside:avoid;width:100%;min-width:0;}
.empty-block{border:none!important;}
.emp-name-row{background:#111;color:#fff;padding:4px 8px;font-size:7pt;font-weight:600;display:flex;align-items:center;gap:5px;flex-wrap:wrap;word-break:break-word;}
.emp-role-tag{background:rgba(255,255,255,0.15);border-radius:2px;padding:1px 5px;font-size:5.5pt;font-weight:400;white-space:nowrap;}
.inner-table{width:100%;border-collapse:collapse;font-size:6pt;table-layout:fixed;}
.inner-table th,.inner-table td{border:.7px solid #ccc;padding:3px 2px;text-align:center;line-height:1.2;word-break:break-word;overflow:hidden;}
.inner-table thead th{background:#1a1f2c;color:#fff;font-size:5.5pt;font-weight:700;letter-spacing:.04em;padding:3px 2px;}
.row-label{background:#f0f0f0;font-weight:700;font-size:5.5pt;letter-spacing:.03em;text-align:left!important;padding-left:4px!important;white-space:nowrap;color:#333;width:46px;}
.cell-off{background:#e8e8e8;color:#888;font-size:5.5pt;font-weight:600;letter-spacing:.02em;}
.firma-row td,.firma-row .row-label{height:22px;}
@media print{
  body{font-size:7pt;}
  .no-print{display:none;}
  @page{margin:7mm;size:A4 landscape;}
  .emp-row{page-break-inside:avoid;break-inside:avoid;}
  .emp-block{page-break-inside:avoid;break-inside:avoid;}
}
</style></head><body><div class="page">
<div class="no-print" style="margin-bottom:12px">
  <button onclick="window.print()" style="background:#1a1f2c;color:#d4af37;border:none;padding:8px 18px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;">🖨️ Imprimir / Guardar PDF</button>
  <button onclick="window.close()" style="background:#eee;color:#333;border:none;padding:8px 14px;border-radius:6px;font-size:13px;cursor:pointer;margin-left:8px;">✕ Cerrar</button>
</div>
<div class="page-header">
  <div class="hotel-cell">Hotel<br><strong>Huayacán</strong><br><span class="sub">FEMEL Internacional</span></div>
  <div class="center-cell">
    <div class="area-label">Área</div>
    <div class="area-name">${dept.icon} &nbsp;${dept.name}</div>
    <div class="date-main">${dateRange}</div>
    <div class="company-name">FEMEL INTERNACIONAL S.A DE C.V</div>
  </div>
  <div class="logo-cell"><div class="logo-box">LOGO</div><br>Curamoria</div>
</div>
<div class="week-banner">
  <span>📅 SEMANA: ${dateRange}</span><span>${monthYear}</span><span>TOTAL: ${empList.length} empleados</span>
</div>
${empList.length === 0 ? '<p style="text-align:center;color:#888;padding:40px;">Sin empleados en esta área.</p>' : blocks}
</div></body></html>`;

  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
}

// ── WEEK NAV ─────────────────────────────────────────────────────────────────
function updateWeekLabel() {
  const dates = getWeekDates(currentWeekOffset);
  const opts = { day: 'numeric', month: 'short' };
  document.getElementById('week-label').textContent =
    currentWeekOffset === 0
      ? `📅 Semana actual · ${dates[0].toLocaleDateString('es-MX', opts)} – ${dates[6].toLocaleDateString('es-MX', opts)}`
      : `${dates[0].toLocaleDateString('es-MX', opts)} – ${dates[6].toLocaleDateString('es-MX', opts)}`;
}

// ── TOAST ─────────────────────────────────────────────────────────────────────
let toastT;
function showToast(msg, err = false) {
  const t = document.getElementById('toast');
  document.getElementById('toast-message').textContent = msg;
  document.getElementById('toast-icon').textContent = err ? '✕' : '✓';
  t.classList.toggle('error', err);
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 3200);
}

// ── USER MANAGEMENT ───────────────────────────────────────────────────────────

function openUsersModal() {
  document.getElementById('new-user-name').value = '';
  document.getElementById('new-user-pass').value = '';
  renderUsersList();
  document.getElementById('users-overlay').classList.add('active');
  document.getElementById('new-user-name').focus();
}
function closeUsersModal() { document.getElementById('users-overlay').classList.remove('active'); }

async function renderUsersList() {
  const listEl = document.getElementById('users-list');
  const emptyEl = document.getElementById('users-list-empty');
  const countEl = document.getElementById('users-list-count');

  if (!apiAvailable) {
    listEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    emptyEl.querySelector('p').textContent = 'La gestión de usuarios requiere conexión con el servidor MySQL.';
    countEl.textContent = '';
    return;
  }

  try {
    const users = await api.get('/api/users');
    countEl.textContent = `${users.length} usuario${users.length !== 1 ? 's' : ''}`;
    listEl.classList.toggle('hidden', users.length === 0);
    emptyEl.classList.toggle('hidden', users.length > 0);
    listEl.innerHTML = users.map(u => `
      <div class="emp-list-item">
        <div class="emp-list-avatar" style="background:var(--gold-dim);color:var(--gold);font-size:1rem;">👤</div>
        <div class="emp-list-info">
          <div class="emp-list-name">${u.username}</div>
          <div class="emp-list-role">${u.created_at ? new Date(u.created_at).toLocaleDateString('es-MX') : ''}</div>
        </div>
        <button class="btn-delete-emp" onclick="confirmDeleteUser(${u.id},'${u.username}')" title="Eliminar usuario">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </div>`).join('');
  } catch {
    listEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    emptyEl.querySelector('p').textContent = 'No se pudo cargar la lista de usuarios.';
  }
}

async function addUser() {
  const username = document.getElementById('new-user-name').value.trim();
  const password = document.getElementById('new-user-pass').value;
  if (!username) { showToast('Ingresa el nombre de usuario', true); return; }
  if (!password || password.length < 4) { showToast('La contraseña debe tener al menos 4 caracteres', true); return; }

  if (!apiAvailable) { showToast('Requiere conexión con el servidor', true); return; }

  try {
    await api.post('/api/users', { username, password });
    document.getElementById('new-user-name').value = '';
    document.getElementById('new-user-pass').value = '';
    document.getElementById('new-user-name').focus();
    renderUsersList();
    showToast(`Usuario "${username}" creado ✓`);
  } catch (e) {
    showToast(e.message, true);
  }
}

window.confirmDeleteUser = function (userId, username) {
  if (!confirm(`¿Eliminar el usuario "${username}"? Esta acción no se puede deshacer.`)) return;
  deleteUserById(userId, username);
};

async function deleteUserById(userId, username) {
  try {
    await api.del(`/api/users/${userId}`);
    renderUsersList();
    showToast(`Usuario "${username}" eliminado`);
  } catch (e) {
    showToast(`Error: ${e.message}`, true);
  }
}

// ── INIT ──────────────────────────────────────────────────────────────────────
async function init() {
  const s = new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  document.getElementById('current-date').textContent = s.charAt(0).toUpperCase() + s.slice(1);

  updateWeekLabel();
  await loadAll();
  renderTabs();
  renderPanel();

  // Shift modal
  document.getElementById('modal-overlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeShiftModal(); });
  document.getElementById('modal-close').addEventListener('click', closeShiftModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeShiftModal);
  document.getElementById('btn-save-modal').addEventListener('click', saveSlot);
  document.getElementById('modal-active').addEventListener('change', e => toggleTimeFields(e.target.checked));
  document.getElementById('modal-start').addEventListener('change', updateDuration);
  document.getElementById('modal-end').addEventListener('change', updateDuration);

  // Manage panel
  document.getElementById('btn-manage').addEventListener('click', openManagePanel);
  document.getElementById('manage-overlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeManagePanel(); });
  document.getElementById('manage-close').addEventListener('click', closeManagePanel);
  document.getElementById('btn-close-manage').addEventListener('click', closeManagePanel);
  document.getElementById('btn-add-employee').addEventListener('click', addEmployee);
  ['new-emp-name', 'new-emp-role'].forEach(id =>
    document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') addEmployee(); })
  );

  // Department panel
  document.getElementById('btn-add-dept').addEventListener('click', openDeptModal);
  document.getElementById('dept-overlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeDeptModal(); });
  document.getElementById('dept-modal-close').addEventListener('click', closeDeptModal);
  document.getElementById('btn-close-dept').addEventListener('click', closeDeptModal);
  document.getElementById('btn-create-dept').addEventListener('click', addDepartment);
  document.getElementById('new-dept-name').addEventListener('keydown', e => { if (e.key === 'Enter') addDepartment(); });

  // Confirm delete dept
  document.getElementById('confirm-dept-overlay').addEventListener('click', e => { if (e.target === e.currentTarget) document.getElementById('confirm-dept-overlay').classList.remove('active'); });
  document.getElementById('confirm-dept-close').addEventListener('click', () => document.getElementById('confirm-dept-overlay').classList.remove('active'));
  document.getElementById('btn-cancel-confirm-dept').addEventListener('click', () => document.getElementById('confirm-dept-overlay').classList.remove('active'));
  document.getElementById('btn-confirm-delete-dept').addEventListener('click', executeDeleteDept);

  // Confirm delete
  document.getElementById('confirm-overlay').addEventListener('click', e => { if (e.target === e.currentTarget) document.getElementById('confirm-overlay').classList.remove('active'); });
  document.getElementById('confirm-close').addEventListener('click', () => document.getElementById('confirm-overlay').classList.remove('active'));
  document.getElementById('btn-cancel-confirm').addEventListener('click', () => document.getElementById('confirm-overlay').classList.remove('active'));
  document.getElementById('btn-confirm-delete').addEventListener('click', executeDelete);

  // Global
  document.getElementById('btn-export').addEventListener('click', exportSheet);
  document.getElementById('prev-week').addEventListener('click', async () => { currentWeekOffset--; updateWeekLabel(); if (apiAvailable) await loadWeekFromApi(currentDept); renderPanel(); });
  document.getElementById('next-week').addEventListener('click', async () => { currentWeekOffset++; updateWeekLabel(); if (apiAvailable) await loadWeekFromApi(currentDept); renderPanel(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeShiftModal(); closeManagePanel(); closeUsersModal(); document.getElementById('confirm-overlay').classList.remove('active'); } });

  // Users modal
  document.getElementById('btn-users').addEventListener('click', openUsersModal);
  document.getElementById('users-overlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeUsersModal(); });
  document.getElementById('users-modal-close').addEventListener('click', closeUsersModal);
  document.getElementById('btn-close-users').addEventListener('click', closeUsersModal);
  document.getElementById('btn-add-user').addEventListener('click', addUser);
  ['new-user-name', 'new-user-pass'].forEach(id =>
    document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') addUser(); })
  );
  // Toggle password visibility
  document.getElementById('toggle-pass-vis').addEventListener('click', () => {
    const inp = document.getElementById('new-user-pass');
    const icon = document.getElementById('eye-icon');
    if (inp.type === 'password') {
      inp.type = 'text';
      icon.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>';
    } else {
      inp.type = 'password';
      icon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
