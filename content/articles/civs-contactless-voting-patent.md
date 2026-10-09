---
title: "A Voting Booth You Never Touch, From Face Scan to Thumbs Up"
description: "CIVS is a patented contactless voting kiosk that verifies a voter's face with ArcFace and takes the ballot by hand gesture, built in Python and Flask."
date: 2026-10-03
slug: civs-contactless-voting-patent
project: "CIVS"
tags: [Computer Vision, MediaPipe, DeepFace, YOLO, Flask, Patent]
award: "Granted Patent (ID 202341031598)"
repo: https://github.com/anirxdh/CIVS
accent: "#5b8def"
summary: "CIVS is a contactless voting kiosk that checks a voter's face against registered ID photos, then records a ballot chosen by holding up fingers and confirmed with a thumbs up. The design was granted a patent in May 2023, and the current code runs as a Flask app with four vision models."
---

## The button everyone presses

A polling booth has one surface that every voter touches: the ballot button. That is a hygiene problem for everyone, and it was already a usability problem for voters who cannot press a small button reliably. I wanted to know if a webcam could replace that button, for both identity and the vote itself.

CIVS (Contactless Integrated Voting System) is a touch-free voting kiosk that verifies a voter by face and records their ballot from hand gestures, built by Anirudh Vasudevan as a personal and academic project. The design was filed as a patent and granted in May 2023 under ID 202341031598. The public repo holds the hand-gesture half, called HGVS inside the project. The speech half, AGVS, exists only as commented-out routes and an unrouted audio_voting.html template.

The system had two lives: a tkinter desktop app running a CNN I trained on my own hand photos, and the Flask kiosk in the repo today, rebuilt in early 2026 with face verification in front and MediaPipe landmarks reading the gestures. This article covers both, including the part where my own model ended up loaded but unused.

## Why gestures and a face, not a QR code

The obvious contactless approach is a phone: scan a QR code, vote on your own screen. A phone moves trust to a device the election does not control, and it excludes the people I most wanted to include, voters without a smartphone and voters who struggle with a touchscreen.

Voice was the other option, and the README lists it as a second mode, AGVS, alongside gesture. Recognizing "party three" is easy, but a spoken vote is not secret from the next person in line, so I built out gesture first.

Within gesture, I first took the classic route and trained a CNN on hand masks I captured myself (details below). It works only with a fixed region of interest and a stable background, which a kiosk cannot promise. For the rebuild I switched to MediaPipe hand landmarks and counted fingers from joint positions, which ignores background entirely.

For identity I needed one-to-many matching against registered photos. DeepFace with ArcFace gave me a verify call that compares two images and returns a boolean. It is slow on a laptop CPU, which forced the two-thread design below. Behind every choice was one constraint: one machine, one webcam, and no network dependency while a vote is cast.

## What a voter sees

CIVS runs as one Flask app on port 8080, viewed in a browser pointed at localhost:8080, across three screens.

On the auth page a blue box tracks the voter's face, labeled "Scanning...", then "Face Detected", then "Verifying..." while the server compares the frame against every unvoted voter. On a match the box turns green with the voter's name for three seconds, the state flips to matched, and the page redirects to voting about two and a half seconds after that.

The voting page shows five party cards, each with a reference image of one to five raised fingers, and a small camera view. The voter holds up fingers; the matching card highlights and a progress bar fills over three seconds. A confirmation overlay then asks for a thumbs up, held three seconds, to confirm, or a thumbs down to cancel and restart.

A "Vote Recorded" screen shows for eight seconds, then the kiosk returns to the auth page. An admin uses register_voter.py to register voters from an ID photo, list them, print anonymous results, or reset.

## Architecture

CIVS is a single Python process. Flask serves pages and JSON status, one camera reader thread owns the webcam, and short-lived session objects spawn threads to run detection and paint overlays. All four models (Keras CNN, YOLO hand detector, MediaPipe GestureRecognizer, MediaPipe HandLandmarker) load once at startup in main.py. State lives in module globals because the kiosk serves one voter at a time.

![CIVS architecture: browser polling a Flask kiosk whose session threads run four vision models over a shared camera frame](/blog/diagrams/civs-contactless-voting-patent-architecture.svg)

Reading left to right: the browser pulls an MJPEG stream from /video_feed and polls /auth_status or /gesture_status every few hundred milliseconds. CameraManager is a singleton holding two frame slots, the latest raw frame and an optional annotated display frame. Sessions read raw frames, run their models, and write annotated frames back; the MJPEG generator prefers the display frame when one exists. On the right, DeepFace reads photos from voter_data/, and SQLite holds a voters table with a has_voted flag and a votes table with no voter column.

The main choices in the code and the reason for each:

