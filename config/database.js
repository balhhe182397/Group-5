const mysql = require('mysql2');

const pool = mysql.createPool({
    host: 'localhost',
    port: 3308,
    user: 'root',
    password: 'admin',
    database: 'library_management',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

module.exports = pool.promise(); 