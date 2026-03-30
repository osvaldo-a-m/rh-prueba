# Encriptación de Datos — Portal RH Huayacán

## Lo que ya hace Supabase por defecto

Supabase protege tus datos en dos capas sin configuración adicional:

| Capa | Mecanismo | Alcance |
|---|---|---|
| **En tránsito** | HTTPS / TLS 1.3 | Datos en movimiento (browser ↔ Supabase) |
| **En reposo** | AES-256 (AWS) | Archivos en Storage y datos en PostgreSQL |

> Esto significa que los archivos que suban los empleados ya están cifrados en los servidores de Supabase. **Nadie puede acceder a los archivos raw en el disco sin las claves de AWS.**

---

## Row Level Security (RLS) — el control de acceso

RLS es la capa más importante para este proyecto. Garantiza que:
- Un empleado **solo puede ver y subir sus propios archivos**.
- Solo un admin puede ver los datos de todos los empleados.

```sql
-- Política: empleado ve solo sus documentos
CREATE POLICY "employees_own_docs" ON documents
  FOR ALL USING (auth.uid() = employee_id);

-- Política: admin ve todo
CREATE POLICY "admin_all_docs" ON documents
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );
```

---

## Cifrado adicional del lado del cliente (End-to-End)

> [!WARNING]
> Esta opción agrega complejidad significativa y tiene limitaciones importantes.

### ¿Qué es?
Cifrar el archivo **en el navegador** antes de subirlo a Supabase, de modo que ni siquiera Supabase puede leer el contenido.

### ¿Cómo funciona?

```javascript
// Ejemplo con Web Crypto API (nativa del navegador, sin dependencias)
async function encryptFile(file, password) {
  const key = await deriveKey(password);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const buffer = await file.arrayBuffer();
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    buffer
  );
  // Guardar: iv + encrypted bytes juntos
  const combined = new Uint8Array(iv.byteLength + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.byteLength);
  return new Blob([combined]);
}

async function deriveKey(password) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('huayacan-rh'), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}
```

### ❌ Limitaciones críticas

1. **El admin no puede ver los archivos cifrados** sin conocer la clave de cada empleado — destruye la funcionalidad del expediente.
2. **Si el empleado olvida su contraseña, los archivos son irrecuperables** — no hay "recuperar contraseña" para cifrado E2E real.
3. **No se puede previsualizar** directamente desde el portal: hay que descargar y descifrar primero.
4. **Gestión de claves es compleja**: ¿dónde guardas la clave de cada empleado? Si la guardas en la BD, pierdes el sentido del E2E.

### ✅ Recomendación actual

Para el caso de uso de este portal (documentos de RH que el admin debe poder revisar):

**La combinación `HTTPS + AES-256 en reposo + RLS de Supabase` es suficiente y adecuada.**

El cifrado E2E solo vale la pena si los documentos deben ser absolutamente privados incluso del propio equipo de RH, lo que contradice el flujo del expediente.

---

## Configuración RLS recomendada en Supabase

Activa RLS en cada tabla y bucket. Ver `setup-supabase.md` para el SQL completo.

### Storage bucket `expedientes`

```sql
-- En el dashboard de Supabase: Storage → Policies
-- Empleado sube a su propio folder
CREATE POLICY "upload_own" ON storage.objects
  FOR INSERT WITH CHECK (auth.uid()::text = (storage.foldername(name))[1]);

-- Empleado y admin leen archivos del empleado
CREATE POLICY "read_own" ON storage.objects
  FOR SELECT USING (
    auth.uid()::text = (storage.foldername(name))[1]
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );
```
