# BrainHalf video advertising production pack

Prepared: 23 September 2026. Website: **https://brainhalf.com**.

This document contains complete timed scripts, English and Roman Urdu/Hinglish voiceovers, shot directions, and video-generation prompts. It is a production script; video and recorded audio files have not been rendered.

## 1. Deliverables

| Cut | Duration | Purpose | Visual versions | Voiceover versions |
|---|---|---|---|---|
| A — The idea in your notes | 00:30 | Short Instagram introduction | 9:16 and 16:9 | English and Urdu/Hinglish |
| B — Show the workflow | 01:00 | Product demonstration and consideration | 9:16 and 16:9 | English and Urdu/Hinglish |
| C — From brief to first version | 02:00 | Detailed demonstration | 9:16 and 16:9 | English and Urdu/Hinglish |
| D — Build something worth opening | 04:00 | Extended walkthrough and brand story | 9:16 and 16:9 | English and Urdu/Hinglish |

Produce **16 final exports**: four durations × two aspect ratios × two languages. Each export uses one spoken language throughout. English and Urdu tracks are alternatives, not two tracks played together. Urdu is written in Roman script for easy recording, subtitles, and editing; English product terms remain natural Hinglish.

Use the 9:16 versions for Instagram-first creative. The 16:9 versions are separate widescreen edits suitable for website and horizontal video placements. Treat the two- and four-minute cuts as extended content; placement eligibility and duration limits must be checked in the publishing interface. They are not assumed to fit every Instagram ad placement.

All timelines below are contiguous. A row marked 00:05–00:10 occupies those five seconds, including the voice, action, and transition. Transitions overlap inside the listed intervals and do not add runtime.

## 2. Campaign and visual direction

**Campaign idea:** “That idea deserves a first version.”

**Audience:** Founders, freelancers, students, creators, and small teams with a concrete web-app idea.

**Promise:** Describe an idea, explore a frontend preview, refine it through conversation, inspect the code, and export the project.

**Primary CTA:** “Start building at brainhalf.com.”

**Narrative:** A familiar unfinished idea becomes a specific brief, then something the creator can inspect, try, and improve. The product demonstration carries the message.

### Existing brand assets

- Use the supplied logo: [BrainHalf logo](public/brand/brainhalf-logo.png). Preserve its proportions and colors; composite it in the editor.
- Wordmark: **BrainHalf**, with this exact capitalization. Say it as **“Brain Half”**, two clear words.
- Light background: `#F8F9FC`; dark text: `#202631`; blue accent: `#3659D9`; white panels: `#FFFFFF`.
- Dark end card: `#11141B`, with light text `#EDF0F8` and soft blue `#A6B7FF`.
- Headlines: Bricolage Grotesque. Body and captions: Instrument Sans. Local font files are in [public/fonts](public/fonts).
- Visual motif: a rounded idea card expands into a real browser workspace. Reuse this transition consistently.
- Footage: natural desk lighting, one creator, one laptop, clean screen recordings, restrained cursor highlights, and readable typography.
- Keep the logo on a quiet background. Give it clear space roughly equal to the mark's height.

### Demo project and recording brief

Use a small project called **Northstar**, a personal task board. Its sample tasks are “Write the brief,” “Design the homepage,” and “Review the first version.” This is a suggested demo project to build and record, not a claim that footage already exists.

Initial prompt to record in BrainHalf:

> Build a personal task board called Northstar. Include To do, In progress, and Done columns. Let me add a task, move it between columns, and filter by priority. Use a clean blue and white design with a mobile-friendly layout. Explain how its data is stored.

Follow-up prompt to record:

> Make task titles easier to scan, improve the spacing on mobile, and add a clear empty state. Preserve the existing task actions.

Record the actual working interactions before editing the ad. Use actual BrainHalf screens for the homepage, chat, preview, source files, dashboard, and export. The landing page's illustrative showcase is not evidence of a generated app working. Display **“Edited demo” / “Mukhtasar demo”** during shortened generation sequences. Show the resulting screen only after it actually exists.

The scripts intentionally avoid promises of instant production deployment, guaranteed bug-free output, working payments, or automatically configured databases and Google sign-in. BrainHalf's hosted full-stack runtime is currently disabled; the ads focus on the demonstrated building, preview, refinement, and export workflow.

### Cloudflare and separate project databases

**Creative recommendation:** Mention Cloudflare briefly in the longer demonstrations. Explain database isolation to viewers as “separate databases for each project,” with the benefit that development and production data stay apart. Keep the short ads focused on making a first version.

**Current wording:** “BrainHalf runs on Cloudflare.” Urdu/Hinglish: “BrainHalf Cloudflare par chalta hai.” This describes the BrainHalf platform. It does not mean every generated app has a hosted backend or a provisioned database. The two- and four-minute scripts include this line.

**Implementation status checked on 23 September 2026:** The managed backend code provisions a Cloudflare D1 database for each project and environment, then binds the appropriate database to the generated Worker. The checked configuration has `RUNTIME_ENABLED=false` and an empty pilot allowlist; the latest deployment report also records execution as disabled. Live provisioning and cross-project isolation remain unverified. Sources: [runtime configuration](wrangler.runtime.jsonc), [project database provisioning](src/runtime/project.ts), [Worker database bindings](src/runtime/cloudflare-api.ts), and [rollout status](FULLSTACK_IMPLEMENTATION.md).

For a technical preview of the feature today, use: “BrainHalf's managed backend is designed for separate Cloudflare D1 databases per project and environment. Live rollout is still pending.” Urdu/Hinglish: “BrainHalf ka managed backend har project aur environment ke liye alag Cloudflare D1 database rakhne ke liye design hua hai. Live rollout abhi baqi hai.” This is an architecture explanation, not the default ad narration.

**Optional launch wording — use only after live provisioning and isolation are validated for the advertised audience:** Replace Cut D's 03:20–03:30 recap with the following ten-second scene; do not add runtime.

