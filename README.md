# Fiberlink SIGOST — Sistema funcional

Proyecto separado en **un backend** y **dos frontends** que consumen la misma API:

- `backend/`: API REST y almacenamiento local JSON.
- `frontend-admin/`: panel administrativo para oficina.
- `frontend-tecnico/`: aplicación móvil/PWA para técnicos.

No necesita instalar paquetes con npm. Solo requiere **Node.js 18 o superior**.

## Inicio rápido en Windows

1. Descomprime el ZIP.
2. Ejecuta `iniciar-windows.bat`.
3. Se abrirán:
   - Administración: http://localhost:5173
   - Técnico: http://localhost:5174
   - API: http://localhost:4000/api/health

## Usuarios

### Administrador
- Correo: `admin@fiberlink.pe`
- Contraseña: `admin123`

### Técnico
- Correo: `tecnico@fiberlink.pe`
- Contraseña: `tecnico123`

## Funcionalidades incluidas

### Backend único
- Login por rol y sesiones con token.
- API para clientes, técnicos, materiales y órdenes.
- Crear, editar y eliminar registros administrativos.
- Iniciar y finalizar órdenes desde la aplicación técnica.
- Descuento automático del inventario al finalizar una orden.
- Subida y almacenamiento de fotografías.
- Firma del cliente guardada con la orden.
- Auditoría de acciones.
- Datos persistentes en `backend/data/db.json`.

### Panel administrativo
- Dashboard e indicadores.
- Órdenes con búsqueda y filtros.
- Creación, detalle y edición de órdenes.
- CRUD de clientes, técnicos y materiales.
- Reportes operativos y alertas de stock.
- Historial de auditoría.
- Diseño Fiberlink para servicios FTTH y fibra óptica.

### Aplicación del técnico
- Login exclusivo para técnico.
- Inicio con resumen de órdenes.
- Órdenes asignadas por estado.
- Detalle del cliente y del servicio.
- Ruta a Google Maps.
- Inicio de atención.
- Registro de diagnóstico y observaciones.
- Captura de fotografías desde cámara o galería.
- Selección de materiales y cantidades.
- Firma digital en pantalla.
- Finalización de orden.
- Historial y perfil.

## Datos y respaldo

El archivo `backend/data/db.json` es la base de datos local. Haz una copia para respaldar la información. Las imágenes se guardan en `backend/uploads/`.

## Producción

Esta versión es completamente funcional como prototipo/MVP local. Para producción empresarial se recomienda reemplazar JSON por PostgreSQL, cifrar las contraseñas, usar almacenamiento de imágenes en la nube, HTTPS y copias de seguridad automáticas.
