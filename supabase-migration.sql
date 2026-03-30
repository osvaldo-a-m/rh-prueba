-- ================================================================
--  HUAYACÁN · Supabase SQL Migration
--  Ejecutar en: Supabase Dashboard → SQL Editor
-- ================================================================

-- ── ATTENDANCE (registros del checador biométrico) ────────────
CREATE TABLE IF NOT EXISTS attendance (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  en_no         text NOT NULL,          -- número de empleado del dispositivo (EnNo)
  employee_name text NOT NULL,          -- nombre tal como aparece en el archivo
  profile_id    uuid REFERENCES profiles(id) ON DELETE SET NULL,
  check_time    timestamptz NOT NULL,   -- fecha y hora del registro
  type          text NOT NULL CHECK (type IN ('in','out')),  -- DutyOn=in, DutyOff=out
  source        text DEFAULT 'device_file',  -- 'device_file' | 'manual'
  created_at    timestamptz DEFAULT now(),
  UNIQUE (en_no, check_time)            -- evitar duplicados del mismo archivo
);

-- Índices para consultas rápidas
CREATE INDEX IF NOT EXISTS idx_attendance_check_time ON attendance(check_time DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_en_no      ON attendance(en_no);
CREATE INDEX IF NOT EXISTS idx_attendance_profile    ON attendance(profile_id);

-- ── VISITOR LOG (bitácora de seguridad) ──────────────────────
CREATE TABLE IF NOT EXISTS visitor_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo            text NOT NULL,   -- 'proveedor' | 'cliente' | 'evento'
  destino         text NOT NULL,   -- 'restaurante' | 'hotel' | 'evento' | 'oficina'
  nombre          text NOT NULL,
  empresa         text,
  persona_a_visitar text,
  entry_time      timestamptz NOT NULL DEFAULT now(),
  exit_time       timestamptz,
  placa_vehiculo  text,
  notas           text,
  guard_name      text,            -- nombre del guardia que registró
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visitor_log_entry ON visitor_log(entry_time DESC);

-- ── VISITOR SIGNATURES (bitácora de visitantes con firma) ────
CREATE TABLE IF NOT EXISTS visitor_signatures (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha            date NOT NULL DEFAULT current_date,
  nombre           text NOT NULL,
  empresa          text,
  persona_a_visitar text,
  hora_entrada     time NOT NULL,
  hora_salida      time,
  firma_base64     text,           -- firma digital como PNG base64
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visitor_sig_fecha ON visitor_signatures(fecha DESC);

-- ── RLS Policies (ajustar según tus necesidades) ─────────────
-- Attendance: solo admins pueden leer/escribir
ALTER TABLE attendance         ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor_signatures ENABLE ROW LEVEL SECURITY;

-- Política temporal: permitir todo (ajustar con roles reales luego)
CREATE POLICY "allow_all_attendance"  ON attendance         FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_visitor_log" ON visitor_log        FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_visitor_sig" ON visitor_signatures FOR ALL USING (true) WITH CHECK (true);

-- ── Columnas adicionales para profiles (si no existen) ───────
-- Ejecutar solo si no existen aún:
-- ALTER TABLE profiles ADD COLUMN IF NOT EXISTS activo boolean DEFAULT true;
-- ALTER TABLE profiles ADD COLUMN IF NOT EXISTS fecha_baja timestamptz;
