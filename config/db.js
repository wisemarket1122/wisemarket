import mysql from "mysql2/promise";
const db = mysql.createPool({
  host: "localhost",
  user: "campus_user",
  password: "WiseMarket123!",
  database: "campus_market_db",
  waitForConnections: true,
  connectionLimit: 10,
});

export default db;
