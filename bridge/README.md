# SignatureBridge

A small C# console app that bridges the Electron app to Wacom's Signature
SDK. It exists because that SDK only exposes the STU-300/430 pads as
Windows COM/ActiveX objects (`Florentis.SigCtl`, `Florentis.DynamicCapture`),
which Node.js/Electron can't call directly. Electron spawns this exe and
talks to it over stdin/stdout as a subprocess.

## What you need before this actually works

1. **The real Wacom Signature SDK installer**, from
   `developer.wacom.com/developer-dashboard` (Downloads for signature →
   "Wacom Ink SDK for Signature for Windows Desktop"). Two variants exist —
   `Wacom-Signature-SDK-x86-vXX.msi` and `Wacom-Signature-SDK-x64-vXX.msi`.
   This project is set up for the **x64** one (`PlatformTarget` in the
   .csproj) — install that variant to match. **Run the installer elevated**
   (as Administrator) — per Wacom's docs, COM registration silently fails
   otherwise.
2. **A license key** for the SDK (set via the `Licence` property on
   `SigCtl`). Wacom's GETTING-STARTED.md provides a free "Lite" JWT license
   covering everything except signature encryption and ISO signature
   formatting — enter it in the app's Settings screen (Signature Pad card);
   it's persisted via `electron-store` as `wacomLicenseKey`.
3. **.NET Framework 4.8** (this project targets `net48`). Visual Studio
   2022 with the ".NET desktop development" workload includes it. The
   .NET SDK's `dotnet build` also works once that workload/targeting pack
   is present — it already builds fine even without it, since this project
   only needs the reference assemblies, not the SDK's COM type library
   (see below).

## Why it builds without the SDK installed

This project calls the COM objects via **late binding** (reflection —
`Type.GetTypeFromProgID` + `InvokeMember`) instead of an early-bound
Interop reference. That means `dotnet build` succeeds right now, with no
SDK installed, producing `bin\Release\net48\SignatureBridge.exe`. It just
won't be able to *instantiate* those COM objects until the real SDK is
installed on the machine — at which point `ping` will start reporting
`sdkAvailable: true` and `capture` will actually work.

## Building

```
cd bridge
dotnet build -c Release
```

Output: `bridge\bin\Release\net48\SignatureBridge.exe`. The Electron app
(`wacom/wacomPad.js`) automatically looks for the exe at that path — no
extra config needed, just rebuild after installing the real SDK.

## Protocol

One JSON object per line in, one JSON object per line out:

| Command | Request | Response |
|---|---|---|
| Ping (used on app startup to detect whether the SDK is installed and a pad is physically connected) | `{"cmd":"ping"}` | `{"ok":true,"sdkAvailable":true\|false,"deviceConnected":true\|false}` |
| Capture a signature | `{"cmd":"capture","signerName":"Jane Doe","reason":"Form submission"}` | `{"ok":true,"pngBase64":"..."}` or `{"ok":false,"error":"..."}` |
| Exit | `{"cmd":"exit"}` | (process exits, no response) |

## Things to verify once you have the real SDK installed

The exact member names in `Program.cs` (`SigCtl`, `DynamicCapture`,
`Capture`, `Signature`, `RenderBitmap`) come from Wacom's public
getting-started guide, but two things are worth double-checking against
the SDK's own installed C# sample before relying on this in production:

- **`RenderBitmap`'s real signature and return type.** The code assumes it
  returns a raw `byte[]` of PNG data. If it instead returns a file path, a
  `System.Drawing.Bitmap`, or a COM picture handle (`IPictureDisp`),
  `HandleCapture()` in `Program.cs` will throw a clear error telling you to
  fix this — adjust the conversion there.
- **32-bit vs 64-bit.** Wacom ships both `x86` and `x64` installers. This
  project is pinned to `PlatformTarget=x64` — make sure you installed the
  matching `Wacom-Signature-SDK-x64-vXX.msi` (a process can only
  in-process-activate a COM server of the same bitness). If you installed
  the x86 MSI instead, change `PlatformTarget` back to `x86` here and
  rebuild.

## License key

Set it in the app's Settings screen (Signature Pad card) — stored via
`electron-store` as `wacomLicenseKey` (see `electron/settingsStore.js`). The
Electron main process passes it to this bridge as the
`WACOM_SIGNATURE_LICENSE` environment variable each time it spawns the
process, and restarts the bridge process when the key is saved so a new
key takes effect without an app restart.
