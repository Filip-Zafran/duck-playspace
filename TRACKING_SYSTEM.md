# Duck Playspace - User Tracking & Attendance System

## Overview

The system tracks user engagement and attendance across multiple stages using different tables and identifiers. Here's the complete flow:

---

## 1. Core Tracking Tables

### A. `event_participation` Table
**Tracks**: RSVP status, attendance, payment

**Fields:**
- `event_id` (FK) - Which event
- `email` - Participant email (primary identifier)
- `invited` (BOOLEAN) - Was invited
- `invitation_date` (TIMESTAMP) - When invited
- `responded` (BOOLEAN) - Sent response
- `response_date` (TIMESTAMP) - When they responded
- `status` (VARCHAR) - 'waiting', 'accepted', 'declined'
- `attended` (BOOLEAN) - Actually showed up
- `paid` (BOOLEAN) - Paid for event
- `amount` (DECIMAL) - Payment amount
- `payment_date` (TIMESTAMP) - When paid
- `free_entry` (BOOLEAN) - Got free entry
- `referral` (BOOLEAN) - Came via referral
- `notes` (TEXT) - Admin notes
- `created_at`, `updated_at` (TIMESTAMP) - Lifecycle tracking

**Primary Key:** `(event_id, email)` - One record per participant per event

---

### B. `participant_metadata` Table
**Tracks**: Overall participant history and status

**Fields:**
- `email` (VARCHAR, PRIMARY KEY) - Unique identifier
- `status` (VARCHAR) - 'Active', 'Inactive', 'Banned'
- `phone` (VARCHAR) - Contact number
- `tags` (JSONB) - Custom tags ['vip', 'referrer', etc.]
- `internal_notes` (TEXT) - Admin notes
- `total_attended` (INTEGER) - Number of events attended
- `total_paid` (DECIMAL) - Total money paid
- `reward_tag` (VARCHAR) - '50% OFF', 'FREE EVENT', etc.
- `last_event_name` (VARCHAR) - Most recent event
- `created_at`, `updated_at` (TIMESTAMP)

**One record per user** - Aggregated across all events

---

### C. `votes` Table
**Tracks**: Poll responses (date/venue preferences)

**Fields:**
- `poll_id` (FK) - Which poll
- `voter_name` (VARCHAR) - Participant name
- `voter_email` (VARCHAR) - Participant email
- `choice` (VARCHAR) - Selected option ('date1', 'date2', 'date3', 'none')
- `location_choice` (VARCHAR) - Venue preference
- `submitted_at` (TIMESTAMP) - When voted
- `UNIQUE(poll_id, voter_token)` - One vote per device

**Tracks** poll participation and preferences

---

### D. `quiz_submissions` Table (NEW)
**Tracks**: Code of Conduct quiz progress

**Fields:**
- `quiz_id` (FK) - Which quiz
- `voter_token` (VARCHAR) - Device identifier
- `question_id` (FK) - Which question
- `selected_answer` (VARCHAR) - User's answer (A/B/C)
- `is_correct` (BOOLEAN) - Whether answer correct
- `submitted_at` (TIMESTAMP) - When answered
- `UNIQUE(quiz_id, voter_token, question_id)` - One answer per device per question

**Issue**: Uses device token, not email - **REQUIRES LINKING**

---

## 2. Current Flow & Tracking Points

### Stage 1: Invite Phase
```
Upload Data (CSV)
    ↓
participant_metadata created (email)
    ↓
Send Email 1 (Poll)
    ↓
event_participation.invited = true
event_participation.invitation_date = NOW()
```

### Stage 2: Poll Response
```
Poll email sent with link
    ↓
Participant clicks poll link (no login)
    ↓
votes table updated
    ↓
Poll results show in admin dashboard
```

**Tracked by**: `voter_email` in votes table

### Stage 3: Confirmation
```
Poll closes
    ↓
Email 2 sent to confirmed participants
    ↓
**NEW**: Quiz link included (public, no login)
    ↓
quiz_submissions table updated
```

**Tracked by**: `voter_token` (device ID) - **NOT EMAIL** ⚠️

### Stage 4: Attendance
```
Event day arrives
    ↓
Participant attends
    ↓
event_participation.attended = true
participant_metadata.total_attended += 1
```

**Tracked by**: Manual admin update with email

---

## 3. SQL Queries to Track Users

