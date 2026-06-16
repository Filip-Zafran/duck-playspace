import pkg from 'pg';
const { Pool } = pkg;

let connectionString = process.env.DATABASE_URL;

console.log('DATABASE_URL env var exists:', !!process.env.DATABASE_URL);
console.log('DATABASE_URL first 30 chars:', connectionString?.substring(0, 30) || 'not set');

// Convert postgres:// to postgresql:// for modern drivers
if (connectionString && connectionString.startsWith('postgres://')) {
  connectionString = connectionString.replace('postgres://', 'postgresql://');
  console.log('Converted postgres:// to postgresql://');
}

// Fall back to individual DB_* env vars if DATABASE_URL not set
if (!connectionString) {
  console.log('Using individual DB_* env vars');
  connectionString = `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;
}

console.log('Final connection string format:', connectionString?.substring(0, 30) || 'empty');

const pool = new Pool({
  connectionString,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000
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
        about_section TEXT,
        participation_section TEXT,
        important_section TEXT,
        faq_link VARCHAR(500),
        faq_title VARCHAR(255) DEFAULT 'Read the FAQs',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Add missing columns if they don't exist
    const columnChecks = [
      { column: 'about_section', type: 'TEXT' },
      { column: 'participation_section', type: 'TEXT' },
      { column: 'important_section', type: 'TEXT' },
      { column: 'faq_link', type: 'VARCHAR(500)' },
      { column: 'faq_title', type: 'VARCHAR(255)' }
    ];

    for (const { column, type } of columnChecks) {
      try {
        await pool.query(`
          ALTER TABLE polls ADD COLUMN ${column} ${type}
          ${column === 'faq_title' ? "DEFAULT 'Read the FAQs'" : ''}
        `);
        console.log(`Added column ${column} to polls table`);
      } catch (err) {
        // Column likely already exists
        if (!err.message.includes('already exists')) {
          console.log(`Column ${column} already exists or other error: ${err.message}`);
        }
      }
    }

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
