-- =============================================
-- HUAYACÁN · SCHEMA MySQL
-- Base de datos: huayacan_horarios
-- =============================================

CREATE DATABASE IF NOT EXISTS huayacan_horarios
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE huayacan_horarios;

-- ── DEPARTAMENTOS ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS departments (
  id        VARCHAR(50) PRIMARY KEY,
  name      VARCHAR(100)  NOT NULL,
  icon      VARCHAR(10)   NOT NULL,
  color_dim VARCHAR(80)   NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT IGNORE INTO departments (id, name, icon, color_dim) VALUES
  ('ama_llaves',     'Ama de Llaves',  '🛏️',  'rgba(253,121,168,0.15)'),
  ('seguridad',      'Seguridad',      '🛡️',  'rgba(116,185,255,0.15)'),
  ('mantenimiento',  'Mantenimiento',  '🔧',  'rgba(249,202,36,0.15)'),
  ('marketing',      'Marketing',      '📢',  'rgba(162,155,254,0.15)'),
  ('administracion', 'Administración', '📋',  'rgba(85,239,196,0.15)');

-- ── EMPLEADOS ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employees (
  id          VARCHAR(36)  PRIMARY KEY,
  dept_id     VARCHAR(50)  NOT NULL,
  name        VARCHAR(150) NOT NULL,
  role        VARCHAR(100) DEFAULT '',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (dept_id) REFERENCES departments(id) ON DELETE CASCADE,
  UNIQUE KEY uq_emp_dept_name (dept_id, name)
);

-- ── HORARIOS ──────────────────────────────────────────────────────────────────
-- week_start: lunes de la semana (YYYY-MM-DD)
-- day_idx: 0=Lun … 6=Dom
CREATE TABLE IF NOT EXISTS schedules (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  employee_id   VARCHAR(36)  NOT NULL,
  dept_id       VARCHAR(50)  NOT NULL,
  week_start    DATE         NOT NULL,
  day_idx       TINYINT      NOT NULL CHECK (day_idx BETWEEN 0 AND 6),
  active        TINYINT(1)   NOT NULL DEFAULT 1,
  start_time    TIME         NULL,
  end_time      TIME         NULL,
  comida_start  TIME         NULL,
  comida_end    TIME         NULL,
  notes         TEXT         NULL,
  updated_at    DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  UNIQUE KEY uq_slot (employee_id, week_start, day_idx)
);
