import { useEffect, useState } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';

async function api(path, { method = 'GET', body } = {}) {
  const token = localStorage.getItem('token');
  const r = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }) },
    body: body && JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && token) { localStorage.removeItem('token'); location.reload(); }
  if (!r.ok) throw new Error(d.error || 'Error');
  return d;
}

function Login({ onLogin }) {
  const [f, setF] = useState({ usuario: '', password: '' });
  const [err, setErr] = useState('');
  const enviar = async () => {
    try {
      const { token } = await api('/api/login', { method: 'POST', body: f });
      localStorage.setItem('token', token);
      onLogin();
    } catch (e) { setErr(e.message); }
  };
  return (
    <div className="card login">
      <h2>Iniciar sesión</h2>
      <input placeholder="Usuario" value={f.usuario} onChange={(e) => setF({ ...f, usuario: e.target.value })} />
      <input type="password" placeholder="Contraseña" value={f.password}
        onChange={(e) => setF({ ...f, password: e.target.value })}
        onKeyDown={(e) => e.key === 'Enter' && enviar()} />
      <button onClick={enviar}>Entrar</button>
      {err && <p className="err">{err}</p>}
    </div>
  );
}

// Panel CRUD reutilizable. `extra` agrega columnas de solo lectura.
function Panel({ endpoint, fields, extra = [], onChange = () => {} }) {
  const vacio = Object.fromEntries(fields.map((f) => [f.key, '']));
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(vacio);
  const [editId, setEditId] = useState(null);
  const [err, setErr] = useState('');

  const cargar = () => api(endpoint).then(setRows).catch((e) => setErr(e.message));
  useEffect(() => { cargar(); }, [endpoint]);

  const guardar = async () => {
    try {
      setErr('');
      if (editId) await api(`${endpoint}/${editId}`, { method: 'PUT', body: form });
      else await api(endpoint, { method: 'POST', body: form });
      setForm(vacio); setEditId(null); cargar(); onChange();
    } catch (e) { setErr(e.message); }
  };
  const borrar = async (id) => {
    if (!confirm('¿Eliminar este registro?')) return;
    try { setErr(''); await api(`${endpoint}/${id}`, { method: 'DELETE' }); cargar(); onChange(); }
    catch (e) { setErr(e.message); }
  };
  const editar = (r) => { setEditId(r.id); setForm(Object.fromEntries(fields.map((f) => [f.key, r[f.key] ?? '']))); };

  return (
    <>
      <div className="card">
        <h3>{editId ? 'Editar' : 'Agregar'}</h3>
        {fields.map((f) => (
          <input key={f.key} type={f.type || 'text'} placeholder={f.label} title={f.label} value={form[f.key]}
            onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
        ))}
        <button onClick={guardar}>{editId ? 'Guardar cambios' : 'Agregar'}</button>{' '}
        {editId && <button className="sec" onClick={() => { setEditId(null); setForm(vacio); }}>Cancelar</button>}
        {err && <p className="err">{err}</p>}
      </div>
      <div className="card">
        <table>
          <thead><tr>
            {fields.map((f) => <th key={f.key}>{f.label}</th>)}
            {extra.map((c) => <th key={c.label}>{c.label}</th>)}<th></th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                {fields.map((f) => <td key={f.key}>{r[f.key]}</td>)}
                {extra.map((c) => <td key={c.label}>{c.render(r)}</td>)}
                <td>
                  <button className="sec" onClick={() => editar(r)}>Editar</button>{' '}
                  <button className="del" onClick={() => borrar(r.id)}>Borrar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// En qué almacén está cada producto
function Existencias() {
  const [prods, setProds] = useState([]);
  const [ex, setEx] = useState([]);
  const [q, setQ] = useState('');
  useEffect(() => {
    api('/api/productos').then(setProds);
    api('/api/existencias').then(setEx);
  }, []);
  const lista = prods.filter((p) => p.nombre.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="card">
      <h3>Dónde está cada producto</h3>
      <input placeholder="Buscar producto…" value={q} onChange={(e) => setQ(e.target.value)} />
      <table>
        <thead><tr><th>Producto</th><th>Total</th><th>Almacenes</th></tr></thead>
        <tbody>
          {lista.map((p) => (
            <tr key={p.id}>
              <td>{p.nombre}</td>
              <td>{p.stock_total}</td>
              <td>
                {ex.filter((e) => e.producto_id === p.id).map((e) => (
                  <span key={e.almacen_id} className="chip">{e.almacen}: {e.cantidad}</span>
                ))}
                {p.stock_total === 0 && <span className="muted">Sin existencias</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TIPOS = { entrada: 'Entrada (ingresa a un almacén)', salida: 'Salida (sale de un almacén)', traslado: 'Traslado entre almacenes' };

// Registrar movimientos e historial
function Movimientos({ onChange }) {
  const vacio = { tipo: 'entrada', producto_id: '', almacen_origen_id: '', almacen_destino_id: '', cantidad: '', motivo: '' };
  const [form, setForm] = useState(vacio);
  const [prods, setProds] = useState([]);
  const [alms, setAlms] = useState([]);
  const [ex, setEx] = useState([]);
  const [hist, setHist] = useState([]);
  const [err, setErr] = useState('');

  const cargar = () => {
    api('/api/productos').then(setProds);
    api('/api/existencias').then(setEx);
    api('/api/movimientos').then(setHist);
  };
  useEffect(() => { api('/api/almacenes').then(setAlms); cargar(); }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const usaOrigen = form.tipo !== 'entrada';
  const usaDestino = form.tipo !== 'salida';
  const disp = ex.find((e) => String(e.producto_id) === String(form.producto_id) && String(e.almacen_id) === String(form.almacen_origen_id));

  const registrar = async () => {
    try {
      setErr('');
      await api('/api/movimientos', { method: 'POST', body: form });
      setForm({ ...vacio, tipo: form.tipo }); cargar(); onChange();
    } catch (e) { setErr(e.message); }
  };

  return (
    <>
      <div className="card">
        <h3>Registrar movimiento</h3>
        <select value={form.tipo} onChange={set('tipo')}>
          {Object.entries(TIPOS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select value={form.producto_id} onChange={set('producto_id')}>
          <option value="">Producto…</option>
          {prods.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
        {usaOrigen && (
          <select value={form.almacen_origen_id} onChange={set('almacen_origen_id')}>
            <option value="">Almacén de origen…</option>
            {alms.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </select>
        )}
        {usaDestino && (
          <select value={form.almacen_destino_id} onChange={set('almacen_destino_id')}>
            <option value="">Almacén de destino…</option>
            {alms.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </select>
        )}
        <input type="number" min="1" placeholder="Cantidad" value={form.cantidad} onChange={set('cantidad')} />
        <input placeholder="Motivo (opcional)" value={form.motivo} onChange={set('motivo')} />
        <button onClick={registrar}>Registrar</button>
        {usaOrigen && form.producto_id && form.almacen_origen_id &&
          <p className="muted">Disponible en el origen: {disp ? disp.cantidad : 0}</p>}
        {err && <p className="err">{err}</p>}
      </div>
      <div className="card">
        <h3>Historial</h3>
        <table>
          <thead><tr><th>Fecha</th><th>Tipo</th><th>Producto</th><th>Cant.</th><th>Origen</th><th>Destino</th><th>Motivo</th><th>Usuario</th></tr></thead>
          <tbody>
            {hist.map((m) => (
              <tr key={m.id}>
                <td>{new Date(m.creado_en).toLocaleString('es-MX')}</td>
                <td><span className={'tag ' + m.tipo}>{m.tipo}</span></td>
                <td>{m.producto}</td><td>{m.cantidad}</td>
                <td>{m.origen || '—'}</td><td>{m.destino || '—'}</td>
                <td>{m.motivo}</td><td>{m.usuario}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// Qué productos suministra cada proveedor
function Suministros() {
  const [rows, setRows] = useState([]);
  const [provs, setProvs] = useState([]);
  const [prods, setProds] = useState([]);
  const [form, setForm] = useState({ proveedor_id: '', producto_id: '', precio_compra: '' });
  const [err, setErr] = useState('');

  const cargar = () => {
    api('/api/suministros').then(setRows);
    api('/api/proveedores').then(setProvs);
    api('/api/productos').then(setProds);
  };
  useEffect(() => { cargar(); }, []);

  const agregar = async () => {
    try {
      setErr('');
      await api('/api/suministros', { method: 'POST', body: form });
      setForm({ proveedor_id: '', producto_id: '', precio_compra: '' }); cargar();
    } catch (e) { setErr(e.message); }
  };

  return (
    <>
      <div className="card">
        <h3>Asignar producto a proveedor</h3>
        <select value={form.proveedor_id} onChange={(e) => setForm({ ...form, proveedor_id: e.target.value })}>
          <option value="">Proveedor…</option>
          {provs.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
        <select value={form.producto_id} onChange={(e) => setForm({ ...form, producto_id: e.target.value })}>
          <option value="">Producto…</option>
          {prods.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
        <input type="number" placeholder="Precio de compra" value={form.precio_compra}
          onChange={(e) => setForm({ ...form, precio_compra: e.target.value })} />
        <button onClick={agregar}>Asignar</button>
        {err && <p className="err">{err}</p>}
      </div>
      <div className="card">
        <table>
          <thead><tr><th>Proveedor</th><th>Producto</th><th>Precio compra</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.proveedor}</td><td>{r.producto}</td><td>{r.precio_compra}</td>
                <td><button className="del" onClick={async () => { await api('/api/suministros/' + r.id, { method: 'DELETE' }); cargar(); }}>Quitar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const PRODUCTOS = [
  { key: 'nombre', label: 'Nombre' },
  { key: 'categoria', label: 'Categoría' },
  { key: 'precio', label: 'Precio', type: 'number' },
  { key: 'stock_minimo', label: 'Stock mínimo', type: 'number' },
];
const ALMACENES = [
  { key: 'nombre', label: 'Nombre' },
  { key: 'ubicacion', label: 'Ubicación' },
];
const PROVEEDORES = [
  { key: 'nombre', label: 'Nombre' },
  { key: 'telefono', label: 'Teléfono' },
  { key: 'email', label: 'Email' },
  { key: 'direccion', label: 'Dirección' },
];
const EXTRA_PRODUCTOS = [
  { label: 'Stock total', render: (r) => r.stock_total },
  { label: 'Estado', render: (r) => (
    <span className={'tag ' + (r.stock_total <= r.stock_minimo ? 'bajo' : 'ok')}>
      {r.stock_total <= r.stock_minimo ? 'Bajo' : 'OK'}
    </span>
  ) },
];

export default function App() {
  const [logged, setLogged] = useState(!!localStorage.getItem('token'));
  const [tab, setTab] = useState('productos');
  const [alertas, setAlertas] = useState([]);

  const cargarAlertas = () => {
    if (localStorage.getItem('token')) api('/api/alertas').then(setAlertas).catch(() => {});
  };
  useEffect(() => { if (logged) cargarAlertas(); }, [logged, tab]);

  if (!logged) return <Login onLogin={() => setLogged(true)} />;

  const tabs = [
    ['productos', 'Inventario'], ['existencias', 'Dónde está'], ['movimientos', 'Movimientos'],
    ['almacenes', 'Almacenes'], ['proveedores', 'Proveedores'], ['suministros', 'Qué productos dan'],
  ];
  return (
    <>
      <header>
        <h1>Inventario</h1>
        {tabs.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
        <button onClick={() => { localStorage.removeItem('token'); setLogged(false); }}>Salir</button>
      </header>
      <main>
        {alertas.length > 0 && (
          <div className="banner">
            Stock bajo en {alertas.length} producto(s):{' '}
            {alertas.slice(0, 5).map((a) => `${a.nombre} (${a.stock_total}/${a.stock_minimo})`).join(', ')}
            {alertas.length > 5 ? '…' : ''}
          </div>
        )}
        {tab === 'productos' && <Panel endpoint="/api/productos" fields={PRODUCTOS} extra={EXTRA_PRODUCTOS} onChange={cargarAlertas} />}
        {tab === 'existencias' && <Existencias />}
        {tab === 'movimientos' && <Movimientos onChange={cargarAlertas} />}
        {tab === 'almacenes' && <Panel endpoint="/api/almacenes" fields={ALMACENES} />}
        {tab === 'proveedores' && <Panel endpoint="/api/proveedores" fields={PROVEEDORES} />}
        {tab === 'suministros' && <Suministros />}
      </main>
    </>
  );
}