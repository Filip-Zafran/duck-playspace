import pkg from 'pg';
const { Pool } = pkg;

let connectionString = process.env.DATABASE_URL;

// Convert postgres:// to postgresql:// for modern drivers
if (connectionString && connectionString.startsWith('postgres://')) {
  connectionString = connectionString.replace('postgres://', 'postgresql://');
}

// Fall back to individual DB_* env vars if DATABASE_URL not set
if (!connectionString) {
  connectionString = `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;
}

const pool = new Pool({
  connectionString,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

export async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS polls (
        id VARCHAR(36) PRIMARY KEY,
        admin_token VARCHAR(32) UNIQUE NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        duration VARCHAR(255),
        expected INTEGER DEFAULT 0,
        date1 VARCHAR(255) NOT NULL,
        time1 VARCHAR(5),
        date2 VARCHAR(255) NOT NULL,
        time2 VARCHAR(5),
        date3 VARCHAR(255) NOT NULL,
        time3 VARCHAR(5),
        timer_end TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS votes (
        id SERIAL PRIMARY KEY,
        poll_id VARCHAR(36) REFERENCES polls(id) ON DELETE CASCADE,
        voter_name VARCHAR(255),
        choice VARCHAR(50),
        submitted_at TIMESTAMP DEFAULT NOW()
      )
    `);

    console.log('Database tables initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}

export function getPool() {
  return pool;
}
