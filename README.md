# Math Competitions Tracker

A private web app for ATS RAK maths teachers. Each teacher signs in with their own email and password, adds their students, picks them for competitions, follows the next steps and sends the right emails. One teacher can never see another teacher's data.

* **Backend:** Google Firebase (free Spark plan): Authentication for logins, Firestore for the data.
* **Frontend:** plain HTML, CSS and JavaScript. No build step. Works on phones and desktops, light and dark.
* **Shared content** (the competitions list and the department reminders) lives in `data/competitions.json` and `data/actions.json`. Edit those files to update every teacher at once.

---

## Setup (about 10 minutes, no coding)

### 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> and sign in with your Google account.
2. **Add project** → name it `math-competitions-tracker` → turn **off** Google Analytics → **Create project**.

### 2. Turn on email + password logins

1. In the left menu: **Build → Authentication → Get started**.
2. Choose **Email/Password** → switch **Enable** on → **Save**.

### 3. Create the database

1. **Build → Firestore Database → Create database**.
2. Location: pick `asia-south1 (Mumbai)` or `europe-west` (any is fine) → **Next**.
3. Choose **Start in production mode** → **Create**.
4. Open the **Rules** tab, delete everything there, paste the contents of `firestore.rules` from this folder, and click **Publish**. These rules are what keep every teacher's data private.

### 4. Get the web settings

1. Click the gear icon next to **Project Overview** → **Project settings**.
2. Scroll to **Your apps** → click the **</>** (Web) icon → nickname `tracker` → **Register app**.
3. You will see a block that starts with `const firebaseConfig = {`. Copy the lines inside the braces.
4. Open `firebase-config.js`, replace `window.FIREBASE_CONFIG = null;` with
   ```js
   window.FIREBASE_CONFIG = { ...paste the lines here... };
   ```
   and save.

### 5. Put the site online

Pick whichever is easiest:

* **Netlify Drop (easiest):** go to <https://app.netlify.com/drop>, drag this whole folder onto the page. You get a link like `https://something.netlify.app` within seconds. Create a free account to keep the link.
* **GitHub Pages:** upload the folder to a GitHub repository → Settings → Pages → Branch `main` → Save.
* **Firebase Hosting:** needs the Firebase command line tool (`npm i -g firebase-tools`, then `firebase login`, `firebase init hosting` using this folder, `firebase deploy`).

### 6. Allow the new address to sign in

In Firebase: **Authentication → Settings → Authorized domains → Add domain** and add the address from step 5 (for example `something.netlify.app`). Without this step the sign-in page shows an "unauthorized domain" error.

Share the link with your colleagues. Each teacher taps **Create account** once, then signs in with that email and password from any device.

---

## Updating content later

* **New competition or changed dates:** edit `data/competitions.json` and re-upload the folder.
* **New department reminder:** add an item to `data/actions.json` with a new `id`. Every teacher sees it the next time they open the app; reminders they already ticked are untouched.
* **Coordinator emails or school name:** edit `window.MCT_SETTINGS` in `firebase-config.js`.

## Demo mode

Until `firebase-config.js` is filled in, the app runs in demo mode: any email and password signs in and data is kept in that browser only. Useful for trying the design, not for real use.
