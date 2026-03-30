// =============================================
// HUAYACÁN – API SERVER
// server.js · Node.js + Express + MySQL2
// =============================================

require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;

// ── MIDDLEWARE ────────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());
app.use(express.static('.'));   // Sirve index.html, styles.css, app.js

// ── DB POOL ───────────────────────────────────────────────────────────────────
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'huayacan_horarios',
    waitForConnections: true,
    connectionLimit: 10,
    timezone: '+00:00',
});

// ── HEALTH CHECK ──────────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ ok: true, time: new Date().toISOString() });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── DEPARTMENTS ───────────────────────────────────────────────────────────────
// GET /api/departments
app.get('/api/departments', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM departments ORDER BY name');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/departments  { id, name, icon, color_dim }
app.post('/api/departments', async (req, res) => {
    const { id, name, icon = '🏢', color_dim = 'rgba(100,100,100,0.15)' } = req.body;
    if (!id || !name) return res.status(400).json({ error: 'id y name son obligatorios' });
    try {
        await pool.query(
            'INSERT INTO departments (id, name, icon, color_dim) VALUES (?, ?, ?, ?)',
            [id, name, icon, color_dim]
        );
        res.status(201).json({ ok: true, id });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe un área con ese ID' });
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/departments/:id
app.delete('/api/departments/:id', async (req, res) => {
    try {
        const [result] = await pool.query('DELETE FROM departments WHERE id = ?', [req.params.id]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Área no encontrada' });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── EMPLOYEES ─────────────────────────────────────────────────────────────────
// GET /api/employees?dept=ama_llaves
app.get('/api/employees', async (req, res) => {
    try {
        const { dept } = req.query;
        let sql = 'SELECT * FROM employees';
        const args = [];
        if (dept) { sql += ' WHERE dept_id = ?'; args.push(dept); }
        sql += ' ORDER BY name';
        const [rows] = await pool.query(sql, args);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/employees  { id, dept_id, name, role }
app.post('/api/employees', async (req, res) => {
    const { id, dept_id, name, role = '' } = req.body;
    if (!id || !dept_id || !name) {
        return res.status(400).json({ error: 'id, dept_id y name son obligatorios' });
    }
    try {
        await pool.query(
            'INSERT INTO employees (id, dept_id, name, role) VALUES (?, ?, ?, ?)',
            [id, dept_id, name, role]
        );
        res.status(201).json({ ok: true, id });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Ya existe un empleado con ese nombre en el área' });
        }
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/employees/:id
app.delete('/api/employees/:id', async (req, res) => {
    try {
        const [result] = await pool.query('DELETE FROM employees WHERE id = ?', [req.params.id]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Empleado no encontrado' });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── SCHEDULES ─────────────────────────────────────────────────────────────────
// GET /api/schedules?dept=ama_llaves&week_start=2026-03-02
app.get('/api/schedules', async (req, res) => {
    const { dept, week_start } = req.query;
    if (!dept || !week_start) {
        return res.status(400).json({ error: 'Parámetros dept y week_start son obligatorios' });
    }
    try {
        const [rows] = await pool.query(
            `SELECT s.employee_id, s.day_idx, s.active,
              TIME_FORMAT(s.start_time,  '%H:%i') AS start_time,
              TIME_FORMAT(s.end_time,    '%H:%i') AS end_time,
              TIME_FORMAT(s.comida_start,'%H:%i') AS comida_start,
              TIME_FORMAT(s.comida_end,  '%H:%i') AS comida_end,
              s.notes
       FROM schedules s
       INNER JOIN employees e ON e.id = s.employee_id
       WHERE e.dept_id = ? AND s.week_start = ?`,
            [dept, week_start]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/schedules  (upsert a single slot)
// Body: { employee_id, dept_id, week_start, day_idx, active, start_time, end_time, comida_start, comida_end, notes }
app.put('/api/schedules', async (req, res) => {
    const {
        employee_id, week_start, day_idx,
        active = 1,
        start_time = null,
        end_time = null,
        comida_start = null,
        comida_end = null,
        notes = '',
    } = req.body;

    if (!employee_id || !week_start || day_idx === undefined) {
        return res.status(400).json({ error: 'employee_id, week_start y day_idx son obligatorios' });
    }

    try {
        await pool.query(
            `INSERT INTO schedules
         (employee_id, dept_id, week_start, day_idx, active, start_time, end_time, comida_start, comida_end, notes)
       VALUES (?, (SELECT dept_id FROM employees WHERE id = ?), ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         active        = VALUES(active),
         start_time    = VALUES(start_time),
         end_time      = VALUES(end_time),
         comida_start  = VALUES(comida_start),
         comida_end    = VALUES(comida_end),
         notes         = VALUES(notes),
         updated_at    = NOW()`,
            [employee_id, employee_id, week_start, day_idx,
                active ? 1 : 0,
                active ? start_time : null,
                active ? end_time : null,
                active ? comida_start : null,
                active ? comida_end : null,
                notes]
        );
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── USERS ─────────────────────────────────────────────────────────────────────
// GET /api/users   – lista usuarios (sin password)
app.get('/api/users', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT id, username, created_at FROM users ORDER BY created_at DESC');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/users  – crear usuario  { username, password }
app.post('/api/users', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username y password son obligatorios' });
    if (password.length < 4) return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' });
    try {
        const hash = await bcrypt.hash(password, 10);
        const [result] = await pool.query(
            'INSERT INTO users (username, password_hash) VALUES (?, ?)',
            [username.trim(), hash]
        );
        res.status(201).json({ ok: true, id: result.insertId });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ese nombre de usuario ya existe' });
        res.status(500).json({ error: err.message });
    }
});

// POST /api/users/login  – verificar credenciales  { username, password }
app.post('/api/users/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Campos obligatorios' });
    try {
        const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username.trim()]);
        if (rows.length === 0) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
        const ok = await bcrypt.compare(password, rows[0].password_hash);
        if (!ok) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
        res.json({ ok: true, id: rows[0].id, username: rows[0].username });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/users/:id
app.delete('/api/users/:id', async (req, res) => {
    try {
        const [result] = await pool.query('DELETE FROM users WHERE id = ?', [req.params.id]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── START ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`✅  Servidor Huayacán corriendo en http://localhost:${PORT}`);
    console.log(`📋  Dashboard:   http://localhost:${PORT}/index.html`);
    console.log(`🔌  API Health:  http://localhost:${PORT}/api/health`);
});
