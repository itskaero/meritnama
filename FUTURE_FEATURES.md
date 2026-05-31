# Future Features — Data Requirements

> Features that would add significant value to MeritNama but require **new data sources** beyond what's currently available (historical merits, seats, candidates).

---

## 1. Hospital Profile Pages

**Description:** Dedicated pages for each hospital with training quality ratings, faculty info, pass rates, stipend, bond requirements, and city cost-of-living indicators.

**Data File:** `data/hospital_profiles.json`

**Schema:**
```json
[
  {
    "hospitalName": "Lahore General Hospital, Lahore",
    "city": "Lahore",
    "type": "Teaching Hospital",
    "affiliation": "PGMI / University of Health Sciences",
    "accreditation": {
      "CPSP": true,
      "RTMC": true,
      "notes": "Accredited for FCPS training in all major specialties"
    },
    "faculty": {
      "totalSupervisors": 45,
      "professors": 12,
      "associateProfessors": 18,
      "assistantProfessors": 15
    },
    "training": {
      "passRate": 72,
      "passRateYear": 2025,
      "averageExamAttempts": 1.4,
      "researchOpportunities": "moderate",
      "procedureVolume": "high",
      "onCallFrequency": "1 in 3",
      "leavePolicy": "As per CPSP guidelines"
    },
    "financials": {
      "stipendPGY1": 85000,
      "stipendPGY2": 90000,
      "stipendPGY3": 95000,
      "currency": "PKR",
      "bondRequired": true,
      "bondYears": 2,
      "bondPenalty": 500000,
      "hostelAvailable": true,
      "hostelFee": 5000
    },
    "location": {
      "city": "Lahore",
      "province": "Punjab",
      "coordinates": { "lat": 31.5204, "lng": 74.3587 },
      "costOfLivingIndex": 65,
      "nearbyAmenities": ["Metro station", "Shopping malls", "Parks"]
    },
    "ratings": {
      "overall": 4.2,
      "trainingQuality": 4.0,
      "workLifeBalance": 3.5,
      "infrastructure": 3.8,
      "supervision": 4.3,
      "totalReviews": 28,
      "lastUpdated": "2026-03-15"
    },
    "specialtiesOffered": ["Anaesthesia", "Cardiology", "General Surgery", "Medicine", "Orthopaedics"],
    "contactInfo": {
      "website": "https://lgh.punjab.gov.pk",
      "phone": "+92-42-XXXXXXX",
      "address": "Ferozepur Road, Lahore"
    }
  }
]
```

**How to collect:** Crowd-sourced from residents (via reviews page), supplemented with official CPSP/RTMC accreditation data and gazette notifications.

---

## 2. Alerts & Notifications System

**Description:** User-subscribed email/push alerts for round announcements, seat vacancy updates, policy changes, and deadline reminders.

**Data File:** Firestore collection `user_alerts`

**Schema (Firestore document):**
```json
{
  "userId": "firebase_uid_123",
  "email": "user@example.com",
  "subscriptions": {
    "roundAnnouncements": true,
    "seatVacancies": true,
    "policyChanges": true,
    "deadlineReminders": true
  },
  "watchlist": [
    {
      "program": "FCPS",
      "specialty": "Cardiology",
      "hospital": "Punjab Institute of Cardiology, Lahore",
      "quota": "Punjab"
    }
  ],
  "preferences": {
    "frequency": "immediate",
    "channels": ["email", "push"]
  },
  "createdAt": "2026-01-15T10:30:00Z",
  "lastNotified": "2026-05-20T14:00:00Z"
}
```

**Events collection** (`data/events.json` or Firestore `events`):
```json
[
  {
    "id": "evt_001",
    "type": "round_announcement",
    "title": "Induction 21 — Round 2 Merit List Published",
    "body": "Round 2 merit list is now available on the PHF website.",
    "date": "2026-06-01T09:00:00Z",
    "url": "https://phf.gop.pk/...",
    "tags": ["induction21", "round2"]
  },
  {
    "id": "evt_002",
    "type": "deadline",
    "title": "Document Submission Deadline — Round 2",
    "body": "Last date to submit joining documents for Round 2 allottees.",
    "date": "2026-06-10T17:00:00Z",
    "tags": ["induction21", "round2", "deadline"]
  }
]
```

**How to implement:** Use Firebase Cloud Messaging for push; EmailJS or Firebase Functions for email dispatch. Admin panel already exists for content management.

