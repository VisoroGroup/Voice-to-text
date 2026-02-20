# 🎙️ VoiceScribe

**WhatsApp hangüzenetek automatikus átírása szöveggé — OpenAI Whisper**

VoiceScribe fogadja a WhatsApp hangüzeneteket, átírja szöveggé az OpenAI Whisper API segítségével, és megjeleníti egy prémium dashboardon. Támogatja a kézi fájlfeltöltést és a böngészőben történő hangfelvételt is.

---

## ⚡ Gyors indítás

```bash
# 1. Függőségek telepítése
npm install

# 2. Környezeti változók beállítása
cp .env.example .env
# Szerkeszd a .env fájlt a saját kulcsaiddal

# 3. Szerver indítása
npm start            # Production
npm run dev          # Development (auto-reload)
```

Nyisd meg a **http://localhost:3000** címet a böngészőben.

---

## 📁 Projekt struktúra

```
voicescribe/
├── server.js                    # Express szerver (CORS, rate limit, routing)
├── routes/
│   ├── webhook.js               # WhatsApp webhook (aláírás validáció + feldolgozás)
│   ├── transcribe.js            # Kézi feltöltés → Whisper átírás
│   └── api.js                   # CRUD, SSE, export, beállítások
├── services/
│   ├── storage.js               # SQLite adatbázis (sql.js)
│   ├── whatsapp.js              # WhatsApp média letöltés + üzenetküldés
│   └── whisper.js               # OpenAI Whisper (retry, méretlimit)
├── public/
│   └── index.html               # Prémium dark-mode dashboard
├── data/
│   └── transcriptions.db        # SQLite adatbázis (auto-generált)
├── .env.example                 # Környezeti változó sablon
├── .gitignore
├── package.json
└── README.md
```

---

## 🔧 Környezeti változók

| Változó | Leírás | Kötelező |
|---------|--------|----------|
| `PORT` | Szerver port (alapértelmezett: 3000) | Nem |
| `BASE_URL` | Publikus URL (pl. `https://app.example.com`) | Igen* |
| `CORS_ORIGINS` | Engedélyezett domain-ek, vesszővel elválasztva (alapértelmezett: `*`) | Nem |
| `OPENAI_API_KEY` | OpenAI API kulcs (`sk-...`) | Igen |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp telefonszám ID | Igen* |
| `WHATSAPP_ACCESS_TOKEN` | WhatsApp hozzáférési token | Igen* |
| `WHATSAPP_VERIFY_TOKEN` | Webhook ellenőrző token (általad választott string) | Igen* |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | WhatsApp Business fiók ID | Nem |
| `WHATSAPP_APP_SECRET` | Meta App Secret (webhook aláírás validáció) | Ajánlott |

> \* A WhatsApp-os változók csak a WhatsApp integrációhoz szükségesek. A kézi feltöltés működik nélkülük is.

---

## 📱 WhatsApp Business API beállítása

### 1. lépés: Meta Developer App létrehozása

