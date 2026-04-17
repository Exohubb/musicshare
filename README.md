<div align="center">

# 🎵 MusicSync

### Real-Time Synchronized Music Playback — Listen Together, Perfectly in Time

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4.6-010101?style=flat-square&logo=socket.io)](https://socket.io)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL%20%2B%20Storage-3ECF8E?style=flat-square&logo=supabase&logoColor=white)](https://supabase.com)
[![Deployed on Render](https://img.shields.io/badge/Deployed%20on-Render-46E3B7?style=flat-square&logo=render&logoColor=white)](https://render.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

**MusicSync** lets you create a room, upload a song, and have every listener hear it at the exact same millisecond — no matter where they are in the world. The host controls playback; listeners follow with sub-50ms precision using NTP-based clock synchronization.

</div>

---

## ✨ Features

- **🏠 Room-based Sessions** — Create a 4-digit room code; share it with friends to join instantly
- **⚡ Sub-50ms Sync Precision** — NTP clock-offset algorithm ensures all listeners play in perfect unison
- **🎧 Host Controls** — Play, pause, seek, and stop for all listeners simultaneously
- **📤 Audio Upload** — Upload MP3, M4A, WAV, or AAC files up to 50MB; stored in Supabase Storage
- **👥 Listener Management** — Host sees each listener's ping, clock offset, sync accuracy, and volume
- **📡 Real-Time Updates** — All room state (join/leave, playback, listener list) pushed instantly via WebSockets
- **🔁 Persistent Rooms** — Rooms and listener state survive server restarts via PostgreSQL
- **📱 Responsive UI** — Works on desktop and mobile browsers with no app install required
- **🌐 Live Room Lobby** — Landing page shows all active public rooms with listener counts

---

## 🛠️ Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Runtime** | Node.js 18+ (ESM) | Server runtime |
| **Web Framework** | Express.js 4 | HTTP server, static file serving, REST endpoints |
| **Real-Time** | Socket.IO 4.6 | Bidirectional WebSocket events for sync & control |
| **Database** | PostgreSQL via Supabase | Persistent room & listener state |
| **ORM / Query** | `postgres` (pg driver) | Raw SQL with tagged template literals |
| **File Storage** | Supabase Storage | Audio file upload, hosting, and CDN delivery |
| **File Upload** | Multer | In-memory multipart/form-data parsing |
| **Auth / Config** | dotenv | Environment variable management |
| **Deployment** | Render.com | Cloud hosting with auto-deploy from GitHub |
| **Frontend** | Vanilla HTML/CSS/JS | Zero-dependency client UI |

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────┐
│                      Clients                         │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │  index.html  │  │  host.html   │  │listener.html│ │
│  │  (Lobby)     │  │  (Host UI)   │  │(Listener UI)│ │
│  └──────┬───────┘  └──────┬───────┘  └─────┬──────┘  │
│         │   Socket.IO / HTTP               │          │
└─────────┼───────────────────────────────────┼─────────┘
          │                                   │
┌─────────▼───────────────────────────────────▼─────────┐
│                   Express + Socket.IO Server            │
│                                                         │
│  ┌─────────────────────┐   ┌──────────────────────────┐│
│  │  In-Memory Cache     │   │  Socket Event Handlers   ││
│  │  (roomsCache Map)    │   │  create-room, join,      ││
│  │  Real-time playback  │   │  play/pause/seek/stop,   ││
│  │  state & listeners   │   │  ntp:sync, ping          ││
│  └─────────────────────┘   └──────────────────────────┘│
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │  NTP Sync Engine                                  │  │
│  │  scheduledStartTime + clockOffset per listener   │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────┬───────────────────────────────────┘
                     │
        ┌────────────┼─────────────┐
        ▼                          ▼
┌───────────────┐        ┌─────────────────────┐
│  Supabase     │        │  Supabase Storage   │
│  PostgreSQL   │        │  (Audio Files CDN)  │
│               │        │                     │
│  rooms        │        │  music-sync-files/  │
│  listeners    │        │  bucket             │
└───────────────┘        └─────────────────────┘
```

### How Sync Works

1. Client connects and runs **NTP handshake** (`ntp:sync`) to calculate `clockOffset` = difference between client and server clocks
2. Host presses **Play** → server sets `scheduledStartTime = now + 1500ms` and broadcasts to all sockets in the room
3. Each listener uses `scheduledStartTime + clockOffset` to schedule `audio.play()` at the precise local time
4. Server broadcasts `sync:update` every second while playing so late joiners and drift are corrected

---

## 📁 Project Structure

```
sharemusic/
├── server.js          # Main server — Express, Socket.IO, all event handlers
├── db.js              # Supabase PostgreSQL connection (session pooler)
├── init-db.js         # One-time DB table creation script
├── package.json       # Dependencies and npm scripts
├── render.yaml        # Render.com deployment config
└── public/
    ├── index.html     # Landing page — room lobby, create/join room
    ├── host.html      # Host dashboard — upload audio, control playback, manage listeners
    └── listener.html  # Listener view — synced playback, volume, manual delay
```

---

## 🚀 Local Development

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project (free tier works)

### 1. Clone the repo

```bash
git clone https://github.com/Exohubb/sharemusic.git
cd sharemusic
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

Create a `.env` file:

```env
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

> Get this from: Supabase Dashboard → Project Settings → Database → Connection string (Session pooler mode)

### 4. Initialize the database

```bash
node init-db.js
```

### 5. Start the server

```bash
npm start
```

Open http://localhost:3000

---

## ☁️ Deploying to Render

### 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) → New Project
2. Create a Storage bucket named `music-sync-files` with **public** read access
3. Copy your **Database URL** from Project Settings → Database → Connection String (use **Session pooler**)

### 2. Deploy to Render

1. Push this repo to GitHub
2. Go to [Render Dashboard](https://dashboard.render.com) → **New → Web Service**
3. Connect your GitHub repository
4. Configure:

| Setting | Value |
|---|---|
| **Environment** | Node |
| **Build Command** | `npm install && node init-db.js` |
| **Start Command** | `node server.js` |
| **Plan** | Free |

### 3. Add Environment Variables in Render

Go to **Environment** tab and add:

| Key | Value |
|---|---|
| `DATABASE_URL` | Your Supabase session pooler connection string |
| `NODE_ENV` | `production` |

Render will auto-deploy on every push to `main`.

---

## 🗄️ Database Schema

```sql
-- Rooms table
CREATE TABLE rooms (
  code            VARCHAR(4) PRIMARY KEY,
  room_name       VARCHAR(100) NOT NULL,
  host_name       VARCHAR(50) NOT NULL,
  host_socket_id  VARCHAR(50),
  audio_file_id   VARCHAR(255),
  audio_url       TEXT,
  track_title     VARCHAR(255) DEFAULT 'No track loaded',
  track_artist    VARCHAR(100) DEFAULT 'Unknown',
  is_playing      BOOLEAN DEFAULT false,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

-- Listeners table
CREATE TABLE listeners (
  id            SERIAL PRIMARY KEY,
  room_code     VARCHAR(4) REFERENCES rooms(code) ON DELETE CASCADE,
  socket_id     VARCHAR(50) NOT NULL,
  name          VARCHAR(50) NOT NULL,
  volume        DECIMAL(3,2) DEFAULT 1.0,
  muted         BOOLEAN DEFAULT false,
  manual_delay  INTEGER DEFAULT 0,
  ping          INTEGER DEFAULT 0,
  clock_offset  INTEGER DEFAULT 0,
  sync_accuracy VARCHAR(20) DEFAULT 'calibrating',
  joined_at     TIMESTAMP DEFAULT NOW(),
  UNIQUE(room_code, socket_id)
);
```

---

## 🔌 Socket.IO Events

| Event | Direction | Description |
|---|---|---|
| `ntp:sync` | Client → Server → Client | NTP handshake to calculate clock offset |
| `get-rooms` | Client → Server | Fetch all active rooms |
| `create-room` | Client → Server | Create a new room |
| `join-as-host` | Host → Server | Rejoin existing room as host |
| `join-room` | Listener → Server | Join a room by code |
| `upload-complete` | Host → Server | Notify server of uploaded audio URL |
| `play` | Host → Server | Start synchronized playback |
| `pause` | Host → Server | Pause playback for all |
| `seek` | Host → Server | Seek to position for all |
| `stop` | Host → Server | Stop and reset playback |
| `sync:play` | Server → All | Broadcast scheduled play command |
| `sync:pause` | Server → All | Broadcast pause with position |
| `sync:seek` | Server → All | Broadcast seek position |
| `sync:update` | Server → All | Periodic position correction (1/sec) |
| `room-list` | Server → All | Updated list of all active rooms |
| `listener-list` | Server → Host | Updated listener stats for the room |
| `listener-ping` | Listener → Server | Listener reports its ping |

---

## 📦 Dependencies

```json
{
  "express": "^4.18.2",          // HTTP server & routing
  "socket.io": "^4.6.1",         // Real-time WebSocket engine
  "cors": "^2.8.5",               // Cross-origin request support
  "dotenv": "^16.0.3",            // Environment variable loading
  "multer": "^1.4.5-lts.1",       // Multipart file upload handling
  "@supabase/supabase-js": "^2.39.0", // Supabase Storage client
  "postgres": "^3.4.3"            // PostgreSQL client with tagged template queries
}
```

---

## 🔒 Security Notes

- Supabase anon key is safe for client-side use (row-level security controls access)
- Audio files are stored in a Supabase storage bucket with public read, authenticated write
- Room codes are 4-digit numeric — suitable for private sharing, not security
- All socket events validate room and listener existence before processing

---

## 🤝 Contributing

Pull requests are welcome. For major changes, open an issue first to discuss what you'd like to change.

1. Fork the repo
2. Create your branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'feat: add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

---

<div align="center">
  Made with ♥ by <a href="https://github.com/Exohubb">Exohubb</a>
</div>
