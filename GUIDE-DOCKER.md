# ChatHouse — Run & test with **only Docker** (no Java, no Node.js)

This guide lets anyone run the full ChatHouse backend and build the Android app
**using nothing but Docker**. You do **not** need Java (JDK), the Android SDK, or
Node.js installed — the container images carry the entire toolchain.

You need:

- **Docker Desktop** (Windows/macOS) or Docker Engine + Compose v2 (Linux). That's it.
- An **Android phone** (Android 7.0 / API 24 or newer).
- The phone and this PC on the **same Wi-Fi** network.

> Two moving parts: the **backend** runs in Docker on this PC, and a **.apk** you
> build (also in Docker) installs on the phone. Because a React Native app freezes
> its server address at build time, the APK is baked to reach _this_ PC — that's
> why you build the APK here rather than downloading a generic one.

---

## TL;DR (Windows PowerShell)

```powershell
# 1. Start the backend (Postgres + Redis + API + LiveKit), auto-detects your LAN IP
.\scripts\start-backend.ps1

# 2. Build an APK baked to reach this PC (first run downloads the toolchain — slow)
.\scripts\build-apk.ps1

# 3. Grab the APK from .\artifacts\  and install it on your phone
```

macOS / Linux: use `scripts/start-backend.sh` and `scripts/build-apk.sh`.

The rest of this document explains each step and how to fix the usual snags.

---

## Step 1 — Start the backend (Docker only)

```powershell
.\scripts\start-backend.ps1              # or: .\scripts\start-backend.ps1 -LanIp 192.168.1.42
```

<details><summary>…or the raw command (no helper script)</summary>

```powershell
$env:LAN_IP="192.168.1.42"   # your PC's Wi-Fi IPv4
docker compose -f backend/docker-compose.yml up -d
```

</details>

This brings up four containers: **Postgres**, **Redis**, the **API** (port `4000`),
and the **LiveKit** live-audio server (port `7880`). The database **migrates itself
on boot** — no manual step. It works with **zero configuration**: dev secrets and the
SMS-free test login are already defaulted in the compose file.

Verify it's healthy (from this PC):

```powershell
curl http://localhost:4000/health
```

Find your PC's LAN IP if you need it (`start-backend.ps1` prints it too):

```powershell
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' } | Select IPAddress, InterfaceAlias
```

Stop everything later with: `.\scripts\start-backend.ps1 -Down`.

---

## Step 2 — Build the APK (Docker only)

```powershell
.\scripts\build-apk.ps1                  # auto-detects the same LAN IP
# or target a specific host / add 32-bit support:
.\scripts\build-apk.ps1 -LanIp 192.168.1.42 -Abis "arm64-v8a,armeabi-v7a"
```

<details><summary>…or the raw command</summary>

```powershell
$env:BACKEND_HOST="192.168.1.42"
docker compose -f docker-compose.apk.yml run --rm apk-builder
```

</details>

The first run builds the toolchain image (JDK 17 + Android SDK 36 + NDK + Node 20)
and downloads Gradle — **expect 15–40 minutes**. Later builds reuse the cached image,
dependencies, and Gradle cache, so they take a few minutes.

The finished file appears as **`artifacts\chathouse-<host>.apk`**.

> It's a **release** build (self-contained — the JavaScript is bundled in, so no
> Metro/dev server is needed) but **debug-signed**, so it installs freely for
> testing. It is **not** meant for the Play Store.

**Google Maps** (optional): the Map tab is blank without a key. Supply one with
`-GoogleMapsApiKey "AIza..."` (restrict it to `com.chathouse.app` + the debug SHA-1).

---

## Step 3 — Install the APK on the phone

Pick whichever is easier:

- **Copy & tap** — transfer `chathouse-<host>.apk` to the phone (USB cable, Google
  Drive, email…), tap it in a file manager, and allow _"install unknown apps"_.
- **adb** (if you have Android platform-tools — a small standalone download, no JDK):
  ```
  adb install -r artifacts\chathouse-<host>.apk
  ```

---

## Step 4 — Connect the phone to the backend

The APK is baked to reach `http://<this-PC-LAN-IP>:4000`. For that to work:

1. Phone and PC are on the **same Wi-Fi** (and the router doesn't isolate clients —
   "AP isolation" / "guest network" must be **off**).
2. The Windows **firewall allows inbound** connections to Docker on **TCP 4000**
   and **7880**, and **UDP 41100–41199** (LiveKit audio). If the app connects but
   audio fails, this is usually why.

Quick firewall allow (run PowerShell as Administrator, one-time):

```powershell
New-NetFirewallRule -DisplayName "ChatHouse LAN" -Direction Inbound -Action Allow `
  -Protocol TCP -LocalPort 4000,7880,7881
New-NetFirewallRule -DisplayName "ChatHouse LiveKit UDP" -Direction Inbound -Action Allow `
  -Protocol UDP -LocalPort 41100-41199
```

### Logging in without SMS

The backend ships a **test login** (no real SMS needed):

- **Phone number:** `550728585` (any country code, e.g. `+213 550728585`)
- **OTP code:** `000000`

---

## Alternative: USB instead of Wi-Fi (`adb reverse`)

If Wi-Fi routing is blocked (corporate/guest networks with AP isolation), tunnel
over USB instead. Build the APK for `127.0.0.1`, plug the phone in, and forward the
ports:

```powershell
.\scripts\build-apk.ps1 -LanIp 127.0.0.1
adb reverse tcp:4000 tcp:4000
adb reverse tcp:7880 tcp:7880
adb install -r artifacts\chathouse-127_0_0_1.apk
```

`adb` comes from Android **platform-tools** (a ~10 MB standalone zip — no Java/SDK).
`adb reverse` makes the phone's `127.0.0.1` point at this PC.

---

## Troubleshooting

| Symptom                                        | Fix                                                                                                                                                      |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker compose up` errors on a missing var    | Update to the current `backend/docker-compose.yml` — JWT secrets now default automatically.                                                              |
| App shows "Connection lost" / can't load rooms | Phone not on same Wi-Fi, AP isolation on, or firewall blocking 4000. Confirm `http://<PC_IP>:4000/health` opens **in the phone's browser**.              |
| Live audio doesn't connect                     | Open UDP 41100–41199 + TCP 7880 in the firewall, and make sure the backend was started with your LAN IP (`start-backend.ps1` handles this via `LAN_IP`). |
| Map tab is blank                               | Pass `-GoogleMapsApiKey` when building (see Step 2).                                                                                                     |
| Changed networks / new IP                      | The APK is frozen to one host — rebuild it with the new `-LanIp` (and restart the backend with the new `LAN_IP`).                                        |
| First APK build is very slow                   | Normal — it downloads the Android SDK/NDK + Gradle once. Subsequent builds are cached.                                                                   |

---

## What these commands touch

| File                             | Purpose                                                                                        |
| -------------------------------- | ---------------------------------------------------------------------------------------------- |
| `backend/docker-compose.yml`     | The backend stack (Postgres/Redis/API/LiveKit). Self-migrating, zero-config for local testing. |
| `docker-compose.apk.yml`         | The Dockerized APK builder service.                                                            |
| `docker/android/Dockerfile`      | Builder image: JDK 17 + Android SDK 36 + NDK 27 + Node 20.                                     |
| `docker/android/entrypoint.sh`   | Bakes the backend URL into the app, then builds the release APK.                               |
| `scripts/*.ps1` / `scripts/*.sh` | Convenience wrappers that auto-detect your LAN IP.                                             |
| `artifacts/`                     | Where built APKs land.                                                                         |
