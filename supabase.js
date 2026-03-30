// ============================================================
//  SUPABASE CONFIG — supabase.js
//  Reemplaza SUPABASE_URL y SUPABASE_ANON_KEY con los valores
//  de tu proyecto en https://app.supabase.com → Settings → API
// ============================================================

const SUPABASE_URL = 'https://akpooccqqsragbweiuis.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrcG9vY2NxcXNyYWdid2VpdWlzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwMjk1MDQsImV4cCI6MjA4OTYwNTUwNH0.NT6FuZOWFxeCg044lxNN80fTSMjRNntmgRS3qh895NU';

// Carga el cliente desde CDN (ya incluido en los HTML)
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Auth Helpers ───────────────────────────────────────────

/** Login con email y contraseña */
async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

/** Logout */
async function signOut() {
  try { await sb.auth.signOut(); } catch (e) { console.error(e); }
}

/** Obtener sesión activa */
async function getSession() {
  const { data } = await sb.auth.getSession();
  return data.session;
}

/** Obtener usuario actual */
async function getCurrentUser() {
  const { data } = await sb.auth.getUser();
  return data.user;
}

// ── Profile Helpers ────────────────────────────────────────

/** Obtener perfil del usuario autenticado */
async function getProfile(userId) {
  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}

/** Crear o actualizar perfil */
async function upsertProfile(userId, profileData) {
  const { data, error } = await sb
    .from('profiles')
    .upsert({ id: userId, ...profileData, updated_at: new Date().toISOString() })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Marcar video como visto */
async function markVideoWatched(userId) {
  return upsertProfile(userId, { video_visto: true });
}

/** Marcar onboarding como completo */
async function markOnboardingComplete(userId) {
  return upsertProfile(userId, { onboarding_completo: true });
}

// ── Documents Helpers ──────────────────────────────────────

/** Obtener todos los documentos de un empleado */
async function getDocuments(employeeId) {
  const { data, error } = await sb
    .from('documents')
    .select('*')
    .eq('employee_id', employeeId)
    .order('uploaded_at', { ascending: false });
  if (error) throw error;
  return data;
}

/**
 * Verificar si ya existe un documento de cierto tipo para un empleado
 */
async function checkDocumentExists(employeeId, tipo) {
  const { data, error } = await sb
    .from('documents')
    .select('id')
    .eq('employee_id', employeeId)
    .eq('tipo', tipo)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

/**
 * Subir archivo a Supabase Storage y registrar en tabla documents.
 * Una vez subido, NO se puede reemplazar ni borrar (inmutabilidad).
 * @param {string} employeeId
 * @param {string} tipo  e.g. 'ine', 'curp'
 * @param {File} file
 * @param {boolean} esObligatorio
 */
async function uploadDocument(employeeId, tipo, file, esObligatorio = true) {
  // 1. Verificar si ya existe — si es así, bloquear
  const exists = await checkDocumentExists(employeeId, tipo);
  if (exists) {
    throw new Error('Este documento ya fue registrado y no puede ser reemplazado.');
  }

  const ext = file.name.split('.').pop();
  const path = `${employeeId}/${tipo}/${Date.now()}.${ext}`;

  // 2. Subir archivo al bucket (sin upsert para no sobreescribir)
  const { error: uploadError } = await sb.storage
    .from('expedientes')
    .upload(path, file, { upsert: false });
  if (uploadError) throw uploadError;

  // 3. Registrar en BD con INSERT (no upsert — inmutable)
  const { data, error: dbError } = await sb
    .from('documents')
    .insert({
      employee_id: employeeId,
      tipo,
      es_obligatorio: esObligatorio,
      storage_path: path,
      file_name: file.name,
      file_size: file.size,
    })
    .select()
    .single();
  if (dbError) throw dbError;
  return data;
}

/**
 * Obtener URL pública (firmada) de un documento
 */
async function getDocumentUrl(storagePath) {
  const { data, error } = await sb.storage
    .from('expedientes')
    .createSignedUrl(storagePath, 60 * 60); // 1 hora
  if (error) throw error;
  return data.signedUrl;
}

// ── Admin Helpers ──────────────────────────────────────────

/** Obtener todos los perfiles (solo admin) */
async function getAllProfiles() {
  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

/**
 * Crear un nuevo empleado usando signUp normal de Supabase.
 * Requiere que "Confirm email" esté DESACTIVADO en:
 * Supabase Dashboard → Authentication → Settings → Email → Confirm email → OFF
 */
async function createEmployee(email, password) {
  // 1. Guardar sesión actual del Admin ANTES de hacer signUp
  const { data: adminSessionData } = await sb.auth.getSession();
  const adminSession = adminSessionData?.session;

  // 2. Crear el usuario nuevo (Supabase hace signUp y cambia la sesión activa)
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) throw error;
  if (!data.user) throw new Error('No se pudo crear el usuario.');

  // 3. Forzar que el rol sea 'empleado'
  try {
    await upsertProfile(data.user.id, { role: 'empleado' });
  } catch (e) {
    console.error("No se pudo actualizar rol a empleado", e);
  }

  // 4. Restaurar la sesión del Admin para que no pierda el acceso
  if (adminSession?.access_token && adminSession?.refresh_token) {
    await sb.auth.setSession({
      access_token: adminSession.access_token,
      refresh_token: adminSession.refresh_token,
    });
  }

  return data.user;
}


/**
 * Dar de baja / reactivar a un empleado (solo admin).
 * Requiere columnas en profiles:
 *   ALTER TABLE profiles ADD COLUMN activo boolean DEFAULT true;
 *   ALTER TABLE profiles ADD COLUMN fecha_baja timestamptz;
 */
async function setEmployeeStatus(userId, activo) {
  const updateData = {
    activo,
    fecha_baja: activo ? null : new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await sb
    .from('profiles')
    .update(updateData)
    .eq('id', userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── ATTENDANCE HELPERS ─────────────────────────────────────

/**
 * Importar registros del archivo ALOG del checador biométrico.
 * Parsea líneas con formato: No TMNo EnNo Name GMNo Mode In/Out Antipass ProxyWork DateTime
 * @param {string} fileText - contenido del archivo ALOG_001.txt
 * @returns {Array} parsed records
 */
function parseALOGFile(fileText) {
  const records = [];
  const lines = fileText.split('\n');
  // Skip header line (starts with "No" or "TMNo")
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('No ') || trimmed.startsWith('No\t')) continue;
    // Skip lines that look like standalone timestamps (HH:MM format only)
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(trimmed)) continue;

    // Split by whitespace - columns: No TMNo EnNo Name... GMNo Mode In/Out Antipass ProxyWork Date Time
    // DateTime is last two tokens (date + time), rest before In/Out is name
    const tokens = trimmed.split(/\s+/);
    if (tokens.length < 9) continue;

    // last token = time (HH:MM:SS), second to last = date (YYYY-MM-DD)
    const timeStr  = tokens[tokens.length - 1];
    const dateStr  = tokens[tokens.length - 2];
    // DateTime validation
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || !/^\d{2}:\d{2}(:\d{2})?$/.test(timeStr)) continue;

    const dateTime = `${dateStr}T${timeStr}`;
    // In/Out is 3rd from last before date/time
    const inOut    = tokens[tokens.length - 3]; // DutyOn / DutyOff
    const enNo     = tokens[2]; // Employee number
    // Name is from index 3 to (length - 6): No TMNo EnNo [name...] GMNo Mode In/Out Antipass ProxyWork Date Time
    // GMNo and the 2 tokens before In/Out are: Antipass ProxyWork
    // So: ... GMNo Mode In/Out Antipass ProxyWork Date Time = 7 tokens from end (including inOut already at -3)
    // Name tokens: from index 3 to length-7
    const nameTokens = tokens.slice(3, tokens.length - 6);
    const name = nameTokens.join(' ');

    if (!enNo || !inOut || !name) continue;
    records.push({
      en_no: enNo,
      employee_name: name,
      check_time: dateTime,
      type: inOut === 'DutyOn' ? 'in' : 'out',
      raw_mode: inOut,
    });
  }
  return records;
}

/**
 * Insertar registros de asistencia (desde archivo del checador)
 * @param {Array} records - from parseALOGFile()
 */
async function insertAttendanceRecords(records) {
  if (!records.length) return { inserted: 0, skipped: 0 };
  let inserted = 0, skipped = 0;
  for (const r of records) {
    // Try to find matching profile by name (fuzzy)
    const { data: profile } = await sb
      .from('profiles')
      .select('id')
      .ilike('nombre_completo', `%${r.employee_name.split(' ')[0]}%`)
      .maybeSingle();

    const { error } = await sb.from('attendance').insert({
      en_no: r.en_no,
      employee_name: r.employee_name,
      profile_id: profile?.id || null,
      check_time: new Date(r.check_time).toISOString(),
      type: r.type,
      source: 'device_file',
    });
    if (error && error.code !== '23505') { console.warn('Insert error:', error); skipped++; }
    else inserted++;
  }
  return { inserted, skipped };
}

/** Obtener registros de asistencia de hoy */
async function getTodayAttendance() {
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await sb
    .from('attendance')
    .select('*')
    .gte('check_time', `${today}T00:00:00`)
    .lte('check_time', `${today}T23:59:59`)
    .order('check_time', { ascending: true });
  if (error) throw error;
  return data;
}

/** Estado actual de un empleado: 'in' | 'out' | null */
async function getEmployeeCurrentStatus(enNo) {
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await sb
    .from('attendance')
    .select('type, check_time')
    .eq('en_no', enNo)
    .gte('check_time', `${today}T00:00:00`)
    .order('check_time', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.type || null;
}

/** Obtener resumen de quién está trabajando ahora */
async function getWorkingNow() {
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await sb
    .from('attendance')
    .select('en_no, employee_name, profile_id, type, check_time')
    .gte('check_time', `${today}T00:00:00`)
    .order('check_time', { ascending: false });
  if (error) throw error;
  // Keep only most recent record per employee
  const map = {};
  for (const r of data) {
    if (!map[r.en_no]) map[r.en_no] = r;
  }
  return Object.values(map);
}

// ── VISITOR LOG HELPERS ────────────────────────────────────

/** Insertar registro en bitácora de seguridad */
async function insertVisitorLog(record) {
  const { data, error } = await sb
    .from('visitor_log')
    .insert(record)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Actualizar hora de salida de un visitante */
async function setVisitorExit(visitorId, exitTime) {
  const { data, error } = await sb
    .from('visitor_log')
    .update({ exit_time: exitTime })
    .eq('id', visitorId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Obtener registros de visitantes por fecha */
async function getVisitorLogs(dateStr) {
  const { data, error } = await sb
    .from('visitor_log')
    .select('*')
    .gte('entry_time', `${dateStr}T00:00:00`)
    .lte('entry_time', `${dateStr}T23:59:59`)
    .order('entry_time', { ascending: false });
  if (error) throw error;
  return data;
}

// ── VISITOR SIGNATURE HELPERS ──────────────────────────────

/** Insertar visitante con firma digital */
async function insertVisitorSignature(record) {
  const { data, error } = await sb
    .from('visitor_signatures')
    .insert(record)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Actualizar hora de salida con firma */
async function setVisitorSignatureExit(id, exitTime) {
  const { data, error } = await sb
    .from('visitor_signatures')
    .update({ hora_salida: exitTime })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Obtener visitantes con firma por fecha */
async function getVisitorSignatures(dateStr) {
  const { data, error } = await sb
    .from('visitor_signatures')
    .select('*')
    .eq('fecha', dateStr)
    .order('hora_entrada', { ascending: true });
  if (error) throw error;
  return data;
}