- English voice: “For supported apps, BrainHalf provides separate Cloudflare databases for each project, with development and production data kept apart.”
- Urdu/Hinglish voice: “Supported apps ke liye, BrainHalf har project ko alag Cloudflare database deta hai. Development aur production ka data bhi alag rehta hai.”
- Screen copy: “Separate project databases” / “Har project ka alag database.” Secondary labels: “Development” and “Production.”
- Picture: Start with the real database view of a validated managed app, then show an editorial diagram linking Project A and Project B to their respective development and production databases. Keep database IDs and credentials out of the recording.
- 9:16: Show one project and its two environment cards, then the other project. 16:9: Show the two projects side by side, each with its own two database cards.
- Both generation prompts for Cut D must use this replacement only when the launch version is selected. The current version retains its original recap.

Before using the launch wording, demonstrate live persistence, different database IDs for two projects and their environments, and rejected cross-project access through the app and control routes. If access is limited to a pilot, identify that audience in the ad. Separate databases do not establish authorization between users inside an app; that still depends on the app's access controls. Use “separate database” rather than implying dedicated physical servers or guaranteed security.

## 3. Aspect ratios and editing specifications

| Item | 9:16 vertical | 16:9 widescreen |
|---|---|---|
| Master size | 1080 × 1920 | 1920 × 1080 |
| Frame rate | 30 fps | 30 fps |
| Composition | One readable subject at a time; stack brief above preview when comparing | Brief/chat at left and preview at right; use full browser width when useful |
| Headline size | Start at 72–92 px | Start at 58–76 px |
| Subtitle size | Start at 48–60 px; maximum two lines | Start at 40–50 px; maximum two lines |
| Working safe area | Keep key copy around x=96–900, y=240–1440 | Keep key copy at least 96 px from the edges |
| App footage | Reframe and punch in on the relevant control; do not squeeze an entire desktop screen into a phone frame | Show the full workspace, then use gentle detail crops |
| CTA card | Logo above headline, then brainhalf.com; keep the URL above the lower interface overlays | Logo left, message and URL right, or use a centered lockup |
| Export starting point | H.264 MP4, 12–20 Mbps, AAC 48 kHz | H.264 MP4, 16–24 Mbps, AAC 48 kHz |

These safe areas and encoding values are production starting points, not guaranteed platform specifications. Check the final placement preview for interface overlap. Prepare the two layouts independently; a center crop will lose important app controls.

Subtitles follow the chosen voiceover word for word. The “Screen copy” column contains short additional headlines, not the full subtitle text. Use one headline at a time and avoid placing it over the active control.

## 4. Voice and sound direction

### English voice prompt

```text
Use one original adult female narrator with a warm, clear, conversational voice and an easy-to-understand international English accent. Sound like a thoughtful creator showing a useful tool. Start with curiosity, become more confident during the demonstration, and finish with an inviting call to action. Say BrainHalf as “Brain Half” and brainhalf.com as “Brain Half dot com.” Speak the supplied English lines exactly. Do not read timestamps, scene IDs, directions, or quotation marks. Use natural breaths and small pauses. Do not imitate a celebrity or identifiable person's voice. Record each timed line separately as clean, dry audio without music or reverb.
```

### Urdu/Hinglish voice prompt

```text
Use one original adult female narrator speaking natural Pakistani Urdu with familiar English product words. Read the supplied Roman Urdu lines as spoken Urdu, not as English spelling. The delivery is warm, confident, and conversational. Keep English words such as app, preview, dashboard, code, and export natural and easy to understand. Say BrainHalf as “Brain Half” and brainhalf.com as “Brain Half dot com.” Use the exact Urdu/Hinglish lines and preserve their meaning. Do not read timestamps or directions. Avoid a dramatic announcer delivery. Do not imitate a celebrity or identifiable person's voice. Record each timed line separately as clean, dry audio without music or reverb.
```

### Timing and mix

- Aim for roughly 125–150 spoken words per minute, with the short hook slightly brisker. Roman Urdu spelling is only an approximate guide to spoken pacing.
- Begin most lines about 0.15 seconds into their slot. Finish before the cut where practical, leaving the remaining time for the screen action.
- The voiceovers are paced drafts, not measured recordings. Record, listen, and trim pauses to fit each slot; do not rely on extreme audio speed changes.
- Record both languages independently. Use the same emotional progression, not mechanically identical syllable timing.
- Music: one licensed instrumental track with a light electronic pulse, soft percussion, and an optimistic lift. No sung lyrics under the voice.
- Suggested mix: voice stays clearly in front; music typically 18–24 dB below speech while narration is active. An approximately −14 LUFS integrated mix with peaks below −1 dBTP is a starting target, not a platform requirement.
- Sound effects: subtle typing, a single click for an actual action, a soft transition accent, and one short closing tone. Avoid constant notification sounds.
- Leave the final URL readable through the last frame. The music resolves at the exact end of the cut.

## 5. Cut A — 30 seconds: “The idea in your notes”

**Structure:** Recognition → BrainHalf → preview → refinement → export → CTA.

**Energy:** Brisk and focused. Six five-second scenes. Brand mark visible from the opening frame; full product reveal begins at 00:05.

