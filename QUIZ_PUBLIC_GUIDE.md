# Public Code of Conduct Quiz - Email Integration Guide

## Overview

The Code of Conduct Quiz is now integrated into **Email 2 (Confirmation Email)** and is accessible via a **public link** that requires NO login.

## How It Works

### For Participants

1. **Email 2 (Confirmation Email)** contains a link to the quiz
2. Participant clicks the link → takes the 8-question quiz
3. Scores are tracked per device (no login needed)
4. Upon **100% completion**, the quiz displays:
   - **📍 Event Location**: Duck Playspace Event - February 22, 2026
   - **📬 Address**: Berlin, Germany - Specific address for completers
   - **🕐 Meeting Time**: 19:00 (7:00 PM)

### For Admins

The quiz is now embedded in the **Communication page → Email 2 tab**.

## Public Quiz URL

### Format
```
https://your-site.com/quiz-public/coc-2026
```

### With Device Token (Optional)
```
https://your-site.com/quiz-public/coc-2026?token=unique_device_token
```

## Email 2 Integration

### Email 2 Purpose
- Confirm attendance
- Require Code of Conduct agreement via quiz
- Unlock location/time details upon 100% completion

### Recommended Email 2 Structure

```
Subject: Your Spot is Confirmed! 🎉 [One Last Step Required]

---

Dear [Name],

Thank you for confirming your attendance! We're excited to have you join us.

**Event Details:**
- Date: February 22, 2026
- Time: 7:00 PM (TBA - see below)
- Group: 8 Women + 8 Men
- Location: TBA - See below

---

🔒 **REQUIRED: Code of Conduct Quiz**

Before we share the specific location and arrival details, we ask all participants 
to complete our quick Code of Conduct Quiz. This ensures everyone understands and 
commits to our values of consent, respect, and inclusivity.

⏱️ Takes about 5 minutes
✅ 8 multiple-choice questions
🎯 Score 100% to unlock the event location!

[BUTTON: Complete the Quiz →]
https://your-site.com/quiz-public/coc-2026

Once you score 100%, the quiz will display your event address and exact meeting time.

---

**Pre-Event Logistics:**
- Dress: Smart casual
- Parking: [Instructions]
- Arrive by: 6:45 PM
- [Other details]

**Important:**
- You must attend in person (can't send someone else)
- [Code of Conduct overview]

Questions? Contact us at [email/phone]

Looking forward to seeing you!

[Organizer Name]
```

## Quiz Questions (8 Total)

1. **Consent** - What does "Consent is Sexy" mean?
2. **NO means NO** - What does "A NO always means NO" mean?
3. **Comfort** - If someone appears uncomfortable, what to do?
4. **Pronouns** - What pronouns should you use?
5. **Language** - What kind of language at the event?
6. **Introvert/Extrovert** - As an extroverted person, what to do?
7. **Personal Details** - Should you share contact info during the event?
8. **Safety** - What to do if you witness inappropriate behavior?

## API Endpoints (Public)

All quiz endpoints are now public - no authentication required for users to take the quiz.

### GET /api/quizzes/:quizId
Retrieve quiz with all questions

```bash
curl https://your-site.com/api/quizzes/coc-2026
```

### POST /api/quiz-answer/:quizId
Submit an answer

```bash
curl -X POST https://your-site.com/api/quiz-answer/coc-2026 \
  -H "Content-Type: application/json" \
  -d '{
    "voter_token": "device_id",
    "question_id": 1,
    "selected_answer": "B"
  }'
```

### GET /api/quiz-progress/:quizId
Get current progress

```bash
curl "https://your-site.com/api/quiz-progress/coc-2026?voter_token=device_id"
```

### GET /api/quiz-completion/:quizId
Check if completed (returns location/time on 100%)

```bash
curl "https://your-site.com/api/quiz-completion/coc-2026?voter_token=device_id"
```

## Key Features

✅ **No Login Required** - Public link accessible from email
✅ **Device-Tracked** - One quiz per device (stored in browser)
✅ **Retakeable** - Users can clear and start over
✅ **Instant Unlock** - Location/time show immediately at 100%
✅ **Mobile Friendly** - Responsive design works on all devices
✅ **Secure** - Parameterized queries, no injection vulnerabilities

## Email Template Examples

### Example 1: Simple CTA Button
```html
<table style="width: 100%; margin: 20px 0;">
  <tr>
    <td align="center">
      <a href="https://your-site.com/quiz-public/coc-2026" 
         style="background: #667eea; color: white; padding: 12px 28px; 
                border-radius: 5px; text-decoration: none; font-weight: bold;">
        Complete the Quiz (Unlock Location)
      </a>
    </td>
  </tr>
</table>
```

### Example 2: Inline Link
```html
<p>Before we share your event location, please 
   <a href="https://your-site.com/quiz-public/coc-2026" style="color: #667eea; font-weight: bold;">
   complete our Code of Conduct Quiz
   </a> (5 mins, 100% required).
</p>
```

### Example 3: Text Link
```
Quiz Link: https://your-site.com/quiz-public/coc-2026
```

## Testing the Quiz

1. **Without Login:**
   - Go to: `http://localhost:3000/quiz-public/coc-2026`
   - Should load immediately (no login prompt)

2. **Take the Quiz:**
   - Answer all 8 questions
   - See real-time feedback
   - After 100% completion, event details appear

3. **Device Tracking:**
   - Device token stored in browser localStorage
   - Same device can't take quiz twice (but can retake)
   - Different device = fresh quiz

## FAQ

**Q: Do users need to create an account?**
A: No. The quiz is completely public and accessible via email link.

**Q: How is progress tracked?**
A: Each device gets a unique token stored in browser localStorage. No user accounts needed.

**Q: Can someone take the quiz multiple times?**
A: Yes, they can retake it using the "Start Over" button, which clears their progress.

**Q: What if they access from a different device?**
A: They'll get a new device token and will see the quiz fresh.

**Q: How do we know who took the quiz?**
A: Quiz submissions are logged in the database with voter_token and timestamp. 
   You can correlate with email if needed.

**Q: What happens if they don't complete 100%?**
A: Event location and time remain hidden. They must retake and score 100%.

## Admin Access

**Authenticated Quiz Page:**
- URL: `http://localhost:3000/quiz` (requires login)
- Shows progress of all quiz-takers
- Admin dashboard functionality

**Public Quiz Page:**
- URL: `http://localhost:3000/quiz-public/coc-2026`
- No login required
- Designed for email link sharing

## Customization

To customize the quiz questions, event details, or location:

1. Edit the `init-quiz.js` file
2. Update the `quizData` object with new values
3. Run: `node init-quiz.js` to reinitialize

To change the reward details shown upon completion:

1. Update the `quizzes` table in the database:
   ```sql
   UPDATE quizzes 
   SET reward_location = 'New Location',
       reward_address = 'New Address',
       meeting_time = 'New Time'
   WHERE id = 'coc-2026';
   ```

2. Or modify quiz-public.html to customize the display

## Deployment

When deploying to production:

1. Update the quiz URLs in your email templates to match your domain
2. Ensure `/api/quizzes/*` endpoints are accessible without VPN/login
3. Test the public link from outside your network
4. Consider adding rate limiting to prevent abuse
5. Monitor quiz submissions in your database

## Support

For issues or customizations, check:
- `QUIZ_SETUP.md` - Technical implementation details
- `public/quiz-public.html` - Public quiz UI code
- `server.js` - API endpoints
- Database: `quizzes`, `quiz_questions`, `quiz_options`, `quiz_submissions` tables
