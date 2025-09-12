# 🔐 SecureVault – Encrypted Password Manager

icon: icons/icon-128.png

description: >
  SecureVault is a lightweight Chrome extension that provides an
  end-to-end encrypted password manager. All encryption happens locally
  in your browser – ensuring that even if your data is leaked, it
  remains unreadable.

---

features:
  - 🔑 Master Password & Key Derivation
    details: >
      Uses PBKDF2 to derive a strong AES-256 key from your master password.
      (Future-ready: can be extended to Argon2 or scrypt).
  - 🛡 Local Encryption
    details: >
      Credentials are encrypted with AES-GCM before saving.
      The master password is never stored.
  - 📂 Vault Management
    details: >
      Add, edit, delete, and search saved credentials securely.
  - 🔒 Auto-Lock
    details: >
      Vault automatically locks after inactivity (configurable in settings).
  - 🎨 Modern UI
    details: >
      Built with clean HTML/CSS for a smooth, responsive interface.
  - 🌐 Autofill Support
    details: >
      Content script detects login fields and can autofill stored credentials.

---

screenshots:
  - path: icons/screenshot1.png
    caption: "🔒 Lock screen – Unlock with your master password"
  - path: icons/screenshot2.png
    caption: "📂 Vault dashboard – Manage credentials securely"

---

project_structure: |
  SecureVault/
  │
  ├── icons/                # Extension icon + screenshots for README
  │   ├── icon-128.png
  │   ├── screenshot1.png
  │   └── screenshot2.png
  │
  ├── PopupUI/              # Frontend (popup + options pages)
  │   ├── popup.html
  │   ├── popup.js
  │   ├── options.html
  │   ├── options.js
  │   ├── offscreen.html
  │   └── offscreen.js
  │
  ├── src/                  # Core logic
  │   ├── background.js
  │   ├── content.js
  │   ├── crypto.js
  │   ├── db.js
  │   └── password.js
  │
  ├── styles.css            # Shared stylesheet
  ├── manifest.json         # Chrome extension manifest (v3)
  └── README.md             # Project documentation

---

installation:
  steps:
    - step: Clone this repository
      command: git clone https://github.com/yourusername/SecureVault.git
    - step: Navigate into the folder
      command: cd SecureVault
    - step: Open Chrome Extensions
      link: chrome://extensions/
    - step: Enable Developer mode
    - step: Click "Load unpacked" and select project folder
    - step: Done! 🎉 Extension appears in Chrome toolbar

---

tech_stack:
  - JavaScript (ES6+)
  - Chrome Extensions API (Manifest v3)
  - WebCrypto API (PBKDF2 + AES-GCM)
  - HTML5, CSS3

---

security_model:
  - The master password is never stored.
  - A PBKDF2-derived key (AES-256) encrypts and decrypts all credentials.
  - Encrypted data is stored in Chrome’s local storage.
  - Even if the database is leaked, attackers only see encrypted gibberish.

---

contributing: >
  Contributions are welcome! Please open an issue or submit a pull
  request for suggestions, bug fixes, or improvements.

---

license: >
  MIT License © 2025 [Your Name]
