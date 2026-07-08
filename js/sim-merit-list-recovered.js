/**
 * ====================================================================
 *  SIM-MERIT-LIST.JS - CORRUPTION ANALYSIS REPORT
 *  Generated: comprehensive forensic analysis
 * ====================================================================
 *
 *  THIS FILE IS NOT A RECOVERED VERSION.
 *  It is an analysis of the corrupted file at:
 *    meritnama/js/sim-merit-list.js   (and .corrupted - they are identical)
 *
 *  The original (un-corrupted) file was ~3479 lines.
 *  The corrupted file is 1348 lines / 76,670 bytes.
 *  ~2131 lines were replaced with garbage text.
 *
 * ====================================================================
 *  1. CORRUPTION MECHANISM
 * ====================================================================
 *
 *  Location in corrupted file:
 *    Line 695:   (empty)
 *    Line 696:   "       * ignore */ }"   ←←← CORRUPTION POINT
 *    Line 697:   "    const overlay = document.createElement('div');"
 *
 *  The corruption is a text-replacement of the form "/* ... *​/":
 *    - The text "       * ignore */ }" was written over ~2131 lines of original code.
 *    - Hex bytes of line 696:
 *        20 20 20 20 20 20 20 2A 20 69 67 6E 6F 72 65 20 2A 2F 20 7D
 *        (7 spaces, *, space, i,g,n,o,r,e, space, *, /, space, })
 *    - The preceding closing brace '}' was likely the last CSS rule's closing brace
 *      from the @media (max-width:520px) block, which correctly survived.
 *
 *  The pattern "       * ignore */ }" is the TAIL END of a multi-line JavaScript
 *  comment (/* ... *​/) that was injected by a mangled PowerShell command. The
 *  command likely concatenated file content incorrectly, replacing the middle
 *  section with a comment that was intended to suppress/disable those lines.
 *
 *  CRITICAL SIDE EFFECT: The backtick that originally closed the template literal
 *  (opened at line 529 for $tabContent.innerHTML) was DELETED along with the
 *  missing content. This causes the template literal to consume the ENTIRE
 *  showMeritListInfoModal() function body as string data, creating:
 *    - A runtime-correct (but functionally wrong) assignment to $tabContent.innerHTML
 *    - Then a syntax-safe sequence where overlay.innerHTML gets rendered
 *    - But 'overlay' was never actually declared as a JS variable (its declaration
 *      is inside the consumed string), causing a ReferenceError at runtime
 *
 * ====================================================================
 *  2. WHAT WAS LOST (between line 695 and what should follow)
 * ====================================================================
 *
 *  The template literal at line 529 ($tabContent.innerHTML = `...`) was MISSING:
 *    a) "</style>"  - closing the <style> tag
 *    b) ~50 lines of HTML: section-header, filter card, ml-layout grid, sidebar, etc.
 *    c) The closing backtick and statement terminator:  `;
 *    d) ~1400 lines of JavaScript function definitions (31 functions total)
 *
 *  Functions DEFINITIVELY LOST from sim-merit-list.js (NOT found in any other JS file):
 *
 *    1. updateMeta()           - updates merit list meta display
 *    2. applyFilters()         - applies dropdown/checkbox filters to merit grid
 *    3. slotKey(entry)         - builds unique slot key from merit entry
 *    4. slotKeyFor(aid, prog, quota, spec, hosp) - builds slot key from components
 *    5. getRowConsentVal(d)    - resolves consent value for a merit row
 *    6. entryIsReplacedOriginal(entry) - checks if entry was the original occupant
 *    7. entryIsActiveOccupant(entry)   - checks if entry currently occupies slot
 *    8. formatSlotShort(entry) - short slot description
 *    9. logReplacement(from, to, slot, source) - logs a replacement event
 *   10. setupReplacementSidebar() - binds sidebar event listeners
 *   11. renderReplacementSidebar() - renders replacement log sidebar
 *   12. maybeOpenReplacementSidebar() - opens sidebar if log entries exist
 *   13. renderMeritGrid()      - RENDERS THE MAIN MERIT GRID (core function!)
 *   14. candidateForApplicant(aid) - finds candidate object by ID
 *   15. candidatePreferenceForSlot(c, prog, quota, spec, hosp) - finds matching pref
 *   16. certForPreference(pref, certs) - matches certificate to preference via typeId+disciplineId
 *   17. prefBonus(c, pref, program) - calculates preference bonus marks
 *   18. prefNoFromCandidate(aid, prog, quota, spec, hosp) - gets preference number
 *   19. prefMatchFromCandidate(aid, prog, quota, spec, hosp) - gets full pref match
 *   20. listReplacementCandidates(prog, quota, spec, hosp, excludeKeys) - builds replacement list
 *   21. startChain(removedEntry) - starts a replacement chain
 *   22. nextInLine(prog, quota, spec, hosp, excludeAids) - finds next eligible candidate
 *   23. restoreConsent(slotKey)  - restores an excluded candidate back to active
 *   24. restoreInitial(slotKey) - restores to original merit state
 *   25. batchAutoChain()        - runs auto-chaining for all excluded slots
 *   26. _dedupNextInLineForGroup(prog, quota, spec, hosp, candidates) - dedup helper
 *   27. _dedupAllGroups()       - dedup across all groups
 *   28. reasonBadge(cv, bySlot) - returns colored badge HTML for consent reason
 *   29. showNextInLineModal(entries, slotKey) - shows replacement candidates modal
 *   30. showCandidateInfoModal(entry) - shows candidate detail modal
 *   31. hideEl(el)             - utility to hide element
 *   32. applyMeritListTabSwap() - swaps tabs between merit/seats for Where Falls & Consent
 *
 *  ADDITIONALLY: the HTML template content after </style> was also lost.
 *  Expected HTML structure (based on surviving CSS class names):
 *    - <div class="section-header">  (already present in loading state at line 396)
 *    - <div class="card filter-card"> with dropdowns for program/quota/specialty/hospital
 *    - <div id="mlMeta" class="current-meta-card">
 *    - <div class="ml-layout"> with:
 *        - <div class="ml-main"> containing:
 *            - <div class="sim-grid" id="mlGrid"> (the actual grid)
 *            - occupant/vacated sections
 *        - <div class="ml-replace-sidebar" id="mlReplaceSidebar"> with:
 *            - sidebar head with title + close button
 *            - sidebar list for replacement log entries
 *        - <div class="ml-sidebar-backdrop" id="mlSidebarBackdrop">
 *        - <button class="ml-sidebar-toggle" id="mlSidebarToggle">
 *
 *  POTENTIALLY RECOVERABLE (found in other files):
 *    - certForPreference(): found in BOTH admin-induction.js AND sim-core.js
 *      (but different implementations may have different signatures)
 *
 * ====================================================================
 *  3. WHAT SURVIVED (lines 1-695 + 697-1348)
 * ====================================================================
 *
 *  Lines 1-695: Good
 *    - IIFE setup, data structures, consent parsing, data loading,
 *      renderMeritListUI() function header + CSS template literal content
 *
 *  Lines 697-1348: Good (but consumed as string by unclosed template literal!)
 *    - showMeritListInfoModal()    - info modal about merit list mode
 *    - renderMlSlotBrowser()       - "Where Merit Falls" tab renderer
 *    - applyMlSbFilters()          - slot browser filter handler
 *    - buildMlSbQueue()            - merit-ordered queue builder
 *    - renderMlSbOverview()        - overview mode renderer
 *    - renderMlSbQueue()           - full queue renderer
 *    - showMlSbCandidateModal()    - candidate modal in slot browser
 *    - shortReasonForConsent()     - renders consent reason string
 *    - renderMlConsentWhatIf()     - "Consent What-If" tab renderer
 *    - mlCwRun()                   - consent what-if runner
 *    - getAcceptedProgramsForCandidate() - finds accepted programs
 *    - Animation injection         - adds mlFadeIn/mlSlideUp keyframes
 *    - IIFE closing: })();
 *
 *  SURVIVING FUNCTIONS that REFERENCE missing functions:
 *    These will cause ReferenceErrors at runtime:
 *    - reloadConsentData() calls:  batchAutoChain(), applyFilters(), applyMeritListTabSwap()
 *    - loadMeritData()   calls:   batchAutoChain(), renderMeritGrid() (via renderMeritListUI
 *                                  which is ALSO broken due to template literal issue)
 *    - renderMlSlotBrowser() relies on meritData being populated (it is)
 *    - buildMlSbQueue()  calls:   candidatePreferenceForSlot(), prefBonus(),
 *                                  slotKeyFor(), isEffectivelyProfileAccepted(),
 *                                  bestPublishedPlacementForApplicant()
 *    - mlCwRun()         calls:   getRowConsentVal(), slotKey(), listReplacementCandidates()
 *    - renderMlSbOverview() calls: getRowConsentVal()
 *    - applyMlSbFilters() uses:  renderMlSbOverview() / renderMlSbQueue() (these survived)
 *    - bestPublishedPlacementForApplicant() calls: prefNoFromCandidate()
 *    - getAcceptedProgramsForCandidate() calls: getRowConsentVal()
 *
 * ====================================================================
 *  4. RECOVERY APPROACH
 * ====================================================================
 *
 *  Option A: Surgical repair of template literal only
 *    - Add missing HTML content (</style> + section-header + filter-card + ml-layout + sidebar)
 *      back into the backtick template literal at line 529
 *    - Add closing backtick + semicolon
 *    - This lets the file parse correctly but the 32 missing functions
 *      are still gone → runtime ReferenceErrors
 *
 *  Option B: Full reconstruction (recommended)
 *    - The missing ~2131 lines include BOTH the HTML template content AND
 *      32 function definitions
 *    - These functions implement core merit list logic:
 *        - Slot rendering (renderMeritGrid)
 *        - Replacement chain logic (listReplacementCandidates, nextInLine,
 *          startChain, restoreConsent, restoreInitial, batchAutoChain)
 *        - Candidate/preference helpers (candidateForApplicant,
 *          candidatePreferenceForSlot, prefBonus, prefNoFromCandidate, etc.)
 *        - UI modals and interactions (showNextInLineModal,
 *          showCandidateInfoModal, etc.)
 *        - Sidebar and tab management (setupReplacementSidebar,
 *          renderReplacementSidebar, applyMeritListTabSwap)
 *    - These functions have NO equivalent in any other JS file
 *      (except certForPreference which exists in admin-induction.js and sim-core.js)
 *    - Manual reconstruction is the ONLY option since no backup exists
 *
 *  Option C: Minimal restoration to get parse+load working
 *    - Fix the template literal by adding </style> + closing backtick
 *    - Wrap all missing function calls in try/catch or provide stubs
 *    - Result: file loads without errors but merit replacement logic
 *      is non-functional
 *
 * ====================================================================
 *  5. DETAILS OF CORRUPTED vs ORIGINAL
 * ====================================================================
 *
 *  Template literal boundary analysis:
 *    Backtick open at   position 22564 (line 529): opens $tabContent.innerHTML = `...
 *    Backtick close at  position 34930 (line 700): closes at overlay.innerHTML = `...
 *                                                        (this should NOT close it)
 *    Expected close at  position ~34160 (inside the ~1400 lost lines)
 *
 *  The original had TWO template literals consecutively:
 *    1. $tabContent.innerHTML = `...HTML...`;  (at line 529)
 *    2. Then 32 function definitions
 *    3. Then showMeritListInfoModal() with its own overlay.innerHTML = `...`;
 *
 *  The corruption merged them: #1's backtick never closed, so it consumed
 *  the 32 function definitions AND the start of showMeritListInfoModal up to
 *  line 700's backtick.
 *
 * ====================================================================
 *  6. BYTES AT CORRUPTION SITE
 * ====================================================================
 *
 *  Offset 35287 (char offset in file):
 *    Before: ...  ml-modal-footer .btn { width:100%;text-align:center; } \r\n        } \r\n
 *    At:          20 20 20 20 20 20 20 2A 20 69 67 6E 6F 72 65 20 2A 2F 20 7D
 *                 (7 spaces)  *     i  g  n  o  r  e     *  /     }
 *    After:       \r\n    const overlay = document.createElement('div'); \r\n ...
 *
 *  7 characters of spacing, then " * ignore */ }" - the tail of a JS
 *  multi-line comment that was injected to replace the missing code.
 *
 * ====================================================================
 *  END OF ANALYSIS
 * ====================================================================
 */

console.log('[MeritList-Recovery] Analysis loaded. This file documents the corruption.');
console.log('[MeritList-Recovery] See comments above for full analysis.');