### Get One Participant's Complete History
```sql
SELECT 
  pm.email,
  pm.status,
  pm.total_attended,
  pm.total_paid,
  pm.reward_tag,
  e.name as event_name,
  ep.invited,
  ep.invitation_date,
  ep.responded,
  ep.response_date,
  ep.status as rsvp_status,
  ep.attended,
  ep.paid,
  v.choice as poll_choice,
  v.submitted_at as poll_voted_at
FROM participant_metadata pm
LEFT JOIN event_participation ep ON pm.email = ep.email
LEFT JOIN events e ON ep.event_id = e.id
LEFT JOIN votes v ON pm.email = v.voter_email
WHERE pm.email = 'user@example.com'
ORDER BY v.submitted_at DESC;
```

### Get Event Participation Summary
```sql
SELECT 
  e.name as event,
  COUNT(*) as total_invited,
  SUM(CASE WHEN ep.responded THEN 1 ELSE 0 END) as responded,
  SUM(CASE WHEN ep.status = 'accepted' THEN 1 ELSE 0 END) as accepted,
  SUM(CASE WHEN ep.attended THEN 1 ELSE 0 END) as attended,
  SUM(CASE WHEN ep.paid THEN 1 ELSE 0 END) as paid,
  SUM(ep.amount) as total_revenue
FROM events e
LEFT JOIN event_participation ep ON e.id = ep.event_id
GROUP BY e.id, e.name
ORDER BY e.date DESC;
```

### Track Poll Responses
```sql
SELECT 
  p.title as poll,
  v.choice,
  COUNT(*) as count,
  COUNT(DISTINCT v.voter_email) as unique_voters
FROM polls p
LEFT JOIN votes v ON p.id = v.poll_id
GROUP BY p.id, p.title, v.choice
ORDER BY p.created_at DESC;
```

### Get Quiz Completion Status
```sql
SELECT 
  voter_token,
  COUNT(*) as answers_submitted,
  SUM(CASE WHEN is_correct THEN 1 ELSE 0 END) as correct_answers,
  ROUND(100.0 * SUM(CASE WHEN is_correct THEN 1 ELSE 0 END) / COUNT(*), 1) as percent_correct,
  MAX(submitted_at) as last_answer,
  CASE 
    WHEN SUM(CASE WHEN is_correct THEN 1 ELSE 0 END) = 8 THEN 'COMPLETED'
    ELSE 'IN_PROGRESS'
  END as status
FROM quiz_submissions
WHERE quiz_id = 'coc-2026'
GROUP BY voter_token
ORDER BY last_answer DESC;
```

---

## 4. Tracking Identifiers

### Email-Based Tracking (Most Common)
- Used for: Event participation, poll email, payment, metadata
- Reliable: Yes
- Authenticates: No
- Example: `participant@example.com`

### Device Token Tracking (Poll + Quiz)
- Used for: Public polls, public quiz
- Reliable: Per browser
- Authenticates: No
- Stored in: Browser localStorage
- Example: `device_abc123xyz_1657000000`

### Session-Based Tracking (Admin)
- Used for: Authenticated admin actions
- Reliable: Yes
- Authenticates: Yes
- Example: Express session cookie

---

## 5. Current Gaps & Issues

### ⚠️ Issue 1: Quiz Not Linked to Email
**Problem**: Quiz uses `voter_token` (device), not email
**Impact**: Can't connect quiz completion to participant email
**Solution**: Need to modify quiz-public.html to collect email OR pre-populate token

**Example Gap:**
```
Participant email: alice@example.com
Poll response: voter_email = alice@example.com ✓
Quiz response: voter_token = device_xyz123 ✗ (no email)
Event attendance: email = alice@example.com ✓

RESULT: Can't see that alice completed the quiz!
```

### ⚠️ Issue 2: Poll Vote Not Linked to Email
**Problem**: Some polls use `voter_name` only, not always email
**Impact**: Can't always match poll votes to invitees
**Solution**: Always require email in poll submissions

### ⚠️ Issue 3: Quiz Completion Not Tracked in event_participation
**Problem**: No field to mark quiz as completed
**Impact**: Can't see quiz status on event dashboard
**Solution**: Add `quiz_completed` field to event_participation

---

## 6. Recommended Improvements

### Fix 1: Add Email to Quiz Submissions
**Option A**: Pre-populate email in quiz link
```
/quiz-public/coc-2026?email=alice@example.com&token=unique123
```

**Option B**: Collect email in quiz form (first question)
```
"Before we start, what's your email?"
```