1. Menj a [developers.facebook.com](https://developers.facebook.com) oldalra
2. Hozz létre egy új alkalmazást → **„Business"** típus
3. Add hozzá a **„WhatsApp"** terméket

### 2. lépés: WhatsApp konfigurálása

A WhatsApp termék beállításainál jegyezd fel:

- **Phone Number ID** → `WHATSAPP_PHONE_NUMBER_ID`
- **WhatsApp Business Account ID** → `WHATSAPP_BUSINESS_ACCOUNT_ID`
- **Ideiglenes Access Token** → `WHATSAPP_ACCESS_TOKEN` (az állandó tokenhez lásd a 4. lépést)

Adj hozzá egy teszt telefonszámot vagy használd a megadott tesztszámot.

### 3. lépés: Webhook beállítása

> ⚠️ **FONTOS:** Előbb telepítsd/deployold a szerveredet, hogy legyen publikus URL-ed!

1. A Meta Developer Console-ban menj a **WhatsApp → Configuration → Webhook** részbe
2. Állítsd be:
   - **Callback URL:** `https://your-server.com/webhook`
   - **Verify Token:** ugyanaz mint a `.env` fájlban a `WHATSAPP_VERIFY_TOKEN`
3. Iratkozz fel a **messages** mezőre

### 4. lépés: Állandó Access Token generálása

Az ideiglenes token 24 óra után lejár. Állandó token generálásához:

1. Menj a **Business Settings → System Users** oldalra
2. Hozz létre egy System User-t **admin** szerepkörrel
3. Generálj egy tokent a `whatsapp_business_messaging` engedéllyel
4. Használd ezt a `WHATSAPP_ACCESS_TOKEN` értékeként

### 5. lépés: App Secret beállítása (ajánlott)

A webhook aláírás validációhoz:

1. A Meta Developer Console-ban menj az **App Settings → Basic** oldalra
2. Másold ki az **App Secret** értéket
3. Állítsd be: `WHATSAPP_APP_SECRET=your_app_secret_value`

---

## 🚀 Deployment

### A) Railway (Ajánlott — legegyszerűbb)

```bash
# Railway CLI telepítése
npm install -g @railway/cli

# Bejelentkezés és deploy
railway login
railway init
railway up
```

A környezeti változókat a Railway dashboardon állítsd be.

### B) Render

1. Csatlakoztasd a GitHub repót
2. Válaszd a **"Web Service"** típust
3. Add hozzá a környezeti változókat
4. Auto-deploy push-ra

### C) VPS (DigitalOcean, Hetzner, stb.)

```bash
# Szerveren
git clone your-repo
cd voicescribe
npm install
cp .env.example .env
nano .env  # Szerkeszd a kulcsokat

# PM2 process manager
npm install -g pm2
pm2 start server.js --name voicescribe
pm2 save
pm2 startup

# Nginx reverse proxy + SSL
sudo apt install nginx certbot python3-certbot-nginx
```

Nginx konfiguráció (`/etc/nginx/sites-available/voicescribe`):

```nginx
server {
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # SSE support
        proxy_buffering off;
        proxy_cache off;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/voicescribe /etc/nginx/sites-enabled/
sudo certbot --nginx -d your-domain.com
sudo systemctl restart nginx
```

> ⚠️ **A WhatsApp webhook HTTPS-t igényel.** Használj Let's Encrypt-et (ingyenes) vagy egy platformot ami automatikusan biztosítja (Railway, Render).

---

## 🛡️ Biztonság

| Terület | Megoldás |
|---------|----------|
| **API kulcsok** | `.env` fájlban, soha nem commitolva (`.gitignore`) |
| **Webhook aláírás** | `X-Hub-Signature-256` validáció `WHATSAPP_APP_SECRET`-tel |
| **Rate limiting** | `express-rate-limit`: 100 kérés/15p (API), 10/15p (feltöltés) |
| **CORS** | `cors` middleware, konfigurálható `CORS_ORIGINS`-szel |
| **Body méret** | JSON limit: 1MB, fájlfeltöltés limit: 25MB |
| **Input validáció** | Fájltípus ellenőrzés, méretlimit, HTML escape |
| **HTTPS** | Kötelező a WhatsApp webhookhoz |

---

## 🔄 Hibakezelés

| Hiba | Kezelés |
|------|---------|
| **Webhook érvénytelen aláírás** | 403-as válasz, logolás |
| **Audio letöltés sikertelen** | Egy újrapróbálkozás 2s után, ha az is sikertelen: hibaüzenet a küldőnek |
| **Whisper API hiba** | Exponenciális backoff retry (2s, 4s, 8s) — max 3 kísérlet |
| **Túl nagy fájl** | Figyelmeztetés a küldőnek (>25MB) |
| **Szerver összeomlás** | PM2 auto-restart |
| **Rate limit túllépés** | 429-es válasz magyar nyelvű hibaüzenettel |
| **Üzenetsor** | Szekvenciális feldolgozás — nem terheli túl az API-t |

---

## 📡 API Végpontok

| Módszer | Útvonal | Leírás |
|---------|---------|--------|
| `GET` | `/webhook` | Meta webhook verifikáció |
| `POST` | `/webhook` | WhatsApp bejövő üzenetek |
| `POST` | `/api/transcribe` | Kézi fájlfeltöltés → átírás |
| `GET` | `/api/transcriptions` | Átírások listája (lapozás, szűrés, keresés) |
| `GET` | `/api/transcriptions/:id` | Egy átírás részletei |
| `PATCH` | `/api/transcriptions/:id` | Átírás szövegének szerkesztése |
| `DELETE` | `/api/transcriptions/:id` | Átírás törlése |
| `DELETE` | `/api/transcriptions` | Összes átírás törlése |
| `GET` | `/api/transcriptions/:id/export?format=txt\|srt` | Export TXT/SRT |
| `GET` | `/api/export?format=json\|csv` | Összes átírás exportálása |
| `GET` | `/api/stream` | SSE élő frissítések |
| `GET` | `/api/stats` | Statisztikák |
| `GET` | `/api/settings` | Beállítások lekérése |
| `PATCH` | `/api/settings` | Beállítások módosítása |
| `GET` | `/api/health` | Állapot ellenőrzés |

---

## ✅ Checklist

### Backend
- [x] Express szerver (CORS, rate limit, body limit)
- [x] WhatsApp webhook (GET verifikáció + POST feldolgozás)
- [x] Webhook aláírás validáció (X-Hub-Signature-256)
- [x] WhatsApp média letöltés (retry-vel)
- [x] WhatsApp üzenetküldés
- [x] OpenAI Whisper átírás (exponenciális retry)
- [x] SQLite adatbázis (sql.js, auto-persist)
- [x] Kézi feltöltés (multer)
- [x] SSE valós idejű frissítések
- [x] Szekvenciális üzenetsor
- [x] Hibakezelés és logolás

### Frontend
- [x] Dashboard (Outfit + IBM Plex fontok)
- [x] WhatsApp tab — üzenetkártyák, keresés, lapozás
- [x] Kézi feltöltés tab — drag & drop + felvétel
- [x] Beállítások tab — kapcsolat állapot, auto-reply, export
- [x] Inline szerkesztés (click-to-edit, auto-save)
- [x] SSE valós idejű frissítés
- [x] Másolás, export (TXT/SRT), törlés
- [x] Dark theme, responsive, animált
- [x] Toast értesítések

### DevOps
- [x] package.json (minden függőséggel)
- [x] .env.example sablon
- [x] .gitignore
- [x] README beállítási útmutatóval
- [x] Railway/Render/VPS deployment útmutató

---

## 📄 Licensz

MIT
