using System;
using System.Reflection;
using Newtonsoft.Json.Linq;

namespace ScannerBridge
{
    // Bridges the Electron app to a physical document scanner via Windows'
    // built-in WIA (Windows Image Acquisition) Automation Layer — the same
    // "Node/Electron can't call COM directly, so a small console app does it
    // instead and talks over stdio" pattern as bridge/Program.cs (SignatureBridge)
    // uses for the Wacom pad. See ../wacom/wacomPad.js for the Node side of
    // that pattern; scanner/scannerBridge.js is this bridge's equivalent.
    //
    // Unlike Wacom's SDK, WIA needs no separate installer or license — it
    // ships with Windows itself, exposed as the COM ProgIDs "WIA.DeviceManager"
    // and "WIA.CommonDialog" (registered by wiaaut.dll, the "WIA Automation
    // Layer"). That DLL has shipped inbox on Windows since XP; if a machine
    // somehow doesn't have it (rare, but the "ping" below reports it either
    // way rather than assuming), Type.GetTypeFromProgID just returns null and
    // this reports wiaAvailable:false so the renderer can fall back to
    // camera/file-upload attachment instead.
    //
    // Late-bound (reflection) COM calls are used throughout, same reasoning
    // as SignatureBridge: this project builds with no WIA type library
    // reference needed, since wiaaut.dll's ProgIDs are plain COM automation
    // objects. WIA.CommonDialog.ShowAcquireImage pops Windows' own native
    // "Select Device"/scan-settings UI (the same wizard "Windows Fax and
    // Scan" uses) rather than this app driving scan parameters itself — that
    // keeps this bridge thin and lets any TWAIN/WIA-compatible scanner's own
    // driver UI handle resolution/color/duplex settings.
    class Program
    {
        // WIA format GUIDs, from wiaguid.h — passed to ShowAcquireImage as the
        // FormatID it should convert the acquired page to. JPEG is used since
        // the rest of this app already standardizes on JPEG for camera-captured
        // images (see renderer/src/components/PhotoCapture.jsx).
        const string WiaFormatJPEG = "{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}";

        // WiaDeviceType.ScannerDeviceType
        const int ScannerDeviceType = 1;
        // WiaImageIntent.UnspecifiedIntent — let the device/driver decide color vs. grayscale.
        const int UnspecifiedIntent = 0;
        // WiaImageBias.MaximizeQuality — per Microsoft's WIA Automation Layer docs
        // (IUnknown::ShowAcquireImage). Double-check this constant against a real
        // scan if image quality looks wrong — MinimizeSize (0x10000) is the other
        // half of this enum and would be the fix if so.
        const int MaximizeQuality = 0x20000;

        [STAThread]
        static void Main()
        {
            string line;
            while ((line = Console.ReadLine()) != null)
            {
                if (string.IsNullOrWhiteSpace(line)) continue;

                JObject request;
                try
                {
                    request = JObject.Parse(line);
                }
                catch (Exception ex)
                {
                    Respond(new JObject { ["ok"] = false, ["error"] = $"bad request: {ex.Message}" });
                    continue;
                }

                var cmd = (string)request["cmd"];
                switch (cmd)
                {
                    case "ping":
                        HandlePing();
                        break;
                    case "scan":
                        HandleScan();
                        break;
                    case "exit":
                        return;
                    default:
                        Respond(new JObject { ["ok"] = false, ["error"] = $"unknown cmd: {cmd}" });
                        break;
                }
            }
        }

        static void HandlePing()
        {
            var managerType = Type.GetTypeFromProgID("WIA.DeviceManager", throwOnError: false);
            if (managerType == null)
            {
                Respond(new JObject { ["ok"] = true, ["wiaAvailable"] = false, ["deviceConnected"] = false, ["deviceName"] = null });
                return;
            }

            object manager = null;
            try
            {
                manager = Activator.CreateInstance(managerType);
                object deviceInfos = managerType.InvokeMember(
                    "DeviceInfos", BindingFlags.GetProperty, null, manager, null);
                int count = (int)deviceInfos.GetType().InvokeMember(
                    "Count", BindingFlags.GetProperty, null, deviceInfos, null);

                string deviceName = null;
                for (int i = 1; i <= count && deviceName == null; i++)
                {
                    // IDeviceInfos.Item is a parameterized ("indexed") COM property,
                    // not a plain method — BindingFlags.InvokeMethod alone raised
                    // DISP_E_MEMBERNOTFOUND against a real device list even though
                    // PowerShell's `$DeviceInfos.Item($i)` (a different COM binder)
                    // resolved it fine. Combining both flags lets .NET's late-bound
                    // InvokeMember try it as a property-with-args, which is what it
                    // actually is.
                    object info = deviceInfos.GetType().InvokeMember(
                        "Item", BindingFlags.InvokeMethod | BindingFlags.GetProperty, null, deviceInfos, new object[] { i });
                    int type = (int)info.GetType().InvokeMember(
                        "Type", BindingFlags.GetProperty, null, info, null);
                    if (type != ScannerDeviceType) continue;

                    deviceName = TryGetDeviceName(info) ?? "Scanner";
                }

                Respond(new JObject
                {
                    ["ok"] = true,
                    ["wiaAvailable"] = true,
                    ["deviceConnected"] = deviceName != null,
                    ["deviceName"] = deviceName,
                });
            }
            catch (Exception ex)
            {
                // DeviceManager instantiated fine (wiaaut.dll is present) but
                // something failed while enumerating devices — still report
                // wiaAvailable:true (the layer works) just with no device found,
                // and surface why for troubleshooting.
                Respond(new JObject
                {
                    ["ok"] = true,
                    ["wiaAvailable"] = true,
                    ["deviceConnected"] = false,
                    ["deviceName"] = null,
                    ["pingError"] = DescribeError(ex),
                });
            }
            finally
            {
                ReleaseCom(manager);
            }
        }

