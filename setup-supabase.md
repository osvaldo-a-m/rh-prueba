# Configuración Supabase — Portal RH Huayacán

## 1. Crear el proyecto

1. Ve a [app.supabase.com](https://app.supabase.com) → **New Project**
2. Elige un nombre (ej: `huayacan-rh`) y una contraseña de BD segura
3. Región recomendada: **US East** o la más cercana a México
4. Espera ~2 minutos a que el proyecto esté listo

---

## 2. Obtener credenciales

1. Ve a **Settings → API**
2. Copia:
   - **Project URL** → `https://xxxxxxxx.supabase.co`
   - **anon / public key** → clave larga que empieza con `eyJ...`
3. Pégalas en `supabase.js`:

```javascript
const SUPABASE_URL = 'https://TU-PROYECTO.supabase.co';
const SUPABASE_ANON_KEY = 'TU-ANON-KEY';
```

---

## 3. Crear las tablas SQL

Ve a **SQL Editor** en el dashboard de Supabase y ejecuta:

```sql
-- TABLA: profiles (datos personales de empleados y admins)
CREATE TABLE public.profiles (
  id              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre_completo text,
  edad            int,
  direccion       text,
  telefono        text,
  email_contacto  text,
  video_visto     boolean DEFAULT false,
  onboarding_completo boolean DEFAULT false,
  role            text DEFAULT 'employee' CHECK (role IN ('employee','admin')),
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- TABLA: documents (referencias a archivos en Storage)
CREATE TABLE public.documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  tipo          text NOT NULL,
  es_obligatorio boolean DEFAULT true,
  storage_path  text,
  file_name     text,
  file_size     int,
  uploaded_at   timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  UNIQUE (employee_id, tipo)
);

-- Auto-crear perfil al registrarse (trigger)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id)
  VALUES (new.id)
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

---

## 4. Activar Row Level Security (RLS)

```sql
-- Activar RLS en ambas tablas
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

-- Políticas para profiles
CREATE POLICY "users_own_profile" ON public.profiles
  FOR ALL USING (auth.uid() = id);

CREATE POLICY "admin_all_profiles" ON public.profiles
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Políticas para documents
CREATE POLICY "users_own_docs" ON public.documents
  FOR ALL USING (auth.uid() = employee_id);

CREATE POLICY "admin_all_docs" ON public.documents
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
```

---

## 5. Crear el bucket de Storage

1. Ve a **Storage → New Bucket**
2. Nombre: `expedientes`
3. Desactiva **Public Bucket** (debe ser privado)
4. Clic en **Save**

### Políticas del bucket

En **Storage → Policies → expedientes**, ejecuta:

```sql
-- Empleado puede subir solo a su propio folder
CREATE POLICY "upload_own" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'expedientes' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

-- Empleado puede actualizar sus propios archivos
CREATE POLICY "update_own" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'expedientes' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

-- Empleado lee sus archivos; admin lee todos
CREATE POLICY "read_own_or_admin" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'expedientes' AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    )
  );
```

---

## 6. Crear la función RPC para crear empleados

Desde el panel admin, se crea un usuario con email+contraseña. Esto requiere la **service_role key** que no debe estar en el frontend. La solución es una **Edge Function** o una **función RPC con SECURITY DEFINER**:

```sql
-- Función RPC para que el admin cree usuarios (SECURITY DEFINER ejecuta como superuser)
CREATE OR REPLACE FUNCTION public.create_employee(p_email text, p_password text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_user_id uuid;
BEGIN
  -- Solo admins pueden llamar esta función
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  -- Crear usuario en auth.users
  SELECT id INTO new_user_id FROM auth.users WHERE email = p_email;
  IF new_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'Ya existe un usuario con ese correo';
  END IF;

  -- Usar la función interna de Supabase Auth
  new_user_id := extensions.uuid_generate_v4();
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, role)
  VALUES (
    new_user_id,
    p_email,
    crypt(p_password, gen_salt('bf')),
    now(),
    'authenticated'
  );

  -- El trigger handle_new_user creará el perfil automáticamente
  RETURN json_build_object('user_id', new_user_id, 'email', p_email);
END;
$$;
```

> [!IMPORTANT]
> Si la función RPC no funciona en tu versión de Supabase, la alternativa es usar la **Admin API de Supabase** desde un servidor/Edge Function con la `service_role` key. Nunca expongas la `service_role` key en el frontend.

---

## 7. Crear los super admins

```sql
-- Opción 1: El primer admin se crea desde el dashboard de Supabase
-- Authentication → Users → Add User

-- Opción 2: SQL directo
-- Primero crea el usuario desde el dashboard, luego:
UPDATE public.profiles
SET role = 'admin'
WHERE id = 'UUID-DEL-USUARIO-ADMIN';
```

---

## 8. Verificar la conexión

Abre `index.html` en tu navegador y prueba el login con las credenciales creadas.

Si hay errores de CORS, ve a **Settings → API → Allowed Origins** y agrega `http://localhost` o la URL de tu hosting.
