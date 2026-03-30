/* ============================================================
   HUAYACÁN · Supabase Sync Layer para Dashboard de Horarios
   supabase-sync.js

   Este archivo se carga ANTES de app.js.
   Conecta el dashboard a Supabase para cargar los empleados
   sincronizados con el HR portal.
   ============================================================ */

// ── Supabase credentials (same as main portal) ────────────────
// Leer desde el archivo .env del dashboard (inyectado como variable global)
// O usa los mismos valores del portal RH
const SUPABASE_URL = window.SUPABASE_URL || 'https://akpooccqqsragbweiuis.supabase.co';
const SUPABASE_ANON = window.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrcG9vY2NxcXNyYWdid2VpdWlzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwMjk1MDQsImV4cCI6MjA4OTYwNTUwNH0.NT6FuZOWFxeCg044lxNN80fTSMjRNntmgRS3qh895NU';

// ── Client ────────────────────────────────────────────────────
let sbHorarios = null;
if (SUPABASE_URL && SUPABASE_ANON && window.supabase) {
  sbHorarios = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
}

/**
 * Cargar empleados desde Supabase `profiles` y mapearlos
 * al formato que espera el dashboard de horarios.
 *
 * Los empleados sin departamento quedan en "administracion" por defecto.
 * El campo `departamento` en profiles puede usarse como dept_id.
 *
 * @returns {Object} { deptId: [{id, name, role}] } o null si falla
 */
async function loadEmployeesFromSupabase() {
  if (!sbHorarios) {
    console.warn('[supabase-sync] No hay cliente Supabase configurado.');
    return null;
  }

  try {
    const { data, error } = await sbHorarios
      .from('profiles')
      .select('id, nombre_completo, departamento, puesto, activo, onboarding_completo')
      .eq('onboarding_completo', true)   // Solo empleados con expediente completo
      .eq('activo', true)               // Solo empleados activos
      .not('nombre_completo', 'is', null)
      .order('nombre_completo', { ascending: true });

    if (error) throw error;
    if (!data || data.length === 0) return null;

    // Mapear a la estructura del dashboard: { deptId: [{id, name, role}] }
    const empMap = {};

    // Inicializar todos los departamentos (vacíos)
    (window.DEPARTMENTS || []).forEach(d => { empMap[d.id] = []; });

    data.forEach(p => {
      // Solo activos con onboarding completo (double-check)
      if (p.activo === false || !p.onboarding_completo) return;

      const name = (p.nombre_completo || '').trim();
      if (!name) return;

      // Determinar dept: usa el campo `departamento` en profiles, o 'administracion' por defecto
      const deptRaw = (p.departamento || 'administracion').toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

      // Buscar el dept más cercano
      const depts = window.DEPARTMENTS || [];
      let matchedDept = depts.find(d => d.id === deptRaw) ||
        depts.find(d => deptRaw.includes(d.id) || d.id.includes(deptRaw)) ||
        depts.find(d => d.id === 'administracion') ||
        depts[0];

      const deptId = matchedDept?.id;
      if (!deptId) return;
      if (!empMap[deptId]) empMap[deptId] = [];

      empMap[deptId].push({
        id:   p.id, // UUID de Supabase
        name: name,
        role: p.puesto || '',
      });
    });

    return empMap;
  } catch (err) {
    console.error('[supabase-sync] Error cargando empleados:', err);
    return null;
  }
}

/**
 * Cargar estado de asistencia actual desde Supabase `attendance`.
 * Devuelve un mapa: nombre_empleado → 'in' | 'out' | null
 */
async function loadAttendanceStatus() {
  if (!sbHorarios) return {};
  try {
    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await sbHorarios
      .from('attendance')
      .select('en_no, employee_name, type, check_time')
      .gte('check_time', `${today}T00:00:00`)
      .order('check_time', { ascending: false });
    if (error) throw error;

    // More recent wins
    const statusMap = {};
    for (const r of data) {
      const key = r.employee_name.toLowerCase();
      if (!statusMap[key]) statusMap[key] = r.type;
    }
    return statusMap;
  } catch (err) {
    console.warn('[supabase-sync] Error cargando asistencia:', err);
    return {};
  }
}

// ── Patch loadAll() to inject Supabase employees ─────────────
// We hook into the app's init after the DOM is ready.
window.addEventListener('DOMContentLoaded', async () => {
  // Wait for app.js to define DEPARTMENTS
  await new Promise(r => setTimeout(r, 100));

  // Limpia caché local de empleados incondicionalmente para que
  // el dashboard sea un espejo exacto de la BD en Supabase (RRHH).
  localStorage.removeItem('huayacan_v3_emp');
  console.log('[supabase-sync] Caché local de empleados vaciado ✓');

  // Para los horarios, solo lo limpia si tiene datos inválidos
  const valSch = localStorage.getItem('huayacan_v3_sch');
  if (valSch) {
    try { JSON.parse(valSch); } catch { localStorage.removeItem('huayacan_v3_sch'); }
  }

  if (!sbHorarios) {
    console.warn('[supabase-sync] Sin conexión Supabase. El dashboard usa datos locales.');
    // Update status badge
    const badge = document.querySelector('.status-chip');
    if (badge) {
      badge.innerHTML = '<span style="width:7px;height:7px;background:#f59e0b;border-radius:50%;display:inline-block;"></span> Local · Sin Supabase';
      badge.style.color = '#f59e0b';
    }
    return;
  }

  // Override the status chip to show "Supabase"
  const badge = document.querySelector('.status-chip');
  if (badge) {
    badge.innerHTML = '<span class="pulse"></span> Supabase · Conectado';
    badge.style.color = 'var(--accent-green, #10b981)';
  }

  // Hook: after initial load completes, overlay Supabase employees
  const origLoadAll = window.loadAll;
  window.loadAll = async function() {
    // Run original load first (establishes departments, local data)
    await origLoadAll.call(this);

    // Then overlay with Supabase employees
    try {
      const sbEmployees = await loadEmployeesFromSupabase();
      if (sbEmployees) {
        // OVERRIDE: replace local employees with Supabase data entirely.
        // Schedules are kept (they're stored by employee ID in Supabase UUIDs).
        Object.keys(sbEmployees).forEach(deptId => {
          if (!window.employees) window.employees = {};
          // Replace the dept list with Supabase data
          window.employees[deptId] = sbEmployees[deptId];
        });

        // Persist to localStorage so it works offline after first load
        if (window.saveToStorage) window.saveToStorage();

        // Re-render
        if (window.renderTabs) window.renderTabs();
        if (window.renderPanel) window.renderPanel();
        if (window.updateStats) window.updateStats();

        const total = Object.values(sbEmployees).reduce((s,a) => s+a.length, 0);
        console.log(`[supabase-sync] ${total} empleados con expediente completo cargados desde Supabase ✓`);
      } else {
        // No employees with completed onboarding → clear all depts
        if (window.DEPARTMENTS && window.employees) {
          window.DEPARTMENTS.forEach(d => { window.employees[d.id] = []; });
          if (window.renderTabs) window.renderTabs();
          if (window.renderPanel) window.renderPanel();
          if (window.updateStats) window.updateStats();
        }
        console.log('[supabase-sync] Sin empleados con onboarding completo.');
      }
    } catch (err) {
      console.warn('[supabase-sync] No se pudieron sincronizar empleados:', err.message);
    }
  };
});
