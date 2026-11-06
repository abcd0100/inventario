# Inventario (React + Node/Express + MySQL)

## 1. Base de datos en la nube (MySQL)
Crea una base MySQL gratuita (p. ej. TiDB Cloud Serverless o Aiven) y copia host, puerto, usuario y contraseña.
Ejecuta `backend/schema.sql` en su consola SQL (o desde MySQL Workbench / DBeaver conectándote a la nube).
Desde ese mismo cliente puedes modificar la base cuando quieras.

## 2. Backend local
cd backend && cp .env.example .env   (llena los datos)
npm install
npm run seed -- admin TuContraseña    (crea el usuario de login)
npm start

## 3. Frontend local
cd frontend && cp .env.example .env
npm install && npm run dev

## 4. Despliegue en la nube
- Backend: Render (Web Service, root `backend`, build `npm install`, start `npm start`). Variables de entorno = las de .env, con FRONTEND_URL = URL del frontend.
- Frontend: Vercel o Netlify (root `frontend`, build `npm run build`, salida `dist`). Variable VITE_API_URL = URL del backend.