        // IDeviceInfo.Properties is an IProperties collection indexable by
        // name or numeric ID; "Name" (WIA_DIP_DEV_NAME) is the documented
        // human-readable device name. Wrapped defensively since a driver
        // could omit it — ping falls back to a generic "Scanner" label.
        static string TryGetDeviceName(object deviceInfo)
        {
            try
            {
                object properties = deviceInfo.GetType().InvokeMember(
                    "Properties", BindingFlags.GetProperty, null, deviceInfo, null);
                // Same indexed-property gotcha as IDeviceInfos.Item above.
                object nameProp = properties.GetType().InvokeMember(
                    "Item", BindingFlags.InvokeMethod | BindingFlags.GetProperty, null, properties, new object[] { "Name" });
                object value = nameProp.GetType().InvokeMember(
                    "Value", BindingFlags.GetProperty, null, nameProp, null);
                return value as string;
            }
            catch
            {
                return null;
            }
        }

        static void HandleScan()
        {
            object commonDialog = null;
            object imageFile = null;
            try
            {
                var dialogType = Type.GetTypeFromProgID("WIA.CommonDialog", throwOnError: true);
                commonDialog = Activator.CreateInstance(dialogType);

                // ShowAcquireImage(DeviceType, Intent, Bias, FormatID, AlwaysSelectDevice,
                // UseCommonUI, CancelError) — all parameters are declared optional in the
                // type library, but late-bound InvokeMember still needs every positional
                // slot filled in. UseCommonUI:true shows Windows' native device-select +
                // scan-settings wizard; CancelError:true makes a user Cancel throw instead
                // of silently returning Nothing, so it can be reported as a clean "canceled"
                // result below instead of a null-reference further down.
                imageFile = dialogType.InvokeMember(
                    "ShowAcquireImage", BindingFlags.InvokeMethod, null, commonDialog,
                    new object[] { ScannerDeviceType, UnspecifiedIntent, MaximizeQuality, WiaFormatJPEG, false, true, true });

                if (imageFile == null)
                {
                    Respond(new JObject { ["ok"] = false, ["error"] = "Scan canceled — no device selected or no page scanned." });
                    return;
                }

                object fileData = imageFile.GetType().InvokeMember(
                    "FileData", BindingFlags.GetProperty, null, imageFile, null);
                object binaryData = fileData.GetType().InvokeMember(
                    "BinaryData", BindingFlags.GetProperty, null, fileData, null);

                byte[] bytes = binaryData as byte[];
                if (bytes == null)
                {
                    throw new InvalidOperationException(
                        "FileData.BinaryData returned an unexpected type: " +
                        (binaryData == null ? "null" : binaryData.GetType().FullName));
                }

                Respond(new JObject
                {
                    ["ok"] = true,
                    ["imageBase64"] = Convert.ToBase64String(bytes),
                    ["mimeType"] = "image/jpeg",
                });
            }
            catch (Exception ex)
            {
                string message = DescribeError(ex);
                bool userCanceled = message.IndexOf("cancel", StringComparison.OrdinalIgnoreCase) >= 0;
                Respond(new JObject
                {
                    ["ok"] = false,
                    ["error"] = userCanceled ? "Scan canceled." : $"Scan failed: {message}",
                });
            }
            finally
            {
                ReleaseCom(imageFile);
                ReleaseCom(commonDialog);
            }
        }

        static void ReleaseCom(object comObject)
        {
            if (comObject != null && System.Runtime.InteropServices.Marshal.IsComObject(comObject))
            {
                try { System.Runtime.InteropServices.Marshal.FinalReleaseComObject(comObject); } catch { /* best effort */ }
            }
        }

        // Type.InvokeMember / COM interop calls often wrap the real failure in a
        // generic TargetInvocationException whose own .Message is boilerplate —
        // walk to the innermost exception so the real COM error reaches the caller.
        static string DescribeError(Exception ex)
        {
            var current = ex;
            while (current.InnerException != null) current = current.InnerException;
            return $"{current.GetType().Name}: {current.Message}";
        }

        static void Respond(JObject obj)
        {
            Console.WriteLine(obj.ToString(Newtonsoft.Json.Formatting.None));
            Console.Out.Flush();
        }
    }
}
