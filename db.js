import pkg from 'pg';
const { Pool } = pkg;

const databaseUrl = process.env.DATABASE_URL?.trim();
let connectionString = databaseUrl;

// Convert postgres:// to postgresql:// for modern drivers
if (connectionString && connectionString.startsWith('postgres://')) {
  connectionString = connectionString.replace('postgres://', 'postgresql://');
}

// Fall back to individual DB_* env vars if DATABASE_URL not set
if (!connectionString) {
  const requiredVariables = ['DB_USER', 'DB_PASSWORD', 'DB_HOST', 'DB_PORT', 'DB_NAME'];
  const missingVariables = requiredVariables.filter((name) => !process.env[name]);

  if (missingVariables.length > 0) {
    throw new Error(
      `Database configuration is missing. Set DATABASE_URL or all of: ${requiredVariables.join(', ')}`
    );
  }

  connectionString = `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;
}

const pool = new Pool({
  connectionString,
  // Render services expose RENDER_SERVICE_ID. Keep local database connections
  // unencrypted while allowing Render Postgres' internal URL to use TLS.
  ssl: process.env.RENDER_SERVICE_ID ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000
});

export async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS imported_data (
        id SERIAL PRIMARY KEY,
        data JSONB NOT NULL,
        data_hash VARCHAR(64) UNIQUE NOT NULL,
        imported_at TIMESTAMP DEFAULT NOW()
      )
    `);

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
        is_closed BOOLEAN DEFAULT FALSE,
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
      { column: 'location', type: 'VARCHAR(255)' },
      { column: 'is_closed', type: 'BOOLEAN DEFAULT FALSE' }
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

    await pool.query(`
      CREATE TABLE IF NOT EXISTS feedback_forms (
        id VARCHAR(36) PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        event_name VARCHAR(255),
        submission_message TEXT,
        results_share_token VARCHAR(64) UNIQUE,
        is_anonymous BOOLEAN DEFAULT TRUE,
        questions JSONB NOT NULL DEFAULT '[]'::jsonb,
        timer_end TIMESTAMP,
        is_closed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    const feedbackColumnChecks = [
      { column: 'event_name', type: 'VARCHAR(255)' },
      { column: 'submission_message', type: 'TEXT' },
      { column: 'results_share_token', type: 'VARCHAR(64) UNIQUE' }
    ];
    for (const { column, type } of feedbackColumnChecks) {
      try {
        await pool.query(`ALTER TABLE feedback_forms ADD COLUMN ${column} ${type}`);
      } catch (err) {
        if (!err.message.includes('already exists')) {
          console.log(`Could not add feedback column ${column}: ${err.message}`);
        }
      }
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS feedback_responses (
        id SERIAL PRIMARY KEY,
        feedback_id VARCHAR(36) REFERENCES feedback_forms(id) ON DELETE CASCADE,
        respondent_name VARCHAR(255),
        respondent_email VARCHAR(255),
        answers JSONB NOT NULL DEFAULT '{}'::jsonb,
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
        external_event_id VARCHAR(120),
        date VARCHAR(255),
        participation_fee DECIMAL(10, 2) NOT NULL DEFAULT 5,
        event_type VARCHAR(100),
        is_failed BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS participation_fee DECIMAL(10, 2) NOT NULL DEFAULT 5`);
    await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS external_event_id VARCHAR(120)`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS events_external_event_id_unique ON events(external_event_id) WHERE external_event_id IS NOT NULL`);
    await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS event_type VARCHAR(100)`);
    await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS is_failed BOOLEAN NOT NULL DEFAULT FALSE`);

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
    await pool.query(`ALTER TABLE event_participation ADD COLUMN IF NOT EXISTS invitation_date TIMESTAMP`);

    // Per-participant date-night outcomes, keyed to an event and participant.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS date_stats (
        id SERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        participant_email VARCHAR(255) NOT NULL,
        attended BOOLEAN DEFAULT NULL,
        likes_given INTEGER NOT NULL DEFAULT 0 CHECK (likes_given >= 0),
        likes_received INTEGER NOT NULL DEFAULT 0 CHECK (likes_received >= 0),
        romantic_likes_given INTEGER NOT NULL DEFAULT 0 CHECK (romantic_likes_given >= 0),
        social_likes_given INTEGER NOT NULL DEFAULT 0 CHECK (social_likes_given >= 0),
        romantic_likes_received INTEGER NOT NULL DEFAULT 0 CHECK (romantic_likes_received >= 0),
        social_likes_received INTEGER NOT NULL DEFAULT 0 CHECK (social_likes_received >= 0),
        romantic_matches INTEGER NOT NULL DEFAULT 0 CHECK (romantic_matches >= 0),
        social_matches INTEGER NOT NULL DEFAULT 0 CHECK (social_matches >= 0),
        total_matches INTEGER CHECK (total_matches IS NULL OR total_matches >= 0),
        romantic_matches_names JSONB NOT NULL DEFAULT '[]'::jsonb,
        social_matches_names JSONB NOT NULL DEFAULT '[]'::jsonb,
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(event_id, participant_email)
      )
    `);

    // Older installations already have date_stats; add the new like categories safely.
    await pool.query(`
      ALTER TABLE date_stats
        ALTER COLUMN attended DROP NOT NULL,
        ALTER COLUMN attended DROP DEFAULT,
        ADD COLUMN IF NOT EXISTS romantic_likes_given INTEGER NOT NULL DEFAULT 0 CHECK (romantic_likes_given >= 0),
        ADD COLUMN IF NOT EXISTS social_likes_given INTEGER NOT NULL DEFAULT 0 CHECK (social_likes_given >= 0),
        ADD COLUMN IF NOT EXISTS romantic_likes_received INTEGER NOT NULL DEFAULT 0 CHECK (romantic_likes_received >= 0),
        ADD COLUMN IF NOT EXISTS social_likes_received INTEGER NOT NULL DEFAULT 0 CHECK (social_likes_received >= 0),
        ADD COLUMN IF NOT EXISTS total_matches INTEGER CHECK (total_matches IS NULL OR total_matches >= 0),
        ADD COLUMN IF NOT EXISTS romantic_matches_names JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS social_matches_names JSONB NOT NULL DEFAULT '[]'::jsonb
    `);

    // Create participant_metadata table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS participant_metadata (
        email VARCHAR(255) PRIMARY KEY,
        status VARCHAR(50) DEFAULT 'Active',
        phone VARCHAR(20),
        tags JSONB DEFAULT '[]',
        internal_notes TEXT,
        reported BOOLEAN NOT NULL DEFAULT FALSE,
        total_attended INTEGER DEFAULT 0,
        total_paid DECIMAL(10, 2) DEFAULT 0,
        reward_tag VARCHAR(100),
        last_event_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      ALTER TABLE participant_metadata
      ADD COLUMN IF NOT EXISTS reported BOOLEAN NOT NULL DEFAULT FALSE
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
