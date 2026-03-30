# Huayacán · Dashboard de Horarios

> Control de turnos por área con base de datos MySQL y exportación en formato Excel.

---

## 📁 Estructura de archivos

```
dashboard horarios/
├── index.html        ← Interfaz principal
├── styles.css        ← Diseño dark mode
├── app.js            ← Lógica del frontend (API + localStorage fallback)
├── server.js         ← Servidor Node.js + Express (conecta a MySQL)
├── schema.sql        ← Script para crear la base de datos
├── package.json      ← Dependencias Node.js
├── .env.example      ← Plantilla de variables de entorno
└── README.md         ← Este archivo
```

---

## 🚀 Instalación paso a paso

### 1. Instalar Node.js (si no lo tienes)
Descárgalo en → [https://nodejs.org](https://nodejs.org) (versión LTS)

Verifica que esté instalado:
```bash
node -v
npm -v
```

---

### 2. Instalar dependencias del proyecto
Abre una terminal, navega a la carpeta del proyecto y ejecuta:
```bash
cd "/Users/osvaldoaguilar/Desktop/dashboard horarios"
npm install
```

Esto instala: `express`, `mysql2`, `cors`, `dotenv`, `nodemon`.

---

### 3. Crear la base de datos en MySQL

Conéctate a MySQL (con MySQL Workbench, TablePlus, DBeaver, o desde terminal):
```sql
mysql -u root -p
```

Ejecuta el script de schema:
```bash
mysql -u root -p < schema.sql
```

O copia y pega el contenido de `schema.sql` directamente en tu cliente MySQL.

Esto crea:
- Base de datos `huayacan_horarios`
- Tabla `departments` (con los 5 departamentos precargados)
- Tabla `employees`
- Tabla `schedules`

---

### 4. Configurar las credenciales de MySQL

Copia el archivo de ejemplo y edítalo:
```bash
cp .env.example .env
```

Abre `.env` y llena tus datos reales:
```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=tu_password_aqui
DB_NAME=huayacan_horarios
PORT=3000
CORS_ORIGIN=*
```

---

### 5. Iniciar el servidor
```bash
node server.js
```

Para desarrollo con reinicio automático:
```bash
npm run dev
```

Verás en la terminal:
```
✅  Servidor Huayacán corriendo en http://localhost:3000
📋  Dashboard:   http://localhost:3000/index.html
🔌  API Health:  http://localhost:3000/api/health
```

---

### 6. Abrir el dashboard
Abre tu navegador y ve a:
```
http://localhost:3000
```

> ⚠️ **Importante:** Abre la URL `http://localhost:3000` (NO el archivo directamente con `file://`).  
> Si ves el badge **"MySQL · Conectado"** en la esquina superior, la conexión está funcionando.

---

## 🔌 Endpoints de la API

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/health` | Verifica que el servidor y MySQL estén vivos |
| `GET` | `/api/departments` | Lista los 5 departamentos |
| `GET` | `/api/employees?dept=ID` | Empleados de un área |
| `POST` | `/api/employees` | Agregar empleado |
| `DELETE` | `/api/employees/:id` | Eliminar empleado |
| `GET` | `/api/schedules?dept=ID&week_start=YYYY-MM-DD` | Horarios de la semana |
| `PUT` | `/api/schedules` | Guardar / actualizar un turno |

---

## 🔄 Modo sin servidor (localStorage)

Si el servidor **no está corriendo**, el dashboard funciona automáticamente en modo **localStorage**: los datos se guardan en el navegador de forma local.

El badge en el header indica el modo activo:
- 🟢 **MySQL · Conectado** → datos guardados en la base de datos
- 🟡 **localStorage · Local** → datos guardados solo en el navegador

---

## 🖨️ Exportar hoja de horarios

1. Selecciona el área en los tabs
2. Asegúrate de tener todos los turnos de la semana asignados
3. Haz clic en **"Exportar hoja"**
4. En la nueva pestaña, haz clic en **"Imprimir / Guardar PDF"**

El formato exportado incluye: Área, rango de fechas, nombre del hotel, tabla con **ENTRADA · SALIDA · COMIDA · DESCANSO · FIRMA** para cada empleado (2 por fila).

---

## ⚙️ Configuración avanzada en `app.js`

```js
const CONFIG = {
  API_BASE: '',      // '' si abres desde http://localhost:3000
                     // 'http://localhost:3000' si abres como archivo local
  USE_API: true,     // false → fuerza modo localStorage siempre
};
```

---

## 🛠️ Requisitos

| Herramienta | Versión mínima |
|---|---|
| Node.js | 18+ |
| MySQL | 5.7+ / 8.x |
| Navegador | Chrome, Edge, Firefox (moderno) |