| Layer | Choice | Why |
|---|---|---|
| Web framework | Flask 3, threaded, signed-cookie session | One process on one machine; the cookie carries voter_id from auth to voting |
| Video to browser | MJPEG multipart stream at 25 fps, JPEG quality 70 | Works in a plain img tag with no WebRTC setup |
| Camera access | CameraManager singleton with a daemon reader thread | One VideoCapture(0) shared by every session, frames mirrored once |
| Face detection | OpenCV Haar cascade, minSize 80x80 | Cheap enough to run at 30 fps on the draw thread |
| Face verification | DeepFace.verify with ArcFace, opencv backend | One call compares two images; slow, so it gets its own thread |
| Hand localization | ultralytics YOLO, conf 0.3, imgsz 320 | Draws a tight bounding box for the overlay |
| Gesture reading | MediaPipe HandLandmarker plus a finger-counting function | Landmark geometry ignores background and lighting |
| Confirmation | MediaPipe GestureRecognizer, Thumb_Up and Thumb_Down above 0.6 | Prebuilt classes, no training needed |
| Ballot store | SQLite via sqlite3, votes table without voter_id | Anonymous by schema, not by policy |

## How it works

### Two threads so the video never stutters

If face detection and verification share one thread, the stream freezes every time DeepFace runs. face_auth.py splits the work. A draw loop runs the Haar cascade on every frame at about 30 fps and paints a box with whatever label the auth loop last set. A separate auth loop does the slow part: it waits up to 30 seconds for a face, writes the frame to a temp file, then compares it against each unvoted voter.

```python
# face_auth.py
result = DeepFace.verify(
    img1_path=temp_path,
    img2_path=voter["photo_path"],
    model_name="ArcFace",
    detector_backend="opencv",
    enforce_detection=False,
)
if result["verified"]:
    matched_name = voter["name"]
```

The threads share only a lock-protected label and state. On success the auth loop sets the label to the voter's name, sleeps three seconds so the draw loop can show it, then flips state to "matched". The browser, polling every 400 ms, POSTs to /auth_success and the server copies the voter into the session cookie before the redirect.

### Counting fingers from landmarks

The party selector is a plain function over MediaPipe's 21 hand landmarks. For index through pinky, a finger is extended if its tip is above its PIP joint in image space. The thumb needs an x-axis check, and because CameraManager mirrors the frame, the direction depends on which hand MediaPipe reports.

```python
# gesture.py
if handedness_label == "Right":
    if thumb_tip.x < thumb_ip.x:
        count += 1
else:
    if thumb_tip.x > thumb_ip.x:
        count += 1
for tip_idx, pip_idx in zip(finger_tips, finger_pips):
    if landmarks[tip_idx].y < landmarks[pip_idx].y:
        count += 1
```

Counts of 1 to 5 map straight to parties. Zero or no hand resets the hold timer. This replaced the CNN as the decision maker.

### Dwell to select, dwell again to confirm

Per-frame detection is jittery; fingers flicker between 3 and 4 as a hand turns. CIVS never acts on one frame. GestureSession keeps a current_gesture and a hold_start_time, and the same count must persist for HOLD_SECONDS (3) before it becomes a selection.

```python
# gesture.py
if detected == self.current_gesture and self.hold_start_time:
    held_for = now - self.hold_start_time
    self.hold_progress = min(held_for, HOLD_SECONDS)
    # ... message update omitted
    if held_for >= HOLD_SECONDS:
        self.selected_party = PARTIES[detected]
        self.state = CONFIRMING
        # ... message and progress updates omitted
else:
    # ... reset current_gesture, hold_start_time, hold_progress
```

Any other count hits the else branch and restarts the timer. Reaching three seconds moves the state to CONFIRMING. There the loop stops counting fingers and runs the MediaPipe GestureRecognizer, looking for Thumb_Up or Thumb_Down above a 0.6 score, with its own three-second timer. Thumbs up moves to DONE; thumbs down moves to CANCELLED and the browser POSTs /restart_gesture for a fresh session.

![One vote through CIVS: face scan and ArcFace match, finger hold, thumbs-up confirm, anonymous insert](/blog/diagrams/civs-contactless-voting-patent-flow.svg)

The flow diagram follows one voter end to end. The only places the voter's id and the ballot sit together are the /confirm_vote route and record_vote, and record_vote writes them to different tables.

### Anonymous by schema

I wanted the ballot unlinkable even to me with the database file open. The votes table in db.py has three columns: id, party, timestamp. Eligibility is a has_voted flag on the voters table, and both writes happen in one transaction.

```python
# db.py
conn.execute(
    "INSERT INTO votes (party, timestamp) VALUES (?, ?)",
    (party, datetime.now().isoformat())
)
conn.execute(
    "UPDATE voters SET has_voted = 1 WHERE voter_id = ?",
    (voter_id,)
)
conn.commit()
```

If has_voted is already 1 the function returns False and the route answers HTTP 409. An earlier schema did carry voter_id, so init_db() checks PRAGMA table_info and recreates the votes table if that column exists. After a successful vote the route calls session.clear(), and the auth loop only ever queries unvoted voters.

### The CNN and the dataset behind it

