# IVM — Platform Testing Guide

**Date**: 2026-04-08  
**URL**: https://72.62.75.247 (click "Advanced → Proceed" past the SSL warning)  
**Test login**: `dev@ivm.local` / `password123`

---

## Before You Start

Have these ready:
- A photo or scanned image of any document with text fields (invoice, form, business card)
- A fillable PDF form (any PDF with form fields)
- A Word document (.docx) with `{{firstName}}` style placeholders

---

## 1. Sign In / Sign Up

**Sign In**
1. Go to the app URL
2. Enter `dev@ivm.local` and `password123` → click **Sign In**
3. ✅ You land on the dashboard

**Sign Up (new account)**
1. Click **Sign up** on the login page
2. Enter a new email + password → click **Create Account**
3. ✅ You land on the dashboard automatically

**What should NOT happen:**
- Signing in with a wrong password should show an error, not crash
- Leaving fields blank should show a validation message

---

## 2. Dashboard

1. After login, you see the sessions list (empty on first use)
2. ✅ There's a **New Session** button visible
3. Click **New Session** → you're taken to the session creation step

---

## 3. Create a Session & Upload Source Document

1. Click **New Session**
2. Give the session a name (e.g. "Invoice Test")
3. On the **Source** step, upload your test image or PDF
   - Drag and drop, or click to browse
4. ✅ File uploads, you see a preview or filename confirmed
5. Click **Next** to proceed

**Edge cases to test:**
- Upload a `.exe` or `.txt` file → should show an error ("unsupported file type")
- Upload a file larger than 10MB → should show an error ("file too large")
- Upload a second file → should replace the first (only one file at a time)

---

## 4. AI Field Extraction

1. After uploading, click **Extract Fields** (or it may auto-start)
2. ✅ A loading indicator appears while the AI processes the document
3. ✅ A table of extracted fields appears — each row shows:
   - Field name (e.g. "Invoice Number", "Date", "Total")
   - Extracted value
   - Field type (TEXT, DATE, NUMBER, etc.)
   - Confidence score (low/medium/high or a percentage)

**Test editing a field:**
1. Click on any field value in the table
2. Edit the text
3. ✅ Change saves and the updated value is shown
4. Click **Next** to proceed to Target

**What should NOT happen:**
- Clicking Extract with no file uploaded should show an error
- Fields should never be completely empty if the document has readable text

---

## 5. Set the Fill Target

You choose what you want to fill. Three options:

### Option A — Webpage Form
1. Select **Webpage** as target type
2. Paste a URL with a form (try `https://httpbin.org/forms/post`)
3. Click **Inspect** or **Next**
4. ✅ A list of detected form fields appears (name, email, phone, etc.)

### Option B — PDF Form
1. Select **PDF** as target type
2. Upload a fillable PDF (one with interactive form fields)
3. ✅ Form fields detected and listed

### Option C — Word Document
1. Select **DOCX** as target type
2. Upload a Word document that has `{{placeholder}}` text in it
3. ✅ Placeholder names detected and listed

**Edge cases:**
- Entering a URL that doesn't exist should show an error, not hang forever
- Uploading a PDF with no form fields should show an empty fields list (not crash)
- You can change/replace the target and set a new one

---

## 6. Review AI Field Mapping

1. After setting the target, click **Propose Mapping** (or it auto-proposes)
2. ✅ A table appears showing:
   - Left side: extracted field from your source document
   - Right side: the target form field it maps to
   - A **confidence** indicator
   - A **reason** explaining why the AI made this match
3. For each row, you can:
   - ✅ **Approve** the mapping (checkmark)
   - ❌ **Reject** it (remove/skip it)
   - ✏️ **Edit** the value that will be filled in
4. Once happy, click **Approve All** or approve individually
5. Click **Next** to proceed to Fill

**What to check:**
- Fields with low confidence should be easy to spot (different badge colour)
- Editing a value inline should save immediately
- Unmapped target fields (no source match) should appear clearly labelled

---

## 7. Execute Fill

1. On the Fill step, click **Fill Now** (or similar)
2. ✅ A results summary appears showing:
   - How many fields were filled
   - How many were verified
   - Any that failed or were skipped

### If target is a PDF or DOCX:
- A **Download** button appears
- Click it → file downloads
- Open the file → form fields should contain the mapped values

### If target is a Webpage:
- A **JavaScript snippet** appears in a code box
- Copy it
- Open the target webpage in a new tab
- Open browser DevTools (F12) → Console tab
- Paste the snippet and press Enter
- ✅ The form fields on the page fill in automatically

**What should NOT happen:**
- Filling should not be possible if you haven't approved the mapping first
- Running fill a second time should work (overwrite previous, no duplicates)

---

## 8. Review & Complete

1. After filling, you're on the **Review** step
2. Two tabs:

### Results Tab
- Shows the fill report (fields applied / verified / failed)
- A table with every field and its fill status
- **Download Filled Document** button (PDF/DOCX only)
- **Export Session** button — downloads a full JSON summary of everything
- **Complete Session** button

### History Tab
- A timeline showing every action taken during the session (upload, extract, map, fill, etc.)
- Session metadata: creation date, AI provider used, file name, status, field counts

3. Click **Complete Session** → session is marked as Done
4. ✅ You're taken back to the dashboard and the session shows **Completed** status

---

## 9. Settings — API Keys

1. Click your profile or **Settings** in the sidebar
2. You see the **API Keys** section
3. Paste a valid API key for Anthropic, OpenAI, or Gemini → click **Save**
4. ✅ Key is accepted and shown as active (masked, e.g. `sk-ant-...****`)
5. You can also **Delete** a saved key
6. Set your **Preferred Provider** (the AI it uses by default)

**Edge cases:**
- Saving an obviously wrong key (random text) should show a validation error
- Deleting a key should remove it immediately

---

## 10. Session List (Dashboard)

1. After completing sessions, the dashboard shows all your sessions
2. Each session card shows: name, status badge, date created
3. ✅ Clicking a session reopens it at the correct step
4. ✅ Sessions from other accounts are NOT visible

---

## Quick Smoke Test (5 minutes)

Run this to confirm the platform is working end-to-end:

1. Sign in
2. Create a new session
3. Upload any image with readable text
4. Extract fields — confirm at least one field appears
5. Set target to `https://httpbin.org/forms/post`
6. Propose mapping — confirm matches appear
7. Approve all → Fill → confirm "applied" count > 0
8. Copy the JS snippet → paste in browser console on the target page → fields fill in
9. Complete session → session shows Completed on dashboard

✅ If all 9 steps work without errors — the platform is functional.
