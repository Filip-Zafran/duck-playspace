import 'dotenv/config';
import { getPool, initializeDatabase } from './db.js';

const QUIZ_ID = 'coc-2026';

const quizData = {
  title: '📋 Code of Conduct Quiz',
  description: 'Test your understanding of Duck Playspace\'s Code of Conduct. Answer all questions correctly to unlock the event location and meeting time.',
  required_score_percent: 100,
  reward_location: 'Duck Playspace Event - February 22, 2026',
  reward_address: 'Berlin, Germany - Specific address will be shared with quiz completers',
  meeting_time: '19:00 (7:00 PM)',
  questions: [
    {
      question_text: 'According to our Code of Conduct, what does "Consent is Sexy" mean?',
      correct_answer: 'B',
      explanation: 'Consent must be enthusiastic and a "Yes" can change to "NO" at any time. Physical contact requires enthusiastic consent from all parties involved.',
      options: {
        A: 'Physical contact is okay if one person agrees',
        B: 'All parties must give enthusiastic consent, and a Yes can change to NO at any time',
        C: 'Verbal consent is not necessary if someone seems comfortable'
      }
    },
    {
      question_text: 'What does the Code of Conduct mean by "A NO always means NO"?',
      correct_answer: 'B',
      explanation: 'No refusal is absolute and must be respected immediately. Consent is never assumed and must be ongoing.',
      options: {
        A: 'People might change their mind later, so you can try again',
        B: 'Refusal must be respected immediately and is absolute',
        C: 'It depends on how they say it or their tone of voice'
      }
    },
    {
      question_text: 'If someone appears uncomfortable during a conversation, what should you do?',
      correct_answer: 'B',
      explanation: 'Be attentive to verbal and nonverbal cues. If someone appears uncomfortable, change the subject, pause, or give them space.',
      options: {
        A: 'Continue the conversation to help them relax',
        B: 'Change the subject, pause, or give them space',
        C: 'Ask if they want a drink to make them feel better'
      }
    },
    {
      question_text: 'What pronouns should you use at the Duck Playspace event?',
      correct_answer: 'A',
      explanation: 'Use each participant\'s chosen pronouns. The event encourages participants to share their pronouns (e.g., "Alex (they/them)").',
      options: {
        A: 'Each participant\'s chosen pronouns',
        B: 'Assumed pronouns based on appearance',
        C: 'Traditional pronouns regardless of preference'
      }
    },
    {
      question_text: 'What kind of language should be used at the event?',
      correct_answer: 'A',
      explanation: 'Use gender-neutral language. This event is open and welcoming to people of all orientations and identities. For example, use "everyone" or "friends" instead of "ladies and gentlemen."',
      options: {
        A: 'Gender-neutral language that is inclusive',
        B: 'Traditional language like "ladies and gentlemen"',
        C: 'Whatever language feels most natural to you'
      }
    },
    {
      question_text: 'As an extroverted person at this event, what should you do?',
      correct_answer: 'B',
      explanation: 'We ask extroverted people to tone down and give space for others to participate. Be comfortable in silence and allow introverts to contribute.',
      options: {
        A: 'Dominate conversations and help introverts by talking for them',
        B: 'Tone down and give space for others to contribute',
        C: 'Talk as much as you want because that\'s your personality'
      }
    },
    {
      question_text: 'Should you share or ask for personal contact information during the event?',
      correct_answer: 'B',
      explanation: 'Do not share or ask for personal contact information. The organizers will facilitate follow-ups if mutual interest emerges.',
      options: {
        A: 'Yes, exchange contact info with anyone you\'re interested in',
        B: 'No, the organizers will facilitate follow-ups after the event',
        C: 'Only if you\'re certain there\'s mutual interest'
      }
    },
    {
      question_text: 'What should you do if you feel uncomfortable or witness inappropriate behavior?',
      correct_answer: 'B',
      explanation: 'Inform the Organizers immediately. We are committed to maintaining a positive atmosphere. Instances of misconduct may result in immediate removal.',
      options: {
        A: 'Give the person a warning first before telling organizers',
        B: 'Inform the Organizers immediately',
        C: 'Ignore it if it\'s not directly affecting you'
      }
    }
  ]
};

async function initializeQuiz() {
  try {
    console.log('🚀 Initializing Code of Conduct Quiz...\n');

    // Initialize database first
    await initializeDatabase();

    const pool = getPool();

    // Check if quiz already exists
    const existingQuiz = await pool.query('SELECT id FROM quizzes WHERE id = $1', [QUIZ_ID]);

    if (existingQuiz.rows.length > 0) {
      console.log('⚠️  Quiz already exists. Skipping initialization.');
      console.log(`Quiz ID: ${QUIZ_ID}`);
      process.exit(0);
    }

    // Insert quiz
    await pool.query(
      `INSERT INTO quizzes (id, title, description, required_score_percent, reward_location, reward_address, meeting_time)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [QUIZ_ID, quizData.title, quizData.description, quizData.required_score_percent, quizData.reward_location, quizData.reward_address, quizData.meeting_time]
    );

    // Insert questions and options
    for (let i = 0; i < quizData.questions.length; i++) {
      const q = quizData.questions[i];
      const result = await pool.query(
        `INSERT INTO quiz_questions (quiz_id, question_text, correct_answer, explanation, display_order)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [QUIZ_ID, q.question_text, q.correct_answer, q.explanation || null, i]
      );

      const questionId = result.rows[0].id;

      // Insert options
      for (const [letter, text] of Object.entries(q.options)) {
        await pool.query(
          `INSERT INTO quiz_options (question_id, option_letter, option_text)
           VALUES ($1, $2, $3)`,
          [questionId, letter, text]
        );
      }
    }

    console.log('✅ Quiz initialized successfully!');
    console.log('\n📋 Quiz Details:');
    console.log(`   Quiz ID: ${QUIZ_ID}`);
    console.log(`   Title: ${quizData.title}`);
    console.log(`   Total Questions: ${quizData.questions.length}`);
    console.log(`   Reward Location: ${quizData.reward_location}`);
    console.log(`   Meeting Time: ${quizData.meeting_time}`);
    console.log('\n🎯 Access the quiz at: http://localhost:3000/quiz');
    console.log('\n📍 Quiz Rewards:');
    console.log(`   Location: ${quizData.reward_location}`);
    console.log(`   Address: ${quizData.reward_address}`);
    console.log(`   Time: ${quizData.meeting_time}`);

    process.exit(0);

  } catch (error) {
    console.error('❌ Error initializing quiz:', error.message);
    console.error(error);
    process.exit(1);
  }
}

initializeQuiz();