**Option C**: Create quiz_email_links table
```
quiz_id | email | token | expires | used_at
coc-2026 | alice@example.com | token123 | 2026-02-21 | 2026-02-20
```

### Fix 2: Update event_participation Schema
Add fields to track quiz completion:
```sql
ALTER TABLE event_participation ADD COLUMN
  quiz_completed BOOLEAN DEFAULT FALSE,
  quiz_completed_at TIMESTAMP,
  quiz_score_percent INTEGER;
```

Then track:
```javascript
// When quiz reaches 100%
await pool.query(`
  UPDATE event_participation
  SET quiz_completed = true,
      quiz_completed_at = NOW(),
      quiz_score_percent = 100
  WHERE email = $1 AND event_id = $2
`, [email, eventId]);
```

### Fix 3: Link Polls to Participants
Ensure `voter_email` always captured:
```javascript
await pool.query(`
  INSERT INTO votes (poll_id, voter_name, voter_email, choice)
  VALUES ($1, $2, $3, $4)
`, [pollId, name, email, choice]);
```

---

## 7. Ideal Tracking Flow (With Fixes)

```
┌─────────────────────────────────────────────────────────┐
│ INVITE PHASE                                            │
│ event_participation.email = alice@example.com           │
│ event_participation.invited = true                      │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ POLL RESPONSE                                           │
│ votes.voter_email = alice@example.com                   │
│ votes.choice = 'date1'                                  │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ QUIZ COMPLETION                                         │
│ quiz_submissions.voter_token linked to email            │
│ event_participation.quiz_completed = true               │
│ event_participation.quiz_score_percent = 100            │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ EVENT DAY                                               │
│ event_participation.attended = true                     │
│ participant_metadata.total_attended += 1                │
│ participant_metadata.reward_tag updated                 │
└─────────────────────────────────────────────────────────┘
```

---

## 8. Admin Dashboard Queries Needed

### View Participants Status for Event
```sql
SELECT 
  ep.email,
  ep.invited,
  ep.responded,
  ep.status as rsvp,
  ep.quiz_completed,
  ep.quiz_score_percent,
  ep.attended,
  ep.paid
FROM event_participation ep
WHERE ep.event_id = $1
ORDER BY ep.email;
```

### Track Quiz Completion Rate
```sql
SELECT 
  COUNT(DISTINCT ep.email) as total_invited,
  COUNT(DISTINCT CASE WHEN ep.responded THEN ep.email END) as responded,
  COUNT(DISTINCT CASE WHEN ep.quiz_completed THEN ep.email END) as quiz_completed,
  COUNT(DISTINCT CASE WHEN ep.quiz_completed AND ep.quiz_score_percent = 100 
                      THEN ep.email END) as quiz_perfect
FROM event_participation ep
WHERE ep.event_id = $1;
```

---

## 9. Current Data Points Available

| Tracking Point | Table | Identifier | Authenticated |
|---|---|---|---|
| Upload participants | participant_metadata | email | ✓ Admin only |
| Invite sent | event_participation | email | ✓ Admin logs |
| Poll vote | votes | voter_email | ✗ Public |
| Quiz response | quiz_submissions | voter_token | ✗ Public |
| Event attendance | event_participation | email | ✓ Admin entry |
| Payment | event_participation | email | ✓ Admin entry |

---

## 10. Summary & Action Items

### ✅ Currently Tracked
- Invitations (email-based)
- RSVP status (email-based)
- Poll preferences (email-based)
- Event attendance (email-based)
- Payment status (email-based)
- User metadata (email-based)

### ⚠️ Need to Fix
1. **Link quiz to email** - Currently orphaned in quiz_submissions
2. **Add quiz status to event_participation** - No quiz tracking field
3. **Ensure poll always has email** - Some votes may lack voter_email
4. **Add quiz_completed dashboard** - Admins can't see who completed quiz

### 📋 Recommended Next Steps
1. Add email to quiz link (either pre-populated or collected)
2. Add `quiz_completed` and `quiz_score_percent` fields to event_participation
3. Create admin dashboard view showing:
   - Invited ✓
   - Responded ✓
   - Quiz Completed ✓
   - Quiz Score ✓
   - Event Attended ✓
4. Add SQL query to correlate quiz_submissions to participants

---

## Implementation Priority

**🔴 HIGH**: Link quiz to email (currently completely untracked)
**🟡 MEDIUM**: Add quiz fields to event_participation
**🟡 MEDIUM**: Create dashboard view
**🟢 LOW**: Add rate limiting for quiz abuse
