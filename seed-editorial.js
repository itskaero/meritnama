'use strict';
// ═══════════════════════════════════════════════════════════════════
// SEED: First editorial article
// Run this in the browser console on editorial-admin.html
// (Must be logged in as admin)
// ═══════════════════════════════════════════════════════════════════

async function seedFirstEditorial() {
  const db = firebase.firestore();

  // Check if articles already exist
  const existing = await db.collection('editorial_articles').limit(1).get();
  if (!existing.empty) {
    console.log('Articles already exist. Skipping seed.');
    return;
  }

  const now = firebase.firestore.FieldValue.serverTimestamp();

  const article = {
    title: 'Can Punjab Achieve Fairer Residency Selection Without Another High-Stakes Examination?',
    subtitle: 'An evidence-based analysis of alternative selection mechanisms for PRP postgraduate residency programs',
    slug: 'punjab-fairer-residency-selection',
    category: 'analysis',
    tags: ['policy', 'merit', 'FCPS', 'PRP', 'examination', 'selection'],
    authorName: 'MeritNama',
    authorEmail: 'itskaero@gmail.com',
    excerpt: 'Punjab\'s postgraduate residency selection relies heavily on a single high-stakes examination. This analysis explores whether alternative mechanisms \u2014 including portfolio-based assessment, structured interviews, and multi-criteria evaluation \u2014 could deliver fairer outcomes without the systemic risks of exam-only selection.',
    coverImage: null,
    readingTime: 12,
    status: 'published',
    relatedSlugs: [],
    seo: {
      title: 'Can Punjab Achieve Fairer Residency Selection Without Another High-Stakes Examination?',
      description: 'Evidence-based analysis of alternative selection mechanisms for PRP postgraduate residency programs in Punjab, Pakistan.',
    },
    content: `## The Current Landscape

Punjab's postgraduate residency selection process, managed through the Postgraduate Medical Institute (PGMI) and Punjab Residency Program (PRP), has long relied on a single high-stakes entrance examination as the primary gateway to specialty training positions. While this model provides a standardized metric, growing evidence suggests that exam-only selection may not adequately capture the full spectrum of competencies required for clinical excellence.

### How the Current System Works

The PRP induction process follows a familiar pattern:

1. **Entrance Examination** \u2014 A written exam covering basic medical sciences and clinical knowledge
2. **Merit Compilation** \u2014 Exam scores form the primary merit ranking
3. **Preference Submission** \u2014 Candidates rank their preferred specialties and hospitals
4. **Allocation** \u2014 Seats are filled based on merit rank and preference order

This approach has administrative simplicity and perceived objectivity. But simplicity and fairness are not the same thing.

## The Case Against Over-Reliance on Examinations

### What Exams Measure (and What They Miss)

High-stakes examinations are effective at assessing **knowledge recall under pressure**. They are less effective at measuring:

- **Clinical reasoning** \u2014 The ability to integrate multiple data points into a diagnostic or management plan
- **Communication skills** \u2014 Explaining complex conditions to patients and families
- **Teamwork and leadership** \u2014 Coordinating care across disciplines
- **Ethical judgment** \u2014 Navigating ambiguous situations with competing values
- **Resilience and adaptability** \u2014 Managing the cognitive and emotional demands of training

A candidate who scores 85% on an MCQ exam may or may not become an excellent clinician. The exam tells us they can recall facts. It tells us little about how they'll perform at 3 AM in an emergency.

### The Preparation Industry Problem

When selection depends on a single exam, a cottage industry emerges around exam preparation. This creates several distortions:

- **Wealth advantage** \u2014 Expensive prep courses and materials create socioeconomic barriers
- **Time advantage** \u2014 Candidates with financial support can dedicate months to preparation
- **Repeated attempts** \u2014 The system rewards persistence and resources over pure ability
- **Teaching to the test** \u2014 Medical education narrows to focus on exam-relevant content

### Historical Context: Pakistan's Experience

Pakistan's medical education system has seen this pattern before. The MDCAT (Medical and Dental College Admission Test) experience demonstrates how exam-centric selection can:

- Generate significant public controversy over paper leaks and irregularities
- Create pressure-cooker environments that affect candidate wellbeing
- Reward test-taking strategy alongside genuine competence
- Fail to predict actual clinical performance during training

## International Models Worth Examining

### United Kingdom: Foundation Programme Selection

The UK's Foundation Programme uses a **structured application process** that includes:

| Component | Weight | What It Assesses |
|-----------|--------|-----------------|
| Educational Performance Measure | ~50% | Academic achievement across the full degree |
| Situational Judgement Test | ~25% | Professional behavior and clinical reasoning |
| Employment / achievements | ~25% | Leadership, teaching, research, extra-curricular |

**Key insight**: The UK model doesn't rely on a single exam. It uses a **portfolio of evidence** accumulated over the entire medical degree.

### Canada: CaRMS Matching

Canada's residency matching system (CaRMS) uses:

- **CCMS** (Canadian Medical Graduate Selection) scores
- **Personal statements** and reference letters
- **Interview performance** (structured and standardized)
- **Program-specific criteria**

The Canadian approach acknowledges that different specialties value different competencies. A surgical program may weight manual dexterity differently than a psychiatry program weights communication skills.

### Australia: Multi-Station Assessment

Australia's selection for some programs incorporates:

- **Multiple Mini Interviews (MMIs)** \u2014 Short, focused scenarios testing different competencies
- **Portfolio review** \u2014 Documented achievements and experiences
- **Rural and remote scoring** \u2014 Weighting for candidates committed to underserved areas

## Alternative Selection Mechanisms for Punjab

### Option 1: Weighted Multi-Criteria Assessment

Replace the single exam with a composite score:

| Component | Weight | Assessment Method |
|-----------|--------|------------------|
| Academic record | 30% | Final MBBS GPA and class rank |
| Clinical performance | 25% | Structured supervisor evaluations |
| Entrance examination | 25% | Retained but reduced in importance |
| Portfolio | 15% | Research, teaching, leadership, extra-curricular |
| Interview | 5% | Structured scenario-based assessment |

**Advantages**: Captures a broader range of competencies; reduces single-point-of-failure risk; rewards sustained performance.

**Challenges**: Requires standardization of clinical evaluations across institutions; more complex administration; potential for inconsistency.

### Option 2: Program-Specific Selection

Allow individual programs (or specialty groups) to define their own selection criteria within broad guidelines:

- **Surgical specialties** might weight manual skills assessments more heavily
- **Medicine specialties** might emphasize clinical reasoning scenarios
- **Community medicine** might prioritize commitment demonstration and rural exposure

**Advantages**: Better fit between candidate and program; acknowledges that "best" is context-dependent.

**Challenges**: Complex to administer; risk of inconsistency; harder to ensure equity across programs.

### Option 3: Staged Selection with Feedback Loops

Implement a two-stage process:

1. **Initial screening** (exam + portfolio) \u2014 Filters to a manageable candidate pool
2. **Program-level assessment** (MMI + supervised clinical task) \u2014 Final selection

**Advantages**: Combines standardization with program-specific assessment; provides candidates with feedback at each stage.

**Challenges**: Logistically demanding; requires significant infrastructure; timeline implications.

## Addressing Common Objections

### "Exams are objective"

Objectivity in assessment is about **consistency and fairness**, not just standardized scoring. A single exam is consistent but may not be fair \u2014 it consistently advantages certain preparation styles and socioeconomic backgrounds.

### "Alternatives are too expensive"

Multi-criteria assessment does cost more. But the cost of **not** doing it \u2014 in mismatched trainees, training failures, and ultimately patient safety incidents \u2014 is far higher.

### "We can't trust interviews"

Structured interviews with standardized rubrics and multiple raters can achieve acceptable reliability. The key is structure, not abandonment.

### "It will increase corruption"

Paradoxically, a single high-stakes exam is **more** vulnerable to corruption (paper leaks, marks manipulation) than a distributed assessment system with multiple independent components.

## What MeritNama's Data Shows

Analysis of historical merit data reveals several patterns relevant to this discussion:

- **Merit gaps are narrow** \u2014 The difference between adjacent candidates is often fractions of a mark, suggesting the current system's precision may be illusory
- **Specialty mismatch is common** \u2014 Many candidates receive their 5th+ preference, indicating the preference-allocation system doesn't align candidate goals with outcomes
- **Geographic concentration** \u2014 Certain hospitals consistently attract top merit, while others struggle to fill seats regardless of quality

These patterns suggest that the current system's simplicity comes at the cost of effectiveness.

## Recommendations

### Short-term (Next Induction Cycle)

1. **Introduce a structured portfolio component** \u2014 Even a lightweight portfolio requirement signals that the system values more than exam performance
2. **Standardize clinical evaluations** \u2014 Develop a common framework for supervisor assessments that can feed into selection
3. **Pilot MMIs for selected specialties** \u2014 Test multi-station assessment in a controlled setting before system-wide adoption

### Medium-term (2-3 Years)

4. **Develop specialty-specific selection frameworks** \u2014 Allow programs to weight components differently based on their specific needs
5. **Build a centralized candidate portfolio platform** \u2014 A digital system where candidates accumulate evidence throughout their training
6. **Establish independent assessment oversight** \u2014 A body responsible for quality assurance and fairness monitoring

### Long-term (5+ Years)

7. **Transition to a composite selection model** \u2014 Full multi-criteria assessment with appropriate weighting
8. **Implement feedback mechanisms** \u2014 Track how selection criteria predict training outcomes and clinical performance
9. **Regional adaptation** \u2014 Allow different provinces or regions to adapt the framework to their specific contexts

## Conclusion

The question isn't whether Punjab's current system works \u2014 it does, in the sense that it fills training positions. The question is whether it could work **better**. The evidence from international systems and from Pakistan's own experience suggests that over-reliance on a single examination leaves significant talent on the table and may not select for the competencies that matter most in clinical practice.

A fairer system doesn't mean abandoning standards. It means using **more and better evidence** to make selection decisions. The tools exist. The evidence base is growing. What's needed is the institutional will to move beyond the comfort of a single number.

---

*This analysis draws on publicly available data from PRP, PGMI, and international medical education literature. The views expressed are those of the analysis and do not represent official positions of any institution.*

*Last updated: July 2026*
`,
    createdAt: now,
    updatedAt: now,
    publishedAt: now,
  };

  try {
    await db.collection('editorial_articles').add(article);
    console.log('First editorial article seeded successfully!');
    console.log('Slug: ' + article.slug);
    console.log('View at: editorial.html#' + article.slug);
  } catch (err) {
    console.error('Seed failed:', err);
  }
}

// Auto-run提示
console.log('Editorial seed script loaded.');
console.log('Run: await seedFirstEditorial()');