| Time | English voiceover — exact line | Urdu/Hinglish voiceover — exact line | Picture and action | Screen copy — English / Urdu | 9:16 framing | 16:9 framing |
|---|---|---|---|---|---|---|
| 00:00–00:05 | That app idea is still sitting in your notes. | Aapki app ka idea abhi bhi notes mein para hai? | First two seconds: close-up of an idea note; next three: creator opens the laptop. Add BrainHalf mark in a quiet corner. | Still in your notes? / Idea abhi bhi notes mein? | Note fills the center; face appears briefly above it. | Note left, creator and laptop right. |
| 00:05–00:10 | Open BrainHalf and describe what you want to build. | BrainHalf kholein, aur batayein ke aap kya banana chahte hain. | Reveal actual homepage. Type the task-board idea and submit. Use an editorial cut to the generation sequence. | Describe your idea / Apna idea likhein | Enlarge the prompt field; keep the submit action visible. | Show the homepage, then push in toward the composer. |
| 00:10–00:15 | See your first version take shape in the preview. | Preview mein apni app ka pehla version dekhein. | Cut from a clearly shortened generation sequence to the real task-board preview. Hold on the completed layout. | Meet your first version / Pehla version dekhein | One large preview card; show a clear task title. | Preview occupies the right two-thirds; chat remains visible at left. |
| 00:15–00:20 | Ask for changes. Make the details feel like yours. | Changes batayein. Apni app ko apne andaaz mein behtar banayein. | Submit the recorded refinement prompt; cut to the actual revised spacing and title treatment. | Refine by conversation / Baat karke behtar banayein | Alternate close-up of chat and changed preview. | Brief side-by-side before/after, then revised preview. |
| 00:20–00:25 | Review the code, then export your project to keep building. | Code dekhein, project export karein, aur kaam aage barhayein. | Open actual source files, then click export. Show the real download beginning. | Your code. Keep building. / Aapka code. Kaam jaari rakhein. | Tight crop of the source panel, followed by export control. | Source panel and export action share the frame. |
| 00:25–00:30 | Bring your idea to BrainHalf. Start at BrainHalf dot com. | Apna idea BrainHalf par laayein. Shuru karein, BrainHalf dot com. | Clean end card. Logo settles during the first second; URL remains still through the last frame. | Start building / Banana shuru karein; brainhalf.com | Centered logo, short CTA, large URL stacked vertically. | Centered horizontal brand lockup with CTA and URL below. |

**Sound map:** 00:00 note tap; 00:02 music enters; 00:05 keyboard texture; 00:10 soft reveal accent; 00:15 click; 00:20 export click; 00:25 closing lift; 00:29.5 music resolves.

### A1 — 30-second 9:16 generation prompt

```text
Create the visual edit for a 30-second BrainHalf ad at 1080x1920, 9:16, 30 fps, using Cut A's six exact five-second scenes and the attached BrainHalf logo and genuine product recordings. Begin with a creator's app idea in a notes screen, reveal the BrainHalf prompt field, show the actual frontend preview, show a conversational revision, show code export, and end on brainhalf.com. Use #F8F9FC, #202631 and #3659D9, with clean rounded cards and restrained motion. Frame each app action large enough to read on a phone. Keep essential copy inside the vertical safe area. Generate lifestyle footage and transitions as separate scene clips; composite genuine UI and all text in the editor. For the English export, use Cut A's English voice and screen copy. For the Urdu/Hinglish export, use its Urdu voice and localized copy. One language per export. Follow the supplied voice and music directions. Total duration exactly 30 seconds; no additional intro or outro.
```

### A2 — 30-second 16:9 generation prompt

```text
Create a separate 1920x1080, 16:9, 30 fps version of BrainHalf Cut A, exactly 30 seconds. Follow its six five-second scenes and exact chosen-language voiceover. Use the existing BrainHalf logo, light blue-white visual identity, and genuine recordings of prompt, preview, refinement, source, and export. Compose the note and creator side by side at the opening. Use the horizontal workspace to show chat beside the app preview, then move closer to the export action. Finish with a balanced widescreen logo, CTA, and brainhalf.com card. Keep typography readable and away from edges. Generate only lifestyle footage and motion plates; composite product screens and text in the editor. Render English and Urdu/Hinglish as separate versions using the corresponding table columns. Do not create the horizontal version by stretching the vertical edit.
```

## 6. Cut B — 1 minute: “Show the workflow”

**Structure:** A relatable idea becomes a short, concrete tour. Ten six-second scenes.

| Time | English voiceover — exact line | Urdu/Hinglish voiceover — exact line | Picture and action | Screen copy — English / Urdu | 9:16 framing | 16:9 framing |
|---|---|---|---|---|---|---|
| 00:00–00:06 | A useful idea deserves more than another saved note on your phone. | Aapka achha idea sirf phone ke notes tak rehna zaroori nahi. | Creator scrolls past a saved app idea, pauses, and opens a laptop. Brand mark is already present. | Give that idea a start / Apne idea ko shuru karein | Close-up of phone, then creator reaction. | Creator left, note detail right. |
| 00:06–00:12 | Meet BrainHalf, a workspace where you can build web apps through conversation. | BrainHalf par aap baat cheet ke zariye apni web app bana sakte hain. | Match-cut the note into BrainHalf's real homepage composer. | Meet BrainHalf / BrainHalf se miliye | Logo above an enlarged composer. | Homepage fills the frame with a restrained push-in. |
| 00:12–00:18 | Describe who the app is for and what it should help them do. | Batayein app kis ke liye hai, aur usay kya kaam karna chahiye. | Type the Northstar brief; highlight the audience and task actions in the editor overlay. | Who is it for? / App kis ke liye hai? | Two highlighted phrases; each stays readable. | Prompt left, two brief callouts right. |
| 00:18–00:24 | BrainHalf generates a first version you can explore in the frontend preview. | BrainHalf pehla version banata hai, jise aap frontend preview mein dekh sakte hain. | Show generation with an “Edited demo” label, then the recorded first version. | Explore the preview / Preview dekhein | Cut from progress detail to a large app crop. | Actual chat and preview side by side. |
| 00:24–00:30 | Try the buttons, open the views, and see how your idea feels. | Buttons try karein, views kholein, aur dekhein aapka idea kaisa lagta hai. | Add a sample task and move it to In progress using actual working controls. | Try the interaction / Khud try karein | Follow one task and its control; avoid tiny columns. | Full board, with a brief cursor highlight. |
| 00:30–00:36 | Want a different layout? Ask for changes in clear, everyday language. | Layout badalna hai? Seedhe aur aasaan alfaaz mein apni changes batayein. | Submit the refinement prompt; show the revised result after a clean editorial cut. | Ask. Review. Refine. / Kahein. Dekhein. Behtar banayein. | Chat appears first, revised preview second. | Prompt strip above a larger revised preview. |
| 00:36–00:42 | Check the smaller screen too, and refine the details that need attention. | Chhoti screen bhi check karein, aur zaroori details ko aur behtar banayein. | Record a narrower preview and show the changed spacing with one readable highlight. | Check the smaller screen / Chhoti screen bhi dekhein | Show actual narrow preview at useful scale. | Desktop and narrow preview side by side. |
| 00:42–00:48 | You can inspect the generated files and export the source to continue. | Aap generated files dekh sakte hain, aur source export karke aage kaam karein. | Open file explorer, select a real file, and activate export. | Inspect and export / Code dekhein aur export karein | File name and export control are the focus. | Code panel occupies most of the frame. |
| 00:48–00:54 | Return to your dashboard when you are ready for the next session. | Jab dobara kaam karna ho, dashboard se apna project khol lein. | Show the actual dashboard and reopen the saved Northstar project. | Pick up your project / Apna project dobara kholein | One project card and its open action. | Dashboard grid, then transition into the selected project. |
| 00:54–01:00 | Your next project starts with an idea. Bring yours to BrainHalf dot com. | Aapka agla project ek idea se shuru hota hai. BrainHalf dot com kholein. | Return to creator, then clean CTA card for the final four seconds. | Start building at brainhalf.com / brainhalf.com par shuru karein | Creator briefly above the brand card, then full-frame CTA. | Creator at left, logo and URL at right; hold URL. |

