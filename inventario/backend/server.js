require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./db');

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());

// Captura errores async y los devuelve como JSON
const h = (fn) => (req, res) =>
  fn(req, res).catch((e) => {
    console.error(e);
    res.status(500).json({ error: e.sqlMessage || e.message });
  });

const auth = (req, res, next) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'No autorizado' });
  }
};

app.get('/', (_, res) => res.json({ ok: true }));

app.post('/api/login', h(async (req, res) => {
  const { usuario, password } = req.body;
  const [rows] = await pool.query('SELECT * FROM usuarios WHERE usuario = ?', [usuario]);
  const u = rows[0];
  if (!u || !(await bcrypt.compare(password || '', u.password_hash)))
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  const token = jwt.sign({ id: u.id, usuario: u.usuario }, process.env.JWT_SECRET, { expiresIn: '8h' });
  res.json({ token });
}));

// CRUD genérico (tabla y campos son constantes del código, no vienen del cliente)
function crud(path, table, fields) {
  const r = express.Router();
  r.use(auth);
  r.get('/', h(async (_, res) => {
    const [rows] = await pool.query(`SELECT * FROM ${table} ORDER BY id DESC`);
    res.json(rows);
  }));
  r.post('/', h(async (req, res) => {
    const vals = fields.map((f) => req.body[f] ?? null);
    const [x] = await pool.query(
      `INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`, vals);
    res.status(201).json({ id: x.insertId });
  }));
  r.put('/:id', h(async (req, res) => {
    const vals = fields.map((f) => req.body[f] ?? null);
    await pool.query(`UPDATE ${table} SET ${fields.map((f) => f + '=?').join(',')} WHERE id=?`, [...vals, req.params.id]);
    res.json({ ok: true });
  }));
  r.delete('/:id', h(async (req, res) => {
    await pool.query(`DELETE FROM ${table} WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  }));
  app.use(path, r);
}

crud('/api/productos', 'productos', ['nombre', 'categoria', 'precio', 'stock']);
crud('/api/proveedores', 'proveedores', ['nombre', 'telefono', 'email', 'direccion']);

// Qué productos da cada proveedor
const sum = express.Router();
sum.use(auth);
sum.get('/', h(async (_, res) => {
  const [rows] = await pool.query(`
    SELECT s.id, s.proveedor_id, s.producto_id, s.precio_compra,
           pr.nombre AS proveedor, p.nombre AS producto
    FROM suministros s
    JOIN proveedores pr ON pr.id = s.proveedor_id
    JOIN productos p ON p.id = s.producto_id
    ORDER BY pr.nombre, p.nombre`);
  res.json(rows);
}));
sum.post('/', h(async (req, res) => {
  const { proveedor_id, producto_id, precio_compra } = req.body;
  const [x] = await pool.query(
    'INSERT INTO suministros (proveedor_id, producto_id, precio_compra) VALUES (?,?,?)',
    [proveedor_id, producto_id, precio_compra || 0]);
  res.status(201).json({ id: x.insertId });
}));
sum.delete('/:id', h(async (req, res) => {
  await pool.query('DELETE FROM suministros WHERE id=?', [req.params.id]);
  res.json({ ok: true });
}));
app.use('/api/suministros', sum);

app.listen(process.env.PORT || 3000, () => console.log('API lista'));