---

## 3. Document Checklist & Eligibility Tracker

**Description:** Per-specialty and per-hospital document requirements, eligibility criteria, and deadline tracking.

**Data File:** `data/document_checklist.json`

**Schema:**
```json
{
  "general_documents": [
    {
      "id": "doc_01",
      "name": "PMDC Registration Certificate",
      "required": true,
      "notes": "Must be valid and not expired",
      "category": "registration"
    },
    {
      "id": "doc_02",
      "name": "CNIC (Original + 2 copies)",
      "required": true,
      "notes": "Must match PMDC records",
      "category": "identity"
    },
    {
      "id": "doc_03",
      "name": "MBBS/BDS Degree (attested)",
      "required": true,
      "notes": "HEC attested. Provisional certificate if degree not yet issued.",
      "category": "academic"
    },
    {
      "id": "doc_04",
      "name": "House Job Completion Certificate",
      "required": true,
      "notes": "From recognized institution",
      "category": "experience"
    },
    {
      "id": "doc_05",
      "name": "FCPS Part-I Pass Certificate / MD/MS Registration",
      "required": true,
      "notes": "As applicable for program type",
      "category": "qualification"
    },
    {
      "id": "doc_06",
      "name": "NOC from Current Employer",
      "required": false,
      "notes": "Required only if currently employed in government service",
      "category": "employment"
    },
    {
      "id": "doc_07",
      "name": "Experience Certificates",
      "required": false,
      "notes": "For all claimed post-house-job service. Must include appointment/relieving orders.",
      "category": "experience"
    },
    {
      "id": "doc_08",
      "name": "Domicile Certificate",
      "required": true,
      "notes": "For quota verification",
      "category": "identity"
    }
  ],
  "program_specific": {
    "FCPS": [
      {
        "id": "fcps_01",
        "name": "CPSP Registration Card",
        "required": true,
        "notes": "Must be active"
      }
    ],
    "MS": [
      {
        "id": "ms_01",
        "name": "University MS Registration",
        "required": true,
        "notes": "From recognized university"
      }
    ]
  },
  "hospital_specific": {
    "Punjab Institute of Cardiology, Lahore": [
      {
        "id": "pic_01",
        "name": "Cardiology rotation certificate",
        "required": false,
        "notes": "Preferred but not mandatory"
      }
    ]
  },
  "eligibility_criteria": {
    "age_limit": {
      "FCPS": { "max_age": 40, "relaxation_govt": 5 },
      "MS": { "max_age": 40, "relaxation_govt": 5 }
    },
    "attempts": {
      "FCPS": { "max_attempts_part1": null, "notes": "No limit on attempts" },
      "MS": { "max_attempts": null }
    }
  },
  "timeline": [
    {
      "event": "Application Window Opens",
      "typical_date_relative": "D-30",
      "notes": "Usually 30 days before induction"
    },
    {
      "event": "Application Deadline",
      "typical_date_relative": "D-15",
      "notes": "Online portal closes"
    },
    {
      "event": "Merit List Publication",
      "typical_date_relative": "D-7",
      "notes": "Published on PHF website"
    },
    {
      "event": "Document Verification",
      "typical_date_relative": "D-3 to D-1",
      "notes": "In-person at designated center"
    },
    {
      "event": "Induction Day",
      "typical_date_relative": "D-0",
      "notes": "Joining date at allocated hospital"
    }
  ]
}
```

**How to collect:** Compile from PHF official notifications, CPSP guidelines, and PGMI circulars. Update each induction cycle.

---

## 4. Mentorship / Ask Seniors

**Description:** Connect current applicants with placed seniors at specific hospitals/specialties for guidance.

**Data Storage:** Firestore collection `mentors`

**Schema (Firestore document):**
```json
{
  "userId": "firebase_uid_456",
  "displayName": "Dr. Ahmed",
  "isVerified": true,
  "verifiedAt": "2026-02-10T00:00:00Z",
  "pmdcNo": "XXXXXX-XX-X",
  "currentStatus": "PGR Year 2",
  "program": "FCPS",
  "specialty": "General Surgery",
  "hospital": "Services Hospital, Lahore",
  "inductionJoined": 19,
  "yearJoined": 2025,
  "bio": "Happy to help with interview prep and document guidance.",
  "availability": "weekends",
  "contactPreference": "in-app",
  "topics": ["interview_prep", "document_guidance", "training_experience", "exam_tips"],
  "languages": ["English", "Urdu"],
  "rating": 4.8,
  "totalMentees": 12,
  "isActive": true,
  "createdAt": "2026-02-01T00:00:00Z"
}
```