**Sound map:** 00:00 dry note sound; 00:03 music begins; 00:12 light typing; 00:18 restrained reveal; 00:24–00:48 real interaction clicks; 00:48 rhythm simplifies; 00:54 closing lift; 00:59.5 resolve.

### B1 — 60-second 9:16 generation prompt

```text
Create a 60-second vertical BrainHalf product ad, 1080x1920, 30 fps. Follow Cut B's ten six-second scenes without gaps. Use a natural creator opening followed by genuine BrainHalf recordings: describe an app, generate a first version, try a task action, request a refinement, inspect a smaller screen, inspect and export code, and reopen the saved project from the dashboard. Use the supplied brand palette, original logo, and readable Bricolage Grotesque/Instrument Sans typography. In vertical shots, focus on one meaningful control at a time rather than shrinking the whole browser. Keep subtitles to two lines. Create one English version and one Urdu/Hinglish version using the exact corresponding script lines. Add a discreet shortened-generation label where needed. Composite all actual UI, logo, subtitles, and URL in the editor. Finish on brainhalf.com at precisely 01:00.
```

### B2 — 60-second 16:9 generation prompt

```text
Create an independently composed widescreen version of BrainHalf Cut B: 1920x1080, 16:9, 30 fps, exactly 60 seconds. Preserve all ten six-second scenes and their chosen-language narration. Use side-by-side brief and preview, then a desktop/mobile comparison, a readable source view, and the real dashboard. Use the creator only at the opening and closing so the product demonstration remains central. Maintain BrainHalf's white, charcoal, and blue identity with clean cuts and subtle motion. Genuine screen recordings must be composited, not invented by the video model. English and Urdu/Hinglish receive separate voice and subtitle exports. The last six seconds resolve into the supplied logo and brainhalf.com with one clear invitation to start building.
```

## 7. Cut C — 2 minutes: “From brief to first version”

**Structure:** A clear brief, a first version, hands-on inspection, refinement, and a practical next step. Twelve ten-second scenes.

**Energy:** Curious opening, confident middle, calm invitation. Within each ten-second slot, use a primary shot for about six seconds and a relevant detail for the remaining four.