The original gesture engine was a Keras CNN. create-dataset.py builds a running-average background over a fixed region of interest, thresholds the per-frame difference, keeps the largest contour as the hand, and saves the binary mask as a JPG. That gave me 3311 images across 11 classes (digits 1 to 9, done, notdone), the count the notebook prints.

The model in modelal.ipynb is three Conv2D blocks (32, 32, 64 filters) with max pooling and dropout, a Dense 128 layer, and an 11-way softmax, 325,099 parameters, trained for 50 epochs with Adam and ImageDataGenerator augmentation on an 80/20 split. Validation accuracy ended at 0.9985, and model.evaluate on that same validation split reported 0.9924. Those numbers are real and also misleading: the network learned clean binary masks captured in one fixed region of interest against a static background. That is why the rebuild moved to landmarks.

## The hard parts

The CNN is dead code in the live path. main.py loads model.h5 and passes it into GestureSession, and gesture.py has a _classify_cnn method that crops the YOLO box, resizes to 64x64, and predicts. Nothing calls it. Even if it did, raw color crops would go to a model trained on thresholded masks.

YOLO is a decoration. A _yolo_interval = 5 field was meant to throttle it, but it is never read, so YOLO runs on every frame and its only output is the overlay box. ultralytics is missing from requirements.txt, and the model files under models/ are gitignored with no download script.

Face verification is linear. Every attempt calls DeepFace.verify once per unvoted voter, up to 30 attempts, so worst case is 30N ArcFace comparisons. enforce_detection=False also means a frame with no clean face still gets compared.

The vote endpoint trusts the browser. /confirm_vote reads the party from the POSTed JSON instead of the server-side selected_party, which is a bug. The Flask secret_key also falls back to a dev string.

demo_setup.sh seeds nine dummy voters and 99 synthetic votes per party so the results screen looks populated on video. None of that is real voting data.

## Results

The CIVS design was granted a patent in May 2023, ID 202341031598. The README still says "published, yet to be granted" and needs updating.

What shipped is a working single-machine kiosk: face verification, gesture ballot with double confirmation, anonymous SQLite storage, a registration CLI, a demo seeding script, and the CNN training notebook. There is no deployment, no test suite, and no CI.

## What I would do differently

Delete the CNN from the live path. Replace the per-voter verify loop with stored ArcFace embeddings and one nearest-neighbor lookup per frame, turning 30N model runs into one. Make /confirm_vote read selected_party from the session object instead of the request body. Add a liveness check, because nothing in the pipeline today tells a live face from a printed photo. Honor _yolo_interval or drop YOLO, since MediaPipe already gives a bounding box.

Next is the AGVS speech mode the README describes and the code only has as comments and an unrouted template, so a voter who cannot raise a hand can speak a number instead.

## Key takeaways

- Split slow inference from fast drawing into separate threads that share only a label and a state string.
- Keep a raw frame slot and a display frame slot in the camera singleton, so any worker can paint overlays without owning capture.
- Never act on a single frame of a gesture classifier. A dwell timer with a visible progress bar removes jitter and gives the user a way to back out.
- Make anonymity a schema property. If the votes table has no voter column, no query can join it back, no matter who holds the file.
- Landmark geometry beats a pixel classifier for hand signs when the capture setup is not fixed. A tip-above-joint rule needs no training data and no background model.

## FAQ

### How does CIVS verify a voter's identity without any touch?

CIVS detects a face with an OpenCV Haar cascade, then uses DeepFace with ArcFace to compare the live webcam frame against the ID photo of every registered voter who has not yet voted. On a match the server stores the voter id in a signed session cookie and redirects to voting.

### How does CIVS read a hand gesture as a vote?

CIVS runs MediaPipe HandLandmarker on each frame and counts extended fingers by comparing each fingertip to its PIP joint, with a handedness-aware rule for the thumb. One to five fingers map to five parties. The count must be held for three seconds to select, and a thumbs up held three more seconds, detected by MediaPipe GestureRecognizer, confirms the ballot.

### Does CIVS link votes to voters?

No. The votes table in CIVS has only id, party, and timestamp. Eligibility is tracked by a has_voted flag on the separate voters table, and both writes happen in one transaction inside record_vote. The schema makes the ballot unlinkable rather than relying on an access policy.

### Is CIVS patented?

Yes. The Contactless Integrated Voting System was granted a patent in May 2023, patent ID 202341031598. The public repo contains the hand-gesture mode; the speech mode in the design is not implemented in the current code.

### What models does CIVS use?

CIVS loads four models at startup: a custom Keras CNN trained on 3311 self-captured hand masks, an ultralytics YOLO hand detector, MediaPipe HandLandmarker, and MediaPipe GestureRecognizer. Only the two MediaPipe models make decisions; the CNN is loaded but unused and YOLO only supplies the overlay bounding box.

## Links

- Source: [github.com/anirxdh/CIVS](https://github.com/anirxdh/CIVS)
