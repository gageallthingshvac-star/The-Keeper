# Iron Tide — iPhone / iPad app

A native SwiftUI shell that runs `../irontide.html` full screen in a WKWebView, with Taptic Engine haptics bridged from the game.
The game file is referenced from the repo root, so every rebuild picks up the
latest version of the game. If you change anything in `src/`, run
`python3 tools/build.py` first to regenerate `irontide.html`.

## Requirements
- A Mac with **Xcode 16 or newer** (free from the Mac App Store)
- An Apple ID
- iPhone/iPad on **iOS 16.4 or newer**

## Run it on your iPhone
1. Clone the repo on your Mac and open `ios/IronTide.xcodeproj` in Xcode.
2. Click the **IronTide** project in the left sidebar → **IronTide** target → **Signing & Capabilities**.
   - Team: pick your Apple ID (Xcode → Settings → Accounts to add it).
   - If Xcode says the bundle identifier is taken, change `com.thekeeper.irontide` to something unique.
3. Plug in your iPhone (or pick it from the device menu over Wi-Fi). On the phone, enable
   **Settings → Privacy & Security → Developer Mode** when prompted, then restart it.
4. Press **Run** (⌘R).
5. First launch only: on the phone go to **Settings → General → VPN & Device Management**,
   tap your Apple ID and **Trust** it.

With a free Apple ID the app stops opening after **7 days**; plug in and press Run again to renew.
A paid Apple Developer Program membership ($99/year) lasts a year and unlocks TestFlight and the App Store.

## Ship to TestFlight / App Store (paid membership)
1. In App Store Connect, create an app with the same bundle identifier.
2. In Xcode: device menu → **Any iOS Device**, then **Product → Archive**.
3. In the Organizer window: **Distribute App → App Store Connect → Upload**.
4. Add testers in TestFlight, or fill in the listing (screenshots, description, privacy) and submit for review.

## Notes
- Saves and progress live in the app's own storage, separate from Safari.
- Sound follows the ring/silent switch.
- To debug the game on device: on the Mac, Safari → Develop → your iPhone → Iron Tide.
