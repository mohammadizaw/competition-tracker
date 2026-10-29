// Paste your Firebase web app settings here (Firebase console → Project settings → Your apps → Web app → Config).
// Until this is filled in, the site runs in demo mode and keeps data in the browser only.
//
// window.FIREBASE_CONFIG = {
//   apiKey: "AIza...",
//   authDomain: "your-project.firebaseapp.com",
//   projectId: "your-project",
//   storageBucket: "your-project.appspot.com",
//   messagingSenderId: "1234567890",
//   appId: "1:1234567890:web:abcdef"
// };
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyB3T5rZRRlBREuH2DmpwUJFkkC9VHIDuFA",
  authDomain: "math-competitions-tracke-3945b.firebaseapp.com",
  projectId: "math-competitions-tracke-3945b",
  storageBucket: "math-competitions-tracke-3945b.firebasestorage.app",
  messagingSenderId: "192398178880",
  appId: "1:192398178880:web:204e080118f828046a3da5"
};

window.MCT_SETTINGS = {
  schoolLine: 'ATS RAK · Mathematics Department · AY 2026–27',
  // The owner sees the department overview and can add coordinators. Must match the email in firestore.rules.
  ownerEmail: 'mohammad.awaad@actvet.gov.ae',
  contacts: {
    abdullah: { name: 'Mr. Abdullah', email: 'abdullah.abbas@actvet.gov.ae' },
    habib:    { name: 'Mr. Habib',    email: 'Mohamed.Habib@actvet.gov.ae' },
    mahmoud:  { name: 'Mr. Mahmoud',  email: 'Mahmoud.Yousef@actvet.gov.ae' }
  }
};