| Time | English voiceover — exact line | Urdu/Hinglish voiceover — exact line | Picture and action | Screen copy — English / Urdu | 9:16 framing | 16:9 framing |
|---|---|---|---|---|---|---|
| 00:00–00:10 | You have an idea for a useful app. You can picture the problem it solves. Now you need a place to start. | Aapke paas ek kaam ki app ka idea hai. Masla bhi samajh aata hai. Ab usay banana kahan se shuru karein? | Creator writes “A better way to track my work.” Cut from the note to the laptop. BrainHalf mark visible from frame one. | You have the idea / Idea aapke paas hai | Creator close-up, then note fills the screen. | Creator on one side; the idea note on the other. |
| 00:10–00:20 | BrainHalf runs on Cloudflare. Describe your app idea, explore a first version, and keep improving it through a conversation. | BrainHalf Cloudflare par chalta hai. Apni app ka idea likhein, pehla version dekhein, aur baat karke usay behtar banate rahein. | Open BrainHalf; transition between homepage, chat, and preview. Add a brief “Runs on Cloudflare” text overlay, then focus on the prompt field. | Runs on Cloudflare / Cloudflare par chalta hai | Platform line above one large product crop; keep captions separate. | Platform line beside the real chat/preview workspace. |
| 00:20–00:30 | Start with a clear brief: who will use the app, what they need to do, and what belongs on the first screen. | Pehle saaf brief likhein: app kaun use karega, kya kaam karega, aur pehli screen par kya nazar aana chahiye. | Type the brief. Highlight audience, actions, and first screen as three distinct phrases. | Audience → Actions → First screen / Users → Kaam → Pehli screen | Stack three short brief cards vertically. | Brief at left; three numbered highlights at right. |
| 00:30–00:40 | For this project, we want a personal task board: clear columns, simple task actions, and a layout that works on smaller screens. | Is project mein humein personal task board chahiye: saaf columns, aasaan task actions, aur chhoti screen ke liye munasib layout. | Show the complete Northstar prompt and submit it once. Hold the readable project name. | Build Northstar / Northstar banayein | Prompt crop with Northstar and task actions visible. | Show the complete prompt in the real composer. |
| 00:40–00:50 | BrainHalf generates the initial project. Once the preview is ready, you can look through the layout and try the parts that matter. | BrainHalf pehla project banata hai. Preview tayyar hone par layout dekhein aur un cheezon ko try karein jo aapke liye zaroori hain. | Shortened generation footage transitions to the real first version. Keep “Edited demo / Mukhtasar demo” on the shortened portion. | Explore the first version / Pehla version dekhein | Progress detail, then large app preview. | Full workspace, followed by a preview close-up. |
| 00:50–01:00 | Use the preview like a visitor would. Add a task, change its status, and check whether the important information is easy to find. | Preview ko khud use karein. Task add karein, uska status badlein, aur dekhein ke zaroori maloomat aasani se mil rahi hai. | Add “Review the first version”; move it to In progress. The viewer sees the real state change. | Try the actual action / Asal action try karein | Follow the one task across two clear crops. | Keep all columns visible and highlight the changed task. |
| 01:00–01:10 | Now ask for a specific improvement. Make the task titles clearer, adjust the spacing, and give an empty board a helpful starting message. | Ab koi khaas behtari batayein. Task titles saaf karein, spacing badlein, aur khaali board par shuru karne ka aasaan paigham dikhayein. | Record the follow-up prompt, then show the actual revised title and empty state from a separate recording. | Make one useful improvement / Ek kaam ki behtari karein | Brief first, then two close-ups of revised details. | Before and after with clear, simple labels. |
| 01:10–01:20 | Small changes deserve another look. Check the revised screen, try the interaction again, and keep the parts that work for your project. | Chhoti tabdeeli bhi dobara check karein. Nayi screen dekhein, action phir try karein, aur jo cheez kaam kare usay rakhein. | Re-test the task action after the visual change; briefly show the narrow layout. | Refine, then review / Behtar banayein, phir check karein | Task interaction followed by narrow preview. | Revised desktop view with a narrow-preview inset. |
| 01:20–01:30 | Take a look at the source too. BrainHalf lets you inspect the generated files and continue working with the code behind your app. | Source code bhi dekhein. BrainHalf mein generated files khol sakte hain aur apni app ke code par aage kaam kar sakte hain. | Open the file explorer and select the component associated with the visible task board. | See the source / Source code dekhein | Enlarge the real file name and a few readable lines. | Preview left, related source file right. |
| 01:30–01:40 | When you want to continue elsewhere, export your project. And when you return to BrainHalf, open your recent work from the dashboard. | Doosre tools mein kaam karna ho to project export karein. BrainHalf par wapas aayein to dashboard se apna pichhla kaam khol lein. | Real export action, then actual dashboard with Northstar selected. | Export. Return. Continue. / Export karein. Wapas aayein. Kaam jaari rakhein. | Export close-up followed by one recent-project card. | Export area, then a wider dashboard overview. |
| 01:40–01:50 | Review your project, test what matters, and connect any extra services your idea needs before you launch. Build the next step with confidence. | Launch se pehle project check karein, zaroori features test karein, aur jo extra services chahiye unhein connect karein. Phir agla qadam barhayein. | Show a clearly editorial checklist: review, test, configure. Return to the creator inspecting the result; no unverified integration success screens. | Review before launch / Launch se pehle check karein | Three checklist lines above a preview crop. | Creator at left; checklist and preview at right. |
| 01:50–02:00 | Your idea does not need to stay a note. Give it a first version, then make it better. Start at BrainHalf dot com. | Aapka idea sirf note ban kar rehna zaroori nahi. Pehla version banayein, phir usay behtar karein. Shuru karein, BrainHalf dot com. | The opening note becomes a compact project card, then resolves into the logo and URL. Hold the end card for at least four seconds. | Give your idea a first version / Apne idea ka pehla version banayein; brainhalf.com | Idea card expands vertically into the end card. | Idea card and browser meet in the center, then fade to CTA. |

**Sound map:** 00:00 quiet desk ambience; 00:06 light music enters; 00:20 rhythm begins; 00:40 reveal accent; 01:00 a fresh musical layer marks refinement; 01:20 reduce percussion for code inspection; 01:40 soften the track; 01:50 final lift; 01:59.5 resolve.

### C1 — 120-second 9:16 generation prompt

```text
Create the 120-second vertical BrainHalf demonstration described in Cut C. Format: 1080x1920, 9:16, 30 fps. Use all twelve ten-second scenes, with no extra runtime. Tell one continuous story: a creator describes the Northstar task board, explores its generated frontend, tests a task action, asks for a concrete refinement, checks the revised layout, inspects source files, exports the project, and returns through the dashboard. Use real BrainHalf recordings, the supplied logo, and the documented light/blue brand palette. In each ten-second slot, alternate a primary shot and one useful detail so phone viewers can read the action. Place exact selected-language subtitles separately from short headlines. Build English and Urdu/Hinglish exports from their respective voiceover columns. Generate lifestyle and transition clips individually; composite actual UI and typography during editing. Keep the final brainhalf.com card visible for at least four seconds. Do not depict unverified hosting, email, database, or payment success.
```

### C2 — 120-second 16:9 generation prompt

```text
Create a 1920x1080 widescreen edit of BrainHalf Cut C, 16:9, 30 fps, exactly two minutes. Keep the twelve ten-second story beats and exact chosen-language narration. Use the horizontal space to connect the written brief to the real preview, compare the first and revised layouts, and show source beside the associated UI. Include restrained creator footage at the beginning and the review-before-launch moment. Recompose every shot for widescreen, using genuine BrainHalf recordings and the original logo. Use smooth push-ins, clean cuts, and the supplied blue-white brand styling. English and Urdu/Hinglish are separate audio/subtitle versions. Do not add invented dashboards or unsupported success states. Finish with the idea card transforming into a centered BrainHalf logo and brainhalf.com. All transitions stay inside the specified 120 seconds.
```

## 8. Cut D — 4 minutes: “Build something worth opening”

**Structure:** A guided demonstration with one coherent project, rather than a longer collection of unrelated feature shots. Twenty-four ten-second scenes.

**Energy:** A helpful creator showing their workflow. Refresh the composition about every thirty seconds, while keeping the product and example consistent. Use the final ten seconds for a clear invitation.

