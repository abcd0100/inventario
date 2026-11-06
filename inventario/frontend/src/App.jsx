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

// Panel CRUD reutilizable (productos y proveedores)
function Panel({ endpoint, fields }) {
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
      setForm(vacio); setEditId(null); cargar();
    } catch (e) { setErr(e.message); }
  };
  const borrar = async (id) => {
    if (!confirm('¿Eliminar este registro?')) return;
    await api(`${endpoint}/${id}`, { method: 'DELETE' }); cargar();
  };
  const editar = (r) => { setEditId(r.id); setForm(Object.fromEntries(fields.map((f) => [f.key, r[f.key] ?? '']))); };

  return (
    <>
      <div className="card">
        <h3>{editId ? 'Editar' : 'Agregar'}</h3>
        {fields.map((f) => (
          <input key={f.key} type={f.type || 'text'} placeholder={f.label} value={form[f.key]}
            onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
        ))}
        <button onClick={guardar}>{editId ? 'Guardar cambios' : 'Agregar'}</button>{' '}
        {editId && <button className="sec" onClick={() => { setEditId(null); setForm(vacio); }}>Cancelar</button>}
        {err && <p className="err">{err}</p>}
      </div>
      <div className="card">
        <table>
          <thead><tr>{fields.map((f) => <th key={f.key}>{f.label}</th>)}<th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                {fields.map((f) => <td key={f.key}>{r[f.key]}</td>)}
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
  { key: 'stock', label: 'Stock', type: 'number' },
];
const PROVEEDORES = [
  { key: 'nombre', label: 'Nombre' },
  { key: 'telefono', label: 'Teléfono' },
  { key: 'email', label: 'Email' },
  { key: 'direccion', label: 'Dirección' },
];

export default function App() {
  const [logged, setLogged] = useState(!!localStorage.getItem('token'));
  const [tab, setTab] = useState('productos');

  if (!logged) return <Login onLogin={() => setLogged(true)} />;

  const tabs = [['productos', 'Inventario'], ['proveedores', 'Proveedores'], ['suministros', 'Qué productos dan']];
  return (
    <>
      <header>
        <h1>Inventario</h1>
        {tabs.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
        <button onClick={() => { localStorage.removeItem('token'); setLogged(false); }}>Salir</button>
      </header>
      <main>
        {tab === 'productos' && <Panel endpoint="/api/productos" fields={PRODUCTOS} />}
        {tab === 'proveedores' && <Panel endpoint="/api/proveedores" fields={PROVEEDORES} />}
        {tab === 'suministros' && <Suministros />}
      </main>
    </>
  );
}
