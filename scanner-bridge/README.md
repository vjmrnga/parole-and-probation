# ScannerBridge

A small C# console app that bridges the Electron app to a physical
flatbed/document scanner via Windows' built-in **WIA (Windows Image
Acquisition) Automation Layer** — the `WIA.DeviceManager` / `WIA.CommonDialog`
COM automation objects. It exists for the same reason `bridge/`
(SignatureBridge) does: Node.js/Electron can't call COM/ActiveX objects
directly, so this exe does it and talks to Electron over stdin/stdout as a
subprocess (see `scanner/scannerBridge.js`).

## What you need before this actually works

Unlike SignatureBridge, **there is no separate SDK installer or license key**
— WIA's Automation Layer (`wiaaut.dll`) has shipped inbox on Windows since XP
and registers `WIA.DeviceManager`/`WIA.CommonDialog` automatically. In
practice you just need:

1. **A scanner with a Windows driver installed** (WIA or TWAIN-via-WIA — most
   consumer/office flatbed and document-feed scanners ship one). Plug it in
   and confirm Windows' own "Scan" or "Windows Fax and Scan" app can see it
   before expecting this bridge to.
2. **.NET Framework 4.8** (this project targets `net48`), same as
   SignatureBridge — see `bridge/README.md` for the install notes; both
   bridges share the same toolchain requirement.

If `wiaaut.dll` is somehow missing (very rare on a real Windows install),
`ping` reports `wiaAvailable: false` and the renderer falls back to the
camera-capture / plain file-upload attachment options instead of the
"Scan Document" button — see `renderer/src/components/DocumentChecklist.jsx`.

## Building

```
cd scanner-bridge
dotnet build -c Release
```

Output: `scanner-bridge\bin\Release\net48\ScannerBridge.exe`. The Electron
app (`scanner/scannerBridge.js`) automatically looks for the exe at that
path — no extra config needed.

## Protocol

One JSON object per line in, one JSON object per line out:

| Command | Request | Response |
|---|---|---|
| Ping (used on app startup to detect whether WIA is available and a scanner is plugged in) | `{"cmd":"ping"}` | `{"ok":true,"wiaAvailable":true\|false,"deviceConnected":true\|false,"deviceName":string\|null}` |
| Scan a page | `{"cmd":"scan"}` | `{"ok":true,"imageBase64":"...","mimeType":"image/jpeg"}` or `{"ok":false,"error":"..."}` |
| Exit | `{"cmd":"exit"}` | (process exits, no response) |

`scan` calls `WIA.CommonDialog.ShowAcquireImage`, which pops Windows' own
native device-select + scan-settings wizard (the same one "Windows Fax and
Scan" shows) rather than this app driving resolution/color/duplex settings
itself — whatever the scanner's own driver UI offers is what the officer
sees. The acquired page comes back as JPEG bytes, base64-encoded.

## Things to verify once you have a real scanner installed

- **`MaximizeQuality` bias constant.** `Program.cs` passes `0x20000` for
  `ShowAcquireImage`'s `Bias` parameter, per Microsoft's WIA Automation Layer
  docs. If a scanned image comes back oddly sized/compressed, the other half
  of that enum (`MinimizeSize = 0x10000`) may be what's actually intended —
  swap it and rebuild.
- **Multi-page documents.** `ShowAcquireImage` returns a single `ImageFile`
  (one page) per call — there's no batch/duplex feeder handling here. For a
  multi-page document, the officer scans and attaches each page as a
  separate call, or scans to a single PDF using the scanner's own software
  and uses the plain "Upload File" attachment path instead (see
  `renderer/src/components/DocumentChecklist.jsx`).
- **32-bit vs 64-bit.** This project is pinned to `PlatformTarget=x64`
  (matching SignatureBridge). If a machine's scanner driver only registers a
  32-bit WIA provider (uncommon on modern hardware), change this back to
  `x86` and rebuild.
