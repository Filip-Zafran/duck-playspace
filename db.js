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
      { column: 'faq_title', type: 'VARCHAR(255)' },
      { column: 'location', type: 'VARCHAR(255)' }
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
        voter_email VARCHAR(255),
        choice VARCHAR(50),
        location_choice VARCHAR(255),
        submitted_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Add missing columns if they don't exist
    const voteColumnChecks = [
      { column: 'location_choice', type: 'VARCHAR(255)' },
      { column: 'voter_email', type: 'VARCHAR(255)' }
    ];

    for (const { column, type } of voteColumnChecks) {
      try {
        await pool.query(`ALTER TABLE votes ADD COLUMN ${column} ${type}`);
        console.log(`Added ${column} column to votes table`);
      } catch (err) {
        if (!err.message.includes('already exists')) {
          console.log(`${column} column already exists or other error: ${err.message}`);
        }
      }
    }

    // Create events table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        date VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create event_participation table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS event_participation (
        id SERIAL PRIMARY KEY,
        event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
        email VARCHAR(255) NOT NULL,
        invited BOOLEAN DEFAULT FALSE,
        invitation_date TIMESTAMP,
        responded BOOLEAN DEFAULT FALSE,
        response_date TIMESTAMP,
        status VARCHAR(50) DEFAULT 'waiting',
        attended BOOLEAN DEFAULT FALSE,
        paid BOOLEAN DEFAULT FALSE,
        amount DECIMAL(10, 2) DEFAULT 0,
        payment_date TIMESTAMP,
        free_entry BOOLEAN DEFAULT FALSE,
        referral BOOLEAN DEFAULT FALSE,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(event_id, email)
      )
    `);

    // Create participant_metadata table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS participant_metadata (
        email VARCHAR(255) PRIMARY KEY,
        status VARCHAR(50) DEFAULT 'Active',
        phone VARCHAR(20),
        tags JSONB DEFAULT '[]',
        internal_notes TEXT,
        total_attended INTEGER DEFAULT 0,
        total_paid DECIMAL(10, 2) DEFAULT 0,
        reward_tag VARCHAR(100),
        last_event_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create quiz table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS quizzes (
        id VARCHAR(36) PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        required_score_percent INTEGER DEFAULT 100,
        reward_location VARCHAR(255),
        reward_address TEXT,
        meeting_time VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create quiz_questions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS quiz_questions (
        id SERIAL PRIMARY KEY,
        quiz_id VARCHAR(36) REFERENCES quizzes(id) ON DELETE CASCADE,
        question_text TEXT NOT NULL,
        correct_answer VARCHAR(1) NOT NULL,
        explanation TEXT,
        display_order INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create quiz_options table for question choices
    await pool.query(`
      CREATE TABLE IF NOT EXISTS quiz_options (
        id SERIAL PRIMARY KEY,
        question_id INTEGER REFERENCES quiz_questions(id) ON DELETE CASCADE,
        option_letter VARCHAR(1) NOT NULL,
        option_text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create quiz_submissions table to track user progress
    await pool.query(`
      CREATE TABLE IF NOT EXISTS quiz_submissions (
        id SERIAL PRIMARY KEY,
        quiz_id VARCHAR(36) REFERENCES quizzes(id) ON DELETE CASCADE,
        voter_token VARCHAR(255),
        question_id INTEGER REFERENCES quiz_questions(id),
        selected_answer VARCHAR(1),
        is_correct BOOLEAN,
        submitted_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(quiz_id, voter_token, question_id)
      )
    `);

    console.log('Quiz tables initialized successfully');
    console.log('Dashboard tables initialized successfully');
    console.log('Database tables initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}

export function getPool() {
  return pool;
}