**Mentorship request** (Firestore `mentorship_requests`):
```json
{
  "requestId": "req_001",
  "menteeId": "firebase_uid_789",
  "mentorId": "firebase_uid_456",
  "status": "accepted",
  "message": "Hi, I'm applying for General Surgery this induction. Could you guide me on preference ordering?",
  "createdAt": "2026-05-01T10:00:00Z",
  "respondedAt": "2026-05-02T08:30:00Z"
}
```

**How to implement:** Extend existing Firebase auth. Verification via PMDC number cross-check. Simple messaging via Firestore real-time.

---

## 5. Community Q&A Forum

**Description:** Specialty-specific threaded discussions with upvote/downvote, tagging, and moderation.

**Data Storage:** Firestore collections `forum_threads`, `forum_replies`

**Thread schema:**
```json
{
  "threadId": "thread_001",
  "authorId": "firebase_uid_123",
  "authorName": "Anonymous Applicant",
  "title": "Is Cardiology at PIC worth the bond?",
  "body": "I'm considering PIC Lahore for Cardiology but the 2-year bond concerns me...",
  "category": "specialty_discussion",
  "tags": ["cardiology", "pic_lahore", "bond", "induction21"],
  "specialty": "Cardiology",
  "hospital": "Punjab Institute of Cardiology, Lahore",
  "upvotes": 15,
  "downvotes": 2,
  "replyCount": 8,
  "views": 234,
  "isPinned": false,
  "isLocked": false,
  "createdAt": "2026-05-15T14:00:00Z",
  "lastReplyAt": "2026-05-20T09:30:00Z"
}
```

**Reply schema:**
```json
{
  "replyId": "reply_001",
  "threadId": "thread_001",
  "authorId": "firebase_uid_456",
  "authorName": "Dr. Ahmed (Verified PGR)",
  "isVerified": true,
  "body": "I completed my training at PIC. The bond is standard and...",
  "upvotes": 8,
  "downvotes": 0,
  "parentReplyId": null,
  "createdAt": "2026-05-15T16:00:00Z"
}
```

**Categories:**
- `specialty_discussion` — Questions about specific specialties
- `hospital_review` — Hospital-specific experiences  
- `exam_tips` — FCPS Part-I / Part-II preparation
- `preference_strategy` — Choice filling and strategy
- `general` — General discussion
- `announcements` — Official updates (mod-only posting)

**How to implement:** Firebase Firestore with security rules for authenticated users. Moderation via admin panel (already exists). Verified badge system tied to mentorship verification.

---

## 6. Downloadable PDF Report

**Description:** Export personalized prediction results, what-if analysis, and comparison data as a PDF for offline use.

**Dependencies needed:**
- Client-side PDF generation library (e.g., `jsPDF` or `html2pdf.js`)
- No extra data needed — uses existing prediction/comparison results

**Implementation notes:**
- Add a "Download PDF" button to the Predictor results and Compare tab
- Include: percentile, safe/target/reach list, trend charts, and comparison table
- Can be implemented with just a JS library addition (no new data required)

**CDN:**
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
```

---

## Priority for Implementation

| Feature | Extra Data Effort | Dev Effort | User Impact |
|---------|-------------------|-----------|-------------|
| PDF Report | None (library only) | Low | High |
| Document Checklist | Low (one-time compile) | Low | High |
| Alerts | Medium (Firestore + Cloud Functions) | Medium | High |
| Hospital Profiles | High (crowd-sourced) | Medium | Very High |
| Community Forum | Medium (Firestore rules) | High | High |
| Mentorship | High (verification system) | High | Medium |

---

## Getting Started

1. **PDF Report** — Can be added immediately. Just include html2pdf.js and wire up export buttons.
2. **Document Checklist** — Create `data/document_checklist.json` using the schema above. Compile from latest PHF/CPSP circulars.
3. **Hospital Profiles** — Start with basic data (city, accreditation, specialties offered) and expand with crowd-sourced ratings over time.
4. **Alerts** — Requires Firebase Cloud Functions setup for email dispatch. Start with in-app notification banner (partially exists).
5. **Forum/Mentorship** — Largest undertaking. Consider starting with the existing Reviews page and expanding it into threaded discussions.