| Time | English voiceover — exact line | Urdu/Hinglish voiceover — exact line | Picture and action | Screen copy — English / Urdu | 9:16 framing | 16:9 framing |
|---|---|---|---|---|---|---|
| 00:00–00:10 | There is probably an app you wish existed. Something for your work, your clients, or one small problem you keep solving by hand. | Shayad aap bhi ek app chahte hain. Apne kaam ke liye, clients ke liye, ya kisi roz ke maslay ko aasaan banane ke liye. | Creator moves between a notebook and a scattered task list. End on one simple idea. Brand mark visible throughout. | What would you build? / Aap kya banana chahenge? | Close-up of creator, then one readable note. | Desk composition with notebook and laptop in view. |
| 00:10–00:20 | BrainHalf runs on Cloudflare and gives you a place to build. Describe your app, then explore and refine it through conversation. | BrainHalf Cloudflare par chalta hai aur app banane ki jagah deta hai. Apni zaroorat batayein, phir baat karke project ko behtar banayein. | Reveal BrainHalf and move from the homepage composer into the actual workspace. Add a brief platform text overlay. | Runs on Cloudflare / Cloudflare par chalta hai | Platform line above a centered workspace detail. | Homepage transitions into a full workspace with the platform line alongside it. |
| 00:20–00:30 | Let us make the idea specific. Our example is Northstar, a personal task board for keeping the next piece of work in view. | Chaliye idea ko saaf karte hain. Hamari misaal Northstar hai, ek personal task board jo agla kaam nazar ke saamne rakhta hai. | Present a clean editorial brief card named Northstar. Keep it distinct from app UI. | Northstar: a personal task board / Northstar: apne kaam ka task board | Brief card centered with three short actions below. | Brief card left; creator typing at right. |
| 00:30–00:40 | A useful brief explains three things: who the app is for, what they can do, and what the first version should include. | Achha brief teen baatein batata hai: app kis ke liye hai, user kya karega, aur pehle version mein kya hona chahiye. | Highlight the audience, actions, and scope in the written brief one at a time. | Audience. Actions. Scope. / Users. Kaam. Pehla version. | Three vertically stacked highlights. | Three brief columns around the actual prompt. |
| 00:40–00:50 | For Northstar, we want clear task columns, an easy way to add work, and simple controls for moving a task to its next stage. | Northstar mein saaf task columns chahiye, naya kaam add karna aasaan ho, aur task ko agle stage par le jane ke seedhe controls hon. | Type the concrete task-board requirements; highlight the three column names. | To do → In progress → Done / Karna hai → Jaari hai → Mukammal | Show one column name at a time beside the prompt. | Three column labels aligned above the composer. |
| 00:50–01:00 | We also describe the visual direction: a clean blue and white layout, readable titles, and a smaller-screen view that keeps the important actions accessible. | Design bhi batayein: saaf blue aur white layout, parhne mein aasaan titles, aur chhoti screen par bhi zaroori actions asaani se nazar aayein. | Show style instructions in the prompt and a restrained color strip taken from the app's intended palette. | Give the design direction / Design ki direction batayein | Prompt detail and two simple color swatches. | Prompt at left; clean style card at right. |
| 01:00–01:10 | Submit the brief and let BrainHalf generate the initial project. This demonstration shortens the wait so we can focus on reviewing the result together. | Brief submit karein aur BrainHalf ko pehla project banane dein. Is demo mein intezar mukhtasar hai, taake hum result ko dekh sakein. | Record the real submit action; use a labeled edit to move through generation. Do not add a fabricated countdown. | Edited demo / Mukhtasar demo | Progress detail, then a clearly marked transition. | Full workspace with the shortened-generation label. |
| 01:10–01:20 | When the preview is ready, begin with the overall layout. Can you understand the screen quickly, and can you spot the next action? | Preview tayyar ho to pehle poora layout dekhein. Kya screen jaldi samajh aati hai? Kya agla action aasani se nazar aata hai? | Hold the genuine first version long enough to read. Highlight the task-entry control without clicking yet. | Find the next action / Agla action dekhein | Preview crop that includes the main action. | Full task board and a gentle cursor highlight. |
| 01:20–01:30 | Now try a real interaction. Add a sample task, move it into progress, and check that the board responds the way you expect. | Ab khud try karein. Ek sample task add karein, usay progress mein le jayein, aur dekhein board sahi tarah respond karta hai. | Add “Review the first version” and move it with the actual supported control. | Add a task. Move it. / Task add karein. Aage barhayein. | Follow the task with deliberate close-ups. | Keep task entry and destination column visible together. |
| 01:30–01:40 | The first version gives you something concrete to respond to. You can now explain what should change by pointing to a real screen. | Pehla version dekh kar aap behtari aasani se samjha sakte hain. Ab kisi asal screen ko dekh kar batayein ke kya badalna hai. | Creator identifies a crowded title or spacing issue. Use one editorial annotation tied to an actual observed detail. | Make feedback specific / Feedback saaf dein | One highlighted detail fills most of the frame. | Preview left, short annotation right. |
| 01:40–01:50 | Ask for one useful improvement: clearer task titles, more comfortable spacing, or an empty state that helps someone know where to begin. | Ek kaam ki behtari kahein: task titles saaf hon, spacing behtar ho, ya khaali screen par shuru karne ka aasaan paigham ho. | Type the refinement prompt from the recording brief. Keep the request short and readable. | One clear improvement / Ek saaf behtari | Chat crop; show the full short request. | Chat left and the relevant preview section right. |
| 01:50–02:00 | After the revision, compare the actual screens. Look at what changed, keep what helps, and ask another question if something still needs work. | Tabdeeli ke baad dono screens dekhein. Jo behtar hua usay rakhein, aur jahan abhi kaam chahiye wahan ek aur saaf request dein. | Show a real before/after pair and point to the specific revision. | Review the revision / Tabdeeli dobara dekhein | Before above, after below; only one component at a time. | Before left, after right at equal scale. |
| 02:00–02:10 | Visual changes are only part of the review. Try the task action again, and make sure the changes did not interrupt the basic workflow. | Sirf design dekhna kaafi nahi. Task ka action phir try karein aur tasalli karein ke tabdeeli ke baad bhi zaroori kaam sahi hota hai. | Repeat the same task interaction after the revision. Show the successful state change from the real preview. | Try the workflow again / Kaam dobara try karein | Task action close-up followed by resulting state. | Full board, then close-up on the changed card. |
| 02:10–02:20 | Check the ordinary edge cases too. A long task title, an empty list, or an unfinished input can reveal where your app needs attention. | Aam mushkil cases bhi dekhein. Lamba task title, khaali list, ya adhoora input bata sakta hai ke app mein kahan behtari chahiye. | Record a long title and empty input. Show the real outcome; if it needs repair, show the repair request before a later corrected shot. | Long text. Empty input. / Lamba text. Khaali input. | Alternate two readable close-ups. | Two detail panels with simple labels. |
| 02:20–02:30 | Then look at the smaller screen. Check whether the text remains readable, the controls stay reachable, and the main action is still easy to find. | Phir chhoti screen dekhein. Text saaf parh sakte hain? Controls use karna aasaan hai? Kya main action abhi bhi seedha nazar aa raha hai? | Show the actual narrow preview; scroll a little and use the main action once. | Check the mobile layout / Mobile layout check karein | Narrow preview is the hero; avoid decorative phone chrome. | Wide and narrow previews shown at useful sizes. |
| 02:30–02:40 | Keep your follow-up requests focused. A clear change is easier to review, and each good revision helps you understand the product you are building. | Agli request bhi saaf rakhein. Ek wazeh tabdeeli check karna aasaan hota hai, aur har behtari se apna product aur samajh aata hai. | Show a short request and the exact corresponding change. Keep unrelated UI steady. | One request. One review. / Ek request. Ek review. | Chat line above the changed component. | Prompt callout beside a larger preview. |
| 02:40–02:50 | You can also inspect the generated source files. Open the part of the project you want to understand and connect the code to the screen. | Generated source files bhi dekh sakte hain. Project ka mutalliq hissa kholein aur samjhein ke code ka screen se kya talluq hai. | Open the actual source file behind the task board. Highlight a relevant component name without inventing code. | Inspect the source / Source code dekhein | File name and a small, legible section of code. | Source and matching preview side by side. |
| 02:50–03:00 | When you want to continue in your own tools, export the project. Keep the source available for further development, review, and the next stage. | Apne tools mein aage kaam karna ho to project export karein. Source aapke paas rahega, mazeed development, review, aur agle marhalay ke liye. | Click the real export action and show the resulting file in the download area. | Export your project / Apna project export karein | Export control, then readable downloaded filename. | Workspace and download area visible together. |
| 03:00–03:10 | That makes the first version a practical starting point. You can study it, refine it further, or work with a developer on the next requirements. | Yeh pehla version ek kaam ka starting point ban sakta hai. Isay samjhein, mazeed behtar karein, ya agle kaam mein developer ki madad lein. | Show the exported project open in an editor. Use only actual exported files; transition back to the preview. | Keep building from here / Yahan se aage barhein | Editor detail followed by the app preview. | Exported project left; app preview right. |
| 03:10–03:20 | Back in BrainHalf, the dashboard helps you return to recent projects. Open your saved work and choose the next detail you want to improve. | BrainHalf ke dashboard se pichhle projects par wapas aa sakte hain. Apna saved kaam kholein aur agla hissa chun lein jise behtar banana hai. | Open the actual dashboard and select Northstar. Let its saved project name remain readable. | Return to your work / Apne kaam par wapas aayein | One recent-project card and its open action. | Dashboard grid, then selected project workspace. |
| 03:20–03:30 | Your process can stay simple: describe a need, review the result, try the interaction, and improve one thing before moving to the next. | Tareeqa seedha rakhein: zaroorat batayein, result dekhein, action try karein, aur agle qadam se pehle ek cheez ko behtar banayein. | Four editorial cards summarize the actual steps just shown. Briefly revisit their matching footage. | Describe → Review → Try → Refine / Batayein → Dekhein → Try karein → Behtar banayein | Four vertically sequenced cards, not all competing at once. | Four steps in a single horizontal sequence. |
| 03:30–03:40 | If your app needs a database, email, or sign-in, connect and test those services before launch. A frontend preview is one part of verification. | Agar app ko database, email, ya sign-in chahiye, launch se pehle unhein connect aur test karein. Frontend preview verification ka ek hissa hai. | Use a clearly editorial preparation checklist. Show configuration as a next step, not completed service success. | Connect and test before launch / Launch se pehle connect aur test karein | Three service labels with “Setup + test” copy. | Preparation checklist beside the app preview. |
| 03:40–03:50 | Show the first version to someone who would use it. Ask what feels clear, what is missing, and what would make it more useful. | Pehla version kisi aise shakhs ko dikhayein jo isay use karega. Poochein kya saaf hai, kya kami hai, aur kya zyada kaam aa sakta hai. | Creator shares the laptop view with a colleague. Use a natural reaction, not a staged testimonial or claimed customer result. | Turn feedback into the next step / Feedback se agla qadam chun lein | Two-person reaction followed by a short feedback note. | Both people and the laptop remain in frame. |
| 03:50–04:00 | Bring one useful idea. Give it a first version. Then keep making it better. Your next project can start at BrainHalf dot com. | Ek kaam ka idea laayein. Uska pehla version banayein. Phir usay behtar karte rahein. Aapka agla project shuru ho sakta hai, BrainHalf dot com. | Revisit the opening idea note, now beside the project. Resolve into the final brand card by 03:55 and hold through 04:00. | Your idea. Your next step. / Aapka idea. Aapka agla qadam.; brainhalf.com | Centered logo, CTA, and large URL stacked with clear space. | Spacious horizontal brand lockup and a centered URL. |

