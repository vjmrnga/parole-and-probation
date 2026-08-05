const mysql = require('mysql2/promise');

let pool = null;

function init(mysqlConfig) {
  if (pool) pool.end().catch(() => {});
  pool = mysql.createPool({
    host: mysqlConfig.host,
    port: mysqlConfig.port,
    user: mysqlConfig.user,
    password: mysqlConfig.password,
    database: mysqlConfig.database,
    waitForConnections: true,
    connectionLimit: 10,
    dateStrings: true,
  });
  return pool;
}

function getPool() {
  if (!pool) throw new Error('DB pool not initialized — call db.init(mysqlConfig) first');
  return pool;
}

async function testConnection(mysqlConfig) {
  const testPool = mysql.createPool({ ...mysqlConfig, waitForConnections: true, connectionLimit: 1 });
  try {
    await testPool.query('SELECT 1');
  } finally {
    await testPool.end();
  }
}

module.exports = { init, getPool, testConnection };
