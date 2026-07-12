# Code of Conduct Quiz System

## Overview

The Code of Conduct Quiz is an interactive system that ensures all Duck Playspace participants understand and agree with our core values of consent, respect, and inclusivity. Upon completing the quiz with a 100% score, participants unlock the event location and meeting time.

## Features

### Quiz Functionality
- **8 Multiple Choice Questions** based on the Code of Conduct (CoC)
- **Real-time Progress Tracking** - Shows questions answered and score percentage
- **Instant Feedback** - Displays correct/incorrect answers with explanations
- **Device-Based Tracking** - Uses browser storage to track individual progress
- **Retake Option** - Users can clear their progress and start over
- **Completion Rewards** - 100% score unlocks event details

### Quiz Rewards
When participants complete 100% of the quiz:
- **Location**: Duck Playspace Event - February 22, 2026
- **Address**: Berlin, Germany - Specific address will be shared with quiz completers
- **Meeting Time**: 19:00 (7:00 PM)

## Database Schema

### quizzes table
```sql
- id (VARCHAR 36) - Primary key, UUID
- title (VARCHAR 255) - Quiz title
- description (TEXT) - Quiz description
- required_score_percent (INTEGER) - Minimum score needed (default: 100)
- reward_location (VARCHAR 255) - Location to display upon completion
- reward_address (TEXT) - Address details
- meeting_time (VARCHAR 255) - Meeting/event time
- created_at (TIMESTAMP) - Creation timestamp
```

### quiz_questions table
```sql
- id (SERIAL) - Primary key
- quiz_id (VARCHAR 36) - Foreign key to quizzes
- question_text (TEXT) - The question
- correct_answer (VARCHAR 1) - Correct option (A, B, or C)
- explanation (TEXT) - Explanation for the answer
- display_order (INTEGER) - Order to display questions
- created_at (TIMESTAMP) - Creation timestamp
```

### quiz_options table
```sql
- id (SERIAL) - Primary key
- question_id (INTEGER) - Foreign key to quiz_questions
- option_letter (VARCHAR 1) - A, B, or C
- option_text (TEXT) - The option text
- created_at (TIMESTAMP) - Creation timestamp
```

### quiz_submissions table
```sql
- id (SERIAL) - Primary key
- quiz_id (VARCHAR 36) - Foreign key to quizzes
- voter_token (VARCHAR 255) - Device identifier
- question_id (INTEGER) - Foreign key to quiz_questions
- selected_answer (VARCHAR 1) - User's selected option
- is_correct (BOOLEAN) - Whether answer is correct
- submitted_at (TIMESTAMP) - When answer was submitted
- UNIQUE(quiz_id, voter_token, question_id) - One vote per device per question
```

## API Endpoints

### POST /api/quizzes
Create a new quiz with questions and options.

**Requires Authentication**

**Request Body:**
```json
{
  "title": "Quiz Title",
  "description": "Quiz Description",
  "required_score_percent": 100,
  "reward_location": "Event Location",
  "reward_address": "Full Address",
  "meeting_time": "Event Time",
  "questions": [
    {
      "question_text": "Question?",
      "correct_answer": "B",
      "explanation": "Explanation of answer",
      "options": {
        "A": "Option A",
        "B": "Option B",
        "C": "Option C"
      }
    }
  ]
}
```

**Response:**
```json
{
  "id": "quiz-id-uuid",
  "message": "Quiz created successfully"
}
```

### GET /api/quizzes/:quizId
Retrieve quiz details with all questions and options.

**Response:**
```json
{
  "id": "quiz-id",
  "title": "Quiz Title",
  "description": "Description",
  "required_score_percent": 100,
  "reward_location": "Location",
  "reward_address": "Address",
  "meeting_time": "Time",
  "questions": [
    {
      "id": 1,
      "question_text": "Question?",
      "options": {
        "A": "Option A",
        "B": "Option B",
        "C": "Option C"
      },
      "correct_answer": "B",
      "explanation": "Explanation"
    }
  ]
}
```

### POST /api/quiz-answer/:quizId
Submit an answer to a quiz question.

**Request Body:**
```json
{
  "voter_token": "device_identifier",
  "question_id": 1,
  "selected_answer": "B"
}
```

**Response:**
```json
{
  "is_correct": true,
  "correct_answer": "B"
}
```

### GET /api/quiz-progress/:quizId
Get user's current progress on the quiz.

**Query Parameters:**
- `voter_token` (required) - Device identifier

**Response:**
```json
{
  "total_questions": 8,
  "submitted_answers": 5,
  "correct_answers": 5,
  "percent_correct": 62,
  "completed": false
}
```

### GET /api/quiz-completion/:quizId
Check if quiz is completed and retrieve reward details.

**Query Parameters:**
- `voter_token` (required) - Device identifier

**Response:**
```json
{
  "completed": true,
  "percent_correct": 100,
  "total_questions": 8,
  "correct_answers": 8,
  "reward_location": "Duck Playspace Event - February 22, 2026",
  "reward_address": "Berlin, Germany - Specific address will be shared with quiz completers",
  "meeting_time": "19:00 (7:00 PM)"
}
```

## Quiz Questions

The quiz contains 8 questions based on the Code of Conduct:

1. **What does "Consent is Sexy" mean?**
   - Correct: All parties must give enthusiastic consent, and a Yes can change to NO at any time

2. **What does "A NO always means NO" mean?**
   - Correct: Refusal must be respected immediately and is absolute

3. **If someone appears uncomfortable, what should you do?**
   - Correct: Change the subject, pause, or give them space

4. **What pronouns should you use at the event?**
   - Correct: Each participant's chosen pronouns

5. **What kind of language should be used at the event?**
   - Correct: Gender-neutral language that is inclusive

6. **As an extroverted person, what should you do?**
   - Correct: Tone down and give space for others to contribute

7. **Should you share personal contact information during the event?**
   - Correct: No, the organizers will facilitate follow-ups after the event

8. **What should you do if you witness inappropriate behavior?**
   - Correct: Inform the Organizers immediately

## How to Initialize the Quiz

The quiz is already initialized with the Code of Conduct questions. If you need to reinitialize it:

```bash
node init-quiz.js
```

This will:
1. Create the quiz with ID `coc-2026`
2. Insert all 8 questions
3. Create all option choices (A, B, C)
4. Display the quiz details and access URL

## Frontend Features

The quiz page (`/quiz`) provides:

- **Progress Bar** - Visual representation of completion percentage
- **Question Navigation** - Clear display of question number and total count
- **Immediate Feedback** - Shows if answer is correct and displays explanation
- **Answer History** - Previous answers are remembered and displayed
- **Completion Screen** - Shows success message with reward details
- **Retry Option** - Allows users to clear progress and start over

## User Experience Flow

1. User navigates to `/quiz`
2. System generates or retrieves device token from browser storage
3. Quiz loads with all questions
4. User selects answers (answers auto-submit)
5. Progress bar updates after each answer
6. When all questions answered correctly, completion screen appears
7. Completion screen displays:
   - Success message
   - Event location
   - Full address
   - Meeting time
8. User can retake quiz to clear progress

## Security Features

- **Device-Based Deduplication** - Only one vote per device per question
- **Session Authentication** - Admin endpoints require authentication
- **SQL Injection Prevention** - Parameterized queries throughout
- **UNIQUE Constraint** - Prevents duplicate submissions per device

## Notes

- Quiz requires 100% correct answers to unlock event details
- Each user gets a unique device token stored in browser localStorage
- Answers are submitted individually as they're selected
- Users can change answers at any time
- Explanations help users understand why answers are correct/incorrect
