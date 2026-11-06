// Uso: node seed.js admin MiContraseña
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./db');

(async () => {
  const [usuario, password] = process.argv.slice(2);
  if (!usuario || !password) {
    console.log('Uso: node seed.js <usuario> <contraseña>');
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    'INSERT INTO usuarios (usuario, password_hash) VALUES (?, ?) ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)',
    [usuario, hash]
  );
  console.log('Usuario listo:', usuario);
  process.exit(0);
})();
