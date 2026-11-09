require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./db');

const app = express();
const permitidos = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((s) => s.trim().replace(/\/$/, ''))
  .filter(Boolean);
const esVercelDelProyecto = (o) => /^https:\/\/inventario-[a-z0-9-]+-dsa-inc\.vercel\.app$/.test(o);

app.use(cors({
  origin: (origin, cb) =>
    cb(null, !origin || !permitidos.length || permitidos.includes(origin) || esVercelDelProyecto(origin)),
}));
app.use(express.json());

const fail = (status, message) => Object.assign(new Error(message), { status });
const h = (fn) => (req, res) =>
  fn(req, res).catch((e) => {
    if (!e.status) console.error(e);
    res.status(e.status || 500).json({ error: e.status ? e.message : e.sqlMessage || e.message });
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
    throw fail(401, 'Usuario o contraseña incorrectos');
  const token = jwt.sign({ id: u.id, usuario: u.usuario }, process.env.JWT_SECRET, { expiresIn: '8h' });
  res.json({ token });
}));

// CRUD genérico (tabla y campos son constantes del código, no vienen del cliente)
function crud(path, table, fields, opts = {}) {
  const defaults = opts.defaults || {};
  const val = (body, f) => (body[f] === undefined || body[f] === null || body[f] === '' ? defaults[f] ?? null : body[f]);
  const r = express.Router();
  r.use(auth);
  r.get('/', h(async (_, res) => {
    const [rows] = await pool.query(opts.listSql || `SELECT * FROM ${table} ORDER BY id DESC`);
    res.json(rows);
  }));
  r.post('/', h(async (req, res) => {
    const vals = fields.map((f) => val(req.body, f));
    const [x] = await pool.query(
      `INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`, vals);
    res.status(201).json({ id: x.insertId });
  }));
  r.put('/:id', h(async (req, res) => {
    const vals = fields.map((f) => val(req.body, f));
    await pool.query(`UPDATE ${table} SET ${fields.map((f) => f + '=?').join(',')} WHERE id=?`, [...vals, req.params.id]);
    res.json({ ok: true });
  }));
  r.delete('/:id', h(async (req, res) => {
    if (opts.guardDelete) await opts.guardDelete(req.params.id);
    await pool.query(`DELETE FROM ${table} WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  }));
  app.use(path, r);
}

const STOCK_TOTAL = `CAST(COALESCE((SELECT SUM(e.cantidad) FROM existencias e WHERE e.producto_id = p.id), 0) AS SIGNED)`;

// Alta de producto con almacén y cantidad inicial
app.post('/api/productos', auth, h(async (req, res) => {
  const b = req.body;
  if (!b.nombre) throw fail(400, 'El nombre es obligatorio');
  const cant = b.cantidad_inicial === '' || b.cantidad_inicial == null ? 0 : Number(b.cantidad_inicial);
  const alm = Number(b.almacen_id) || null;
  if (!Number.isInteger(cant) || cant < 0) throw fail(400, 'La cantidad inicial debe ser un entero de 0 o más');
  if (cant > 0 && !alm) throw fail(400, 'Elige el almacén donde se guardará');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [x] = await conn.query(
      'INSERT INTO productos (nombre, categoria, precio, stock_minimo) VALUES (?,?,?,?)',
      [
        b.nombre,
        b.categoria || null,
        b.precio === '' || b.precio == null ? 0 : b.precio,
        b.stock_minimo === '' || b.stock_minimo == null ? 5 : b.stock_minimo,
      ]);
    if (cant > 0) {
      await conn.query(
        'INSERT INTO existencias (producto_id, almacen_id, cantidad) VALUES (?,?,?)', [x.insertId, alm, cant]);
      await conn.query(
        `INSERT INTO movimientos (tipo, producto_id, almacen_destino_id, cantidad, motivo, usuario)
         VALUES ('entrada',?,?,?,?,?)`, [x.insertId, alm, cant, 'Alta de producto', req.user.usuario]);
    }
    await conn.commit();
    res.status(201).json({ id: x.insertId });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}));

crud('/api/productos', 'productos', ['nombre', 'categoria', 'precio', 'stock_minimo'], {
  defaults: { precio: 0, stock_minimo: 5 },
  listSql: `SELECT p.*, ${STOCK_TOTAL} AS stock_total FROM productos p ORDER BY p.id DESC`,
});

crud('/api/almacenes', 'almacenes', ['nombre', 'ubicacion'], {
  guardDelete: async (id) => {
    const [[x]] = await pool.query('SELECT COALESCE(SUM(cantidad),0) AS total FROM existencias WHERE almacen_id = ?', [id]);
    if (Number(x.total) > 0) throw fail(400, 'Ese almacén todavía tiene productos. Múevelos a otro almacén antes de borrarlo.');
  },
});

crud('/api/proveedores', 'proveedores', ['nombre', 'telefono', 'email', 'direccion']);

// Dónde está cada producto
const ex = express.Router();
ex.use(auth);
ex.get('/', h(async (_, res) => {
  const [rows] = await pool.query(`
    SELECT e.producto_id, e.almacen_id, e.cantidad, p.nombre AS producto, a.nombre AS almacen
    FROM existencias e
    JOIN productos p ON p.id = e.producto_id
    JOIN almacenes a ON a.id = e.almacen_id
    WHERE e.cantidad > 0
    ORDER BY p.nombre, a.nombre`);
  res.json(rows);
}));
app.use('/api/existencias', ex);

// Productos con stock total igual o menor al mínimo
const al = express.Router();
al.use(auth);
al.get('/', h(async (_, res) => {
  const [rows] = await pool.query(`
    SELECT * FROM (
      SELECT p.id, p.nombre, p.stock_minimo, ${STOCK_TOTAL} AS stock_total FROM productos p
    ) t WHERE stock_total <= stock_minimo ORDER BY stock_total, nombre`);
  res.json(rows);
}));
app.use('/api/alertas', al);

// Movimientos: historial y registro (entrada, salida, traslado)
const mv = express.Router();
mv.use(auth);
mv.get('/', h(async (_, res) => {
  const [rows] = await pool.query(`
    SELECT m.id, m.tipo, m.cantidad, m.motivo, m.usuario, m.creado_en,
           p.nombre AS producto, ao.nombre AS origen, ad.nombre AS destino
    FROM movimientos m
    JOIN productos p ON p.id = m.producto_id
    LEFT JOIN almacenes ao ON ao.id = m.almacen_origen_id
    LEFT JOIN almacenes ad ON ad.id = m.almacen_destino_id
    ORDER BY m.id DESC LIMIT 200`);
  res.json(rows);
}));
mv.post('/', h(async (req, res) => {
  const { tipo, producto_id, motivo } = req.body;
  const cantidad = Number(req.body.cantidad);
  if (!['entrada', 'salida', 'traslado'].includes(tipo)) throw fail(400, 'Tipo de movimiento inválido');
  if (!producto_id) throw fail(400, 'Elige un producto');
  if (!Number.isInteger(cantidad) || cantidad <= 0) throw fail(400, 'La cantidad debe ser un entero mayor a 0');
  const origen = tipo === 'entrada' ? null : Number(req.body.almacen_origen_id) || null;
  const destino = tipo === 'salida' ? null : Number(req.body.almacen_destino_id) || null;
  if (tipo !== 'entrada' && !origen) throw fail(400, 'Elige el almacén de origen');
  if (tipo !== 'salida' && !destino) throw fail(400, 'Elige el almacén de destino');
  if (tipo === 'traslado' && origen === destino) throw fail(400, 'El origen y el destino deben ser distintos');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (origen) {
      const [rows] = await conn.query(
        'SELECT cantidad FROM existencias WHERE producto_id = ? AND almacen_id = ? FOR UPDATE', [producto_id, origen]);
      const disponible = rows[0] ? rows[0].cantidad : 0;
      if (disponible < cantidad) throw fail(400, `Stock insuficiente en el almacén de origen (disponible: ${disponible})`);
      await conn.query(
        'UPDATE existencias SET cantidad = cantidad - ? WHERE producto_id = ? AND almacen_id = ?', [cantidad, producto_id, origen]);
    }
    if (destino) {
      await conn.query(
        `INSERT INTO existencias (producto_id, almacen_id, cantidad) VALUES (?,?,?)
         ON DUPLICATE KEY UPDATE cantidad = cantidad + VALUES(cantidad)`, [producto_id, destino, cantidad]);
    }
    await conn.query(
      `INSERT INTO movimientos (tipo, producto_id, almacen_origen_id, almacen_destino_id, cantidad, motivo, usuario)
       VALUES (?,?,?,?,?,?,?)`,
      [tipo, producto_id, origen, destino, cantidad, motivo || null, req.user.usuario]);
    await conn.commit();
    res.status(201).json({ ok: true });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}));
app.use('/api/movimientos', mv);

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