**Sound map:** 00:00–00:20 intimate desk ambience and a soft pulse; 00:20–01:00 steady rhythm under the brief; 01:00 generation transition accent; 01:10–02:00 light demonstration bed; 02:00–02:40 simplify for review; 02:40–03:20 a gentle lift through source/export/dashboard; 03:20–03:40 quiet explanation; 03:40–04:00 final melodic lift and clean resolution.

### D1 — 240-second 9:16 generation prompt

```text
Create a four-minute vertical BrainHalf walkthrough using Cut D's twenty-four ten-second scenes. Output 1080x1920, 9:16, 30 fps, exactly 240 seconds. Follow one creator and one real project, Northstar, from a written need through a concrete brief, the actual generation sequence, frontend review, task interaction, conversational refinement, edge-case checks, smaller-screen inspection, source exploration, export, and dashboard return. Include the script's honest explanation that additional backend services need configuration and testing. Use natural lifestyle footage and genuine BrainHalf recordings with readable phone-scale crops. Refresh the composition roughly every thirty seconds while keeping the project continuous. Use the supplied logo, blue-white palette, restrained motion, and exact English or Urdu/Hinglish narration. Make separate language exports. Generate individual clips rather than relying on a video model to maintain four minutes of exact UI and text. Composite the product recordings, captions, and branding in the editor. Hold the final CTA from approximately 03:55 to 04:00.
```

