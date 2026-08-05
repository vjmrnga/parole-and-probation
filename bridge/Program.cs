using System;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using ComTypes = System.Runtime.InteropServices.ComTypes;
using System.Text;
using Newtonsoft.Json.Linq;

namespace SignatureBridge
{
    // Minimal IDispatch declaration (BCL doesn't expose one publicly) used
    // only to reach GetTypeInfo() so we can introspect the real COM type
    // library instead of guessing argument types by trial and error.
    [ComImport, Guid("00020400-0000-0000-C000-000000000046"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IDispatchIntrospect
    {
        void GetTypeInfoCount(out int count);
        void GetTypeInfo(int iTInfo, int lcid, out ComTypes.ITypeInfo typeInfo);
    }

    // Bridges the Electron app to Wacom's Signature SDK. Node.js/Electron
    // cannot call COM/ActiveX directly, so this small console app does it
    // instead and talks to the Electron main process over stdio.
    //
    // Wacom's SDK exposes the pad only as two COM objects (see
    // https://github.com/Wacom-Developer/sdk-for-signature-windows):
    //   Florentis.SigCtl         - holds the license + resulting Signature
    //   Florentis.DynamicCapture - drives the pad and shows the capture UI
    //
    // Those objects only exist once the actual Wacom-Signature-SDK-x86 MSI
    // has been installed on this machine (not included in this repo/the
    // GitHub samples repo — see bridge/README.md). Until then, "ping" below
    // will correctly report sdkAvailable=false and the Electron app falls
    // back to the on-screen signature canvas.
    //
    // Late-bound (reflection) COM calls are used deliberately instead of an
    // early-bound Interop reference, so this project builds even without
    // the SDK/type library present. The exact member names below come from
    // Wacom's public getting-started guide; RenderBitmap's real signature
    // and return type (raw byte[] vs. a COM picture handle) should be
    // double-checked against the installed SDK's own C# sample once you
    // have it, and adjusted here if it differs.
    class Program
    {
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
                    case "capture":
                        HandleCapture(request);
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
            var sigCtlType = Type.GetTypeFromProgID("Florentis.SigCtl", throwOnError: false);
            Respond(new JObject { ["ok"] = true, ["sdkAvailable"] = sigCtlType != null });
        }

        static void HandleCapture(JObject request)
        {
            var signerName = (string)request["signerName"] ?? "";
            var reason = (string)request["reason"] ?? "";
            var license = Environment.GetEnvironmentVariable("WACOM_SIGNATURE_LICENSE") ?? "";

            // The SDK's Capture() validates this itself (raises "Invalid or
            // missing 'Who' parameter" as a COM exception if blank), but
            // checking here first gives a clear error instead of a raw COM
            // exception, and skips touching the pad at all when the caller
            // (the Electron app) forgot to pass a signer name.
            if (string.IsNullOrWhiteSpace(signerName))
            {
                Respond(new JObject { ["ok"] = false, ["error"] = "signerName ('Who') is required and cannot be blank." });
                return;
            }

            object sigCtl = null;
            object dynCapt = null;
            object signature = null;

            try
            {
                var sigCtlType = Type.GetTypeFromProgID("Florentis.SigCtl", throwOnError: true);
                var dynCaptType = Type.GetTypeFromProgID("Florentis.DynamicCapture", throwOnError: true);

                sigCtl = Activator.CreateInstance(sigCtlType);
                dynCapt = Activator.CreateInstance(dynCaptType);

                InvokeStep("SigCtl.Licence (set)", () => sigCtlType.InvokeMember(
                    "Licence", BindingFlags.SetProperty, null, sigCtl, new object[] { license }));

                // Shows the capture dialog on the pad/host and blocks until
                // the signer finishes or cancels.
                //
                // Reverted back to the original 3-arg call (SigCtl, Who, Why) —
                // the type library lists 5 declared parameter names for Capture
                // (Who, Why, What, Key too), but a name list alone doesn't mean
                // all of them are required; FUNCDESC.cParamsOpt (which the
                // introspection below never checked) is what actually says how
                // many trailing params are optional. Forcing What/Key to always
                // be supplied was the wrong fix — the reference project this was
                // ported from uses this exact 3-arg call and captures real
                // signatures on physical hardware, so the 5-arg version was
                // never the issue; something else in this file is.
                InvokeStep("DynamicCapture.Capture", () => dynCaptType.InvokeMember(
                    "Capture", BindingFlags.InvokeMethod, null, dynCapt,
                    new object[] { sigCtl, signerName, reason }));

                signature = InvokeStep("SigCtl.Signature (get)", () => sigCtlType.InvokeMember(
                    "Signature", BindingFlags.GetProperty, null, sigCtl, null));

                // RenderBitmap's parameters, resolved via COM type-library introspection:
                //   RenderBitmap(OutputFilename, DimensionX, DimensionY, MimeType, InkWidth,
                //                InkColor, BackgroundColor, PaddingX, PaddingY, Flags)
                // InkColor/BackgroundColor are OLE_COLOR (plain UI4: 0x00BBGGRR). Flags is
                // the RBFlags enum and must select an output mode — RenderOutputBase64 makes
                // it return the PNG as base64 directly instead of writing to OutputFilename,
                // so OutputFilename is unused here but still required as an argument.
                const int RenderOutputBase64 = 8192;
                const int RenderColor24BPP = 262144;

                object result = InvokeStep("Signature.RenderBitmap", () => signature.GetType().InvokeMember(
                    "RenderBitmap", BindingFlags.InvokeMethod, null, signature,
                    new object[]
                    {
                        "",                                     // OutputFilename (unused with RenderOutputBase64)
                        500,                                    // DimensionX (I4)
                        200,                                     // DimensionY (I4)
                        "image/png",                            // MimeType (BSTR)
                        1.0f,                                    // InkWidth (R4)
                        0,                                       // InkColor = black (OLE_COLOR)
                        0xFFFFFF,                                // BackgroundColor = white (OLE_COLOR)
                        10f,                                     // PaddingX (R4)
                        10f,                                     // PaddingY (R4)
                        RenderOutputBase64 | RenderColor24BPP    // Flags
                    }));

                string pngBase64;
                if (result is string base64Str)
                {
                    pngBase64 = base64Str;
                }
                else if (result is byte[] pngBytes)
                {
                    pngBase64 = Convert.ToBase64String(pngBytes);
                }
                else
                {
                    throw new InvalidOperationException(
                        "RenderBitmap returned an unexpected type with RenderOutputBase64 set: " +
                        (result == null ? "null" : result.GetType().FullName));
                }

                Respond(new JObject { ["ok"] = true, ["pngBase64"] = pngBase64 });
            }
            catch (Exception ex)
            {
                string baseMessage = DescribeError(ex);

                // "No signature to render" means Capture() ran to completion
                // (right arg count now, per the Capture() signature check below)
                // but recorded no ink. With the argument-count bug fixed, the
                // most likely remaining explanation is that ping's sdkAvailable
                // check (Florentis.SigCtl being registered) only proves the SDK
                // *software* is installed — not that a physical STU pad is
                // actually plugged in. Capture() ran the on-screen dialog with
                // nothing behind it to draw with. The member list below (again,
                // no physical signing required to get it) is so the next failure
                // can point at whatever property/method actually reports device
                // presence (e.g. a Device/Devices/IsConnected member), so ping can
                // be corrected to check that instead of just SDK registration.
                bool noSignature = baseMessage.IndexOf("No signature to render", StringComparison.OrdinalIgnoreCase) >= 0;
                string friendly = noSignature
                    ? "No signature was captured. If you did sign on the pad, this is likely because no physical Wacom pad is actually connected — the SDK software being installed isn't the same as a pad being plugged in."
                    : null;

                // The three user-defined-type parameters above (InkColor,
                // BackgroundColor, Flags) were guessed as plain ints — if that's
                // wrong, append what the type library actually says they are so
                // the next attempt doesn't require another physical signature capture.
                string udtDetail = signature != null ? DescribeRenderBitmapUserDefinedParams(signature) : null;
                string captureParams = dynCapt != null ? DescribeMethodParamNames(dynCapt, "Capture") : null;
                string sigCtlMembers = noSignature && sigCtl != null ? ListMemberNames(sigCtl, "SigCtl") : null;
                string dynCaptMembers = noSignature && dynCapt != null ? ListMemberNames(dynCapt, "DynamicCapture") : null;

                var parts = new[] { friendly, baseMessage, udtDetail, captureParams, sigCtlMembers, dynCaptMembers }
                    .Where(p => !string.IsNullOrEmpty(p));
                Respond(new JObject { ["ok"] = false, ["error"] = string.Join(" | ", parts) });
            }
            finally
            {
                // Release native device/dialog handles deterministically —
                // otherwise they linger until the GC finalizes these RCWs,
                // which can make the *next* capture attempt fail because the
                // pad is still considered "in use" by the previous instance.
                ReleaseCom(signature);
                ReleaseCom(dynCapt);
                ReleaseCom(sigCtl);
            }
        }

        // RenderBitmap's InkColor, BackgroundColor and Flags parameters are
        // VT_USERDEFINED — i.e. an enum, alias, or struct defined in the COM
        // type library, not a plain int/string we can infer from BindingFlags
        // alone. This walks the type library (IDispatch.GetTypeInfo ->
        // GetFuncDesc -> GetRefTypeInfo) to report what each really is —
        // e.g. an enum's named members and values, or the primitive type an
        // alias resolves to — so a wrong guess can be corrected from this
        // output instead of needing another physical signature capture.
        static string DescribeRenderBitmapUserDefinedParams(object signature)
        {
            try
            {
                var dispatch = signature as IDispatchIntrospect;
                if (dispatch == null) return "(signature object does not support IDispatch introspection)";

                dispatch.GetTypeInfo(0, 0, out ComTypes.ITypeInfo typeInfo);
                if (typeInfo == null) return "(GetTypeInfo returned no type information)";

                typeInfo.GetTypeAttr(out IntPtr typeAttrPtr);
                try
                {
                    var typeAttr = (ComTypes.TYPEATTR)Marshal.PtrToStructure(typeAttrPtr, typeof(ComTypes.TYPEATTR));
                    int elemDescSize = Marshal.SizeOf(typeof(ComTypes.ELEMDESC));

                    for (int i = 0; i < typeAttr.cFuncs; i++)
                    {
                        typeInfo.GetFuncDesc(i, out IntPtr funcDescPtr);
                        try
                        {
                            var funcDesc = (ComTypes.FUNCDESC)Marshal.PtrToStructure(funcDescPtr, typeof(ComTypes.FUNCDESC));
                            var names = new string[funcDesc.cParams + 1];
                            typeInfo.GetNames(funcDesc.memid, names, names.Length, out int namesCount);
                            if (namesCount == 0 || names[0] != "RenderBitmap") continue;

                            var sb = new StringBuilder();
                            for (int p = 0; p < funcDesc.cParams; p++)
                            {
                                var elemPtr = new IntPtr(funcDesc.lprgelemdescParam.ToInt64() + p * elemDescSize);
                                var elemDesc = (ComTypes.ELEMDESC)Marshal.PtrToStructure(elemPtr, typeof(ComTypes.ELEMDESC));
                                if (elemDesc.tdesc.vt != (short)VarEnum.VT_USERDEFINED) continue;

                                string paramName = (p + 1 < namesCount) ? names[p + 1] : $"arg{p}";
                                sb.Append($"{paramName}: {DescribeUserDefinedType(typeInfo, elemDesc.tdesc)} | ");
                            }
                            return sb.Length > 0 ? sb.ToString() : "(no user-defined parameters found)";
                        }
                        finally
                        {
                            typeInfo.ReleaseFuncDesc(funcDescPtr);
                        }
                    }
                    return "(RenderBitmap not found in the type library — it may be on a different interface)";
                }
                finally
                {
                    typeInfo.ReleaseTypeAttr(typeAttrPtr);
                }
            }
            catch (Exception ex)
            {
                return $"(introspection failed: {DescribeError(ex)})";
            }
        }

        // General-purpose version of the RenderBitmap walk above — reports every
        // parameter *name* (not just user-defined ones) for any method on any COM
        // object, in the order the type library declares them. Used to report
        // Capture()'s real signature (SigCtl, Who, Why, and anything else it
        // takes, e.g. a timeout) without needing another physical signature
        // capture to find out by trial and error.
        static string DescribeMethodParamNames(object comObject, string methodName)
        {
            try
            {
                var dispatch = comObject as IDispatchIntrospect;
                if (dispatch == null) return null;

                dispatch.GetTypeInfo(0, 0, out ComTypes.ITypeInfo typeInfo);
                if (typeInfo == null) return null;

                typeInfo.GetTypeAttr(out IntPtr typeAttrPtr);
                try
                {
                    var typeAttr = (ComTypes.TYPEATTR)Marshal.PtrToStructure(typeAttrPtr, typeof(ComTypes.TYPEATTR));
                    for (int i = 0; i < typeAttr.cFuncs; i++)
                    {
                        typeInfo.GetFuncDesc(i, out IntPtr funcDescPtr);
                        try
                        {
                            var funcDesc = (ComTypes.FUNCDESC)Marshal.PtrToStructure(funcDescPtr, typeof(ComTypes.FUNCDESC));
                            var names = new string[funcDesc.cParams + 1];
                            typeInfo.GetNames(funcDesc.memid, names, names.Length, out int namesCount);
                            if (namesCount == 0 || names[0] != methodName) continue;

                            var paramNames = names.Skip(1).Take(namesCount - 1);
                            return $"{methodName}() per type library: {methodName}({string.Join(", ", paramNames)})";
                        }
                        finally
                        {
                            typeInfo.ReleaseFuncDesc(funcDescPtr);
                        }
                    }
                    return $"({methodName} not found in the type library)";
                }
                finally
                {
                    typeInfo.ReleaseTypeAttr(typeAttrPtr);
                }
            }
            catch (Exception ex)
            {
                return $"({methodName} introspection failed: {DescribeError(ex)})";
            }
        }

        // Lists every method/property name on a COM object's primary interface
        // — used when a capture comes back with no ink recorded, to find
        // whatever member actually reports physical device presence (a
        // Device/Devices/IsConnected-shaped property), since ping today only
        // confirms the SDK *software* is registered, not that a pad is plugged
        // in. Static introspection, no physical hardware needed to run it.
        static string ListMemberNames(object comObject, string label)
        {
            try
            {
                var dispatch = comObject as IDispatchIntrospect;
                if (dispatch == null) return null;

                dispatch.GetTypeInfo(0, 0, out ComTypes.ITypeInfo typeInfo);
                if (typeInfo == null) return null;

                typeInfo.GetTypeAttr(out IntPtr typeAttrPtr);
                try
                {
                    var typeAttr = (ComTypes.TYPEATTR)Marshal.PtrToStructure(typeAttrPtr, typeof(ComTypes.TYPEATTR));
                    var memberNames = new System.Collections.Generic.List<string>();
                    for (int i = 0; i < typeAttr.cFuncs; i++)
                    {
                        typeInfo.GetFuncDesc(i, out IntPtr funcDescPtr);
                        try
                        {
                            var funcDesc = (ComTypes.FUNCDESC)Marshal.PtrToStructure(funcDescPtr, typeof(ComTypes.FUNCDESC));
                            var names = new string[1];
                            typeInfo.GetNames(funcDesc.memid, names, 1, out int namesCount);
                            if (namesCount > 0 && !memberNames.Contains(names[0])) memberNames.Add(names[0]);
                        }
                        finally
                        {
                            typeInfo.ReleaseFuncDesc(funcDescPtr);
                        }
                    }
                    return memberNames.Count > 0 ? $"{label} members: {string.Join(", ", memberNames)}" : $"({label} has no members)";
                }
                finally
                {
                    typeInfo.ReleaseTypeAttr(typeAttrPtr);
                }
            }
            catch (Exception ex)
            {
                return $"({label} member list failed: {DescribeError(ex)})";
            }
        }

        static string DescribeUserDefinedType(ComTypes.ITypeInfo declaringTypeInfo, ComTypes.TYPEDESC tdesc)
        {
            try
            {
                // tdesc.lpValue holds an HREFTYPE — a 32-bit type-library index,
                // not a real pointer — packed into a pointer-sized field. On a
                // 64-bit process the upper bits are typically just sign-extension
                // of that 32-bit value, but IntPtr.ToInt32() throws OverflowException
                // rather than assume that, which is what was killing this whole
                // description (see the "Flags: (failed to resolve: OverflowException…)"
                // in a failed capture's error). Truncating unchecked is the correct
                // read here, not a workaround — this is exactly what early-bound
                // interop code generated for this pattern does under the hood.
                int href = unchecked((int)tdesc.lpValue.ToInt64());
                declaringTypeInfo.GetRefTypeInfo(href, out ComTypes.ITypeInfo refTypeInfo);
                if (refTypeInfo == null) return "(could not resolve referenced type)";

                refTypeInfo.GetDocumentation(-1, out string typeName, out _, out _, out _);
                refTypeInfo.GetTypeAttr(out IntPtr attrPtr);
                try
                {
                    var attr = (ComTypes.TYPEATTR)Marshal.PtrToStructure(attrPtr, typeof(ComTypes.TYPEATTR));

                    if (attr.typekind == ComTypes.TYPEKIND.TKIND_ENUM)
                    {
                        var sb = new StringBuilder($"{typeName} (enum)");
                        for (int v = 0; v < attr.cVars; v++)
                        {
                            refTypeInfo.GetVarDesc(v, out IntPtr varDescPtr);
                            try
                            {
                                var varDesc = (ComTypes.VARDESC)Marshal.PtrToStructure(varDescPtr, typeof(ComTypes.VARDESC));
                                var memberNames = new string[1];
                                refTypeInfo.GetNames(varDesc.memid, memberNames, 1, out int cNames);
                                // GetObjectForNativeVariant can throw (seen: OverflowException) on
                                // some type libraries' VARDESCs — a member's *value* not marshaling
                                // cleanly shouldn't blow up the whole enum description, since the
                                // member *names* alone (RenderOutputBase64, etc.) are usually enough
                                // to pick the right flag.
                                object value;
                                try
                                {
                                    value = Marshal.GetObjectForNativeVariant(varDesc.desc.lpvarValue);
                                }
                                catch (Exception valueEx)
                                {
                                    value = $"?({valueEx.GetType().Name})";
                                }
                                sb.Append($" {(cNames > 0 ? memberNames[0] : "?")}={value}");
                            }
                            finally
                            {
                                refTypeInfo.ReleaseVarDesc(varDescPtr);
                            }
                        }
                        return sb.ToString();
                    }

                    if (attr.typekind == ComTypes.TYPEKIND.TKIND_ALIAS)
                    {
                        return $"{typeName} (alias for {(VarEnum)attr.tdescAlias.vt})";
                    }

                    return $"{typeName} ({attr.typekind})";
                }
                finally
                {
                    refTypeInfo.ReleaseTypeAttr(attrPtr);
                }
            }
            catch (Exception ex)
            {
                return $"(failed to resolve: {DescribeError(ex)})";
            }
        }

        // Runs one InvokeMember call and, on failure, tags the resulting
        // error with which COM call it came from — otherwise all four
        // reflection calls in HandleCapture collapse into the same generic
        // "TargetParameterCountException" with no way to tell which member
        // actually has the wrong signature.
        static object InvokeStep(string stepName, Func<object> action)
        {
            try
            {
                return action();
            }
            catch (Exception ex)
            {
                // Deliberately not chaining ex as an InnerException here:
                // DescribeError() unwraps to the innermost exception, which
                // would otherwise strip this step-name tag right back off.
                throw new InvalidOperationException($"{stepName} failed: {DescribeError(ex)}");
            }
        }

        static void ReleaseCom(object comObject)
        {
            if (comObject != null && Marshal.IsComObject(comObject))
            {
                try { Marshal.FinalReleaseComObject(comObject); } catch { /* best effort */ }
            }
        }

        // Type.InvokeMember / COM interop calls sometimes wrap the real
        // failure in a generic TargetInvocationException whose own .Message
        // is just boilerplate ("Exception has been thrown by the target of
        // an invocation."). Walk to the innermost exception so the real
        // COM error (HRESULT, message) actually reaches the caller.
        static string DescribeError(Exception ex)
        {
            var current = ex;
            while (current.InnerException != null)
            {
                current = current.InnerException;
            }
            return $"{current.GetType().Name}: {current.Message}";
        }

        static void Respond(JObject obj)
        {
            Console.WriteLine(obj.ToString(Newtonsoft.Json.Formatting.None));
            Console.Out.Flush();
        }
    }
}