### D2 — 240-second 16:9 generation prompt

```text
Create an independent widescreen production of BrainHalf Cut D at 1920x1080, 16:9, 30 fps, exactly four minutes. Follow the twenty-four timed scenes and the exact selected-language voiceover. Use the horizontal workspace for meaningful comparisons: the brief beside the app, initial and revised layouts, desktop and narrow previews, source beside the related interface, and the exported project beside the working frontend. Include the creator at the opening and feedback scene, with product footage carrying the walkthrough. Preserve the real BrainHalf interface and supplied logo; all readable screens and text must be composited from genuine assets. Use clean cuts, measured push-ins, and licensed instrumental music under the narration. Produce English and Urdu/Hinglish versions separately. Keep the service-configuration explanation and end on brainhalf.com for the final five seconds. Do not stretch or letterbox the vertical edit as a substitute for this layout.
```

## 9. Production handoff

### From script to finished edit

1. Build and record the Northstar demo. Capture the homepage, prompt submission, first preview, task actions, refinements, narrow layout, source, export, and dashboard return. Save the initial and revised views separately for comparisons.
2. Record each voiceover row separately in both languages, using section 4. Keep one consistent narrator per language across all four cuts. Export clean mono WAV at 48 kHz, 24-bit. Listen to every line against its scene duration before assembling the edit.
3. Use the eight generation prompts as master creative briefs. For a tool that generates short clips, use the scene template below for each required lifestyle shot or transition. Assemble the exact total duration in an editor; a prompt alone does not enforce frame-accurate timing.
4. Build each cut in 9:16 and 16:9 using its framing columns. Insert the genuine product recordings and supplied branding. Trim clips and transitions inside the allocated scene times.
5. Duplicate each layout for the second language. Replace the narration, short screen copy, and subtitles with that language's version. Keep actual product UI labels as recorded. Split long narration lines into readable subtitle cues synchronized to the spoken words.
6. Mix music under the voice and hold the final URL. Export the sixteen named videos below, plus matching SRT captions and a copy without burned-in captions for each. These companion files do not represent additional creative variants.

### Reusable single-scene generation prompt

Replace every bracketed field with the selected table row before submitting:

```text
Create one [5 / 6 / 10]-second visual clip for BrainHalf Cut [A / B / C / D], scene [number], covering [start time] to [end time]. Format: [1080x1920 at 9:16 / 1920x1080 at 16:9], 30 fps. Action: [paste the Picture and action cell]. Composition: [paste the selected framing cell]. Match the approved reference creator, wardrobe, desk, laptop, and lighting across scenes. Use the documented BrainHalf palette and restrained camera movement. Generate the lifestyle footage or background plate only; leave laptop screen areas suitable for compositing supplied genuine product recordings. Leave clear space for the headline and subtitles. Do not generate readable UI, logos, text, narration, or music. The editor will add these from the supplied assets and selected-language script. Keep all motion within this scene's duration, with a clean start and end for editing.
```

For a scene consisting entirely of an app action or end card, use the screen recording or supplied logo directly in the editor; no generated clip is needed. Generate a longer clip and trim it if the chosen tool cannot produce the exact scene length.

### File naming and export manifest

Voice clips: `brainhalf_A_s01_en.wav`, `brainhalf_A_s01_ur.wav`, and so on. Scene numbers restart at 01 for each cut. `ur` means the Roman Urdu/Hinglish script in this document. Reuse a cut's approved narration across both aspect ratios.

| Duration | English 9:16 | Urdu/Hinglish 9:16 | English 16:9 | Urdu/Hinglish 16:9 |
|---|---|---|---|---|
| 30 seconds | `brainhalf_030s_9x16_en.mp4` | `brainhalf_030s_9x16_ur.mp4` | `brainhalf_030s_16x9_en.mp4` | `brainhalf_030s_16x9_ur.mp4` |
| 60 seconds | `brainhalf_060s_9x16_en.mp4` | `brainhalf_060s_9x16_ur.mp4` | `brainhalf_060s_16x9_en.mp4` | `brainhalf_060s_16x9_ur.mp4` |
| 120 seconds | `brainhalf_120s_9x16_en.mp4` | `brainhalf_120s_9x16_ur.mp4` | `brainhalf_120s_16x9_en.mp4` | `brainhalf_120s_16x9_ur.mp4` |
| 240 seconds | `brainhalf_240s_9x16_en.mp4` | `brainhalf_240s_9x16_ur.mp4` | `brainhalf_240s_16x9_en.mp4` | `brainhalf_240s_16x9_ur.mp4` |

Caption files use the same basename with `.srt`. Copies without burned-in captions add `_clean` before `.mp4`; they still include the chosen narration, branding, and short headlines.

### Final playback check

- At 30 fps, the cuts contain exactly 900, 1,800, 3,600, and 7,200 frames respectively. Check that the last spoken word is audible and the URL remains readable through the final frame.
- Watch each layout on a phone and a larger screen. Headlines, subtitles, and active app controls must remain legible without overlapping.
- Listen to both languages independently. Check “Brain Half dot com,” natural Urdu pronunciation, sentence endings, subtitle synchronization, and music balance. The word-count review supports the planned pace; actual voice recordings still determine the final timing.
- Confirm that every demonstrated app action matches the recording, shortened sequences carry their label, and the final destination is **https://brainhalf.com**.

This pack provides scripts and production instructions. The demo recordings, narrated audio, subtitles, and exported videos are production deliverables to create from it.